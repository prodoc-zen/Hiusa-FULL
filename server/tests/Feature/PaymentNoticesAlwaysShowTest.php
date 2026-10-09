<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Payment and verification notices are ones someone is waiting on, so they
 * always show even when the person muted the informational merchandise kind.
 */
class PaymentNoticesAlwaysShowTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $officer;

    private User $student;

    private Merchandise $item;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $this->item = Merchandise::factory()->create(['organization_id' => $organization->id, 'is_active' => true, 'stock_quantity' => 10, 'price' => '300.00']);
    }

    private function mute(User $user): void
    {
        Sanctum::actingAs($user);
        $this->putJson('/api/user/notification-preferences', ['muted' => ['merchandise']])->assertOk()->assertJsonPath('muted', ['merchandise']);
    }

    private function placeOrder(): int
    {
        Sanctum::actingAs($this->student);

        return $this->postJson('/api/orders', ['merchandise_id' => $this->item->id, 'quantity' => 1, 'payment_method' => 'cash'])->assertCreated()->json('id');
    }

    public function test_a_buyer_who_muted_merchandise_still_sees_and_counts_a_rejected_payment(): void
    {
        $this->mute($this->student);
        $orderId = $this->placeOrder();

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'cancelled', 'review_remarks' => 'Proof is unreadable.'])->assertOk();

        Sanctum::actingAs($this->student);
        $response = $this->getJson('/api/notifications')->assertOk();
        $this->assertSame(['Payment Rejected'], array_column($response->json('data'), 'title'));
        $this->assertSame('Proof is unreadable.', $response->json('data.0.message'));
        $this->assertSame(1, $response->json('unread_count'));
    }

    public function test_a_buyer_who_muted_merchandise_still_sees_an_approved_payment(): void
    {
        $this->mute($this->student);
        $orderId = $this->placeOrder();

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])->assertOk();

        Sanctum::actingAs($this->student);
        $response = $this->getJson('/api/notifications')->assertOk();
        $this->assertSame(['Payment Approved'], array_column($response->json('data'), 'title'));
        $this->assertSame(1, $response->json('unread_count'));
    }

    public function test_an_officer_who_muted_merchandise_still_sees_an_order_awaiting_payment_verification(): void
    {
        $this->mute($this->officer);
        $orderId = $this->placeOrder();

        Sanctum::actingAs($this->officer);
        $response = $this->getJson('/api/notifications')->assertOk();
        $this->assertSame(["Order ORD-{$orderId} is awaiting payment verification."], array_column($response->json('data'), 'message'));
        $this->assertSame(1, $response->json('unread_count'));
        $this->assertNotContains(Notification::where('user_id', $this->officer->school_id)->value('notification_type'), Notification::MUTABLE_TYPES);
    }
}
