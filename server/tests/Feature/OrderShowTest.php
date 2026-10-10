<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderShowTest extends TestCase
{
    use RefreshDatabase;

    private function order(User $buyer, string $status = 'pending', ?string $claimToken = 'SHOWTOKEN1'): Order
    {
        $item = Merchandise::factory()->create(['organization_id' => $buyer->organization_id]);

        return Order::create([
            'organization_id' => $buyer->organization_id,
            'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'total_price' => (float) $item->price,
            'payment_method' => 'cash',
            'status' => $status,
            'officer_review_status' => 'pending',
            'admin_review_status' => 'pending',
            'claim_token' => $claimToken,
        ]);
    }

    public function test_show_returns_the_same_row_the_index_lists_for_each_permitted_role(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $order = $this->order($buyer, 'paid');

        foreach ([$buyer, $admin, $officer] as $viewer) {
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs($viewer);
            $listed = collect($this->getJson('/api/orders')->assertOk()->json('data'))->firstWhere('id', $order->id);
            $shown = $this->getJson("/api/orders/{$order->id}")->assertOk()->json();

            $this->assertNotNull($listed);
            $this->assertSame($listed, $shown, "{$viewer->role} should get the index row shape");
            $this->assertSame('SHOWTOKEN1', $shown['claim_token']);
        }
    }

    public function test_show_hides_the_claim_token_until_the_order_is_paid(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $order = $this->order($buyer, 'pending');

        Sanctum::actingAs($buyer);
        $this->getJson("/api/orders/{$order->id}")->assertOk()->assertJsonPath('claim_token', null);
    }

    public function test_a_student_sees_only_their_own_order(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $classmate = User::factory()->student()->create(['organization_id' => $organization->id]);
        $order = $this->order($buyer);

        Sanctum::actingAs($classmate);
        $denied = $this->getJson("/api/orders/{$order->id}")->assertNotFound();
        $unknown = $this->getJson('/api/orders/999999')->assertNotFound();

        $this->assertSame($unknown->getContent(), $denied->getContent());
    }

    public function test_another_organizations_staff_and_students_get_the_same_404_as_an_unknown_id(): void
    {
        $organization = Organization::factory()->create();
        $other = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $order = $this->order($buyer);
        $foreignAdmin = User::factory()->admin()->create(['organization_id' => $other->id]);
        $foreignOfficer = User::factory()->officer()->create(['organization_id' => $other->id]);
        $foreignStudent = User::factory()->student()->create(['organization_id' => $other->id]);

        foreach ([$foreignAdmin, $foreignOfficer, $foreignStudent] as $viewer) {
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs($viewer);
            $denied = $this->getJson("/api/orders/{$order->id}")->assertNotFound();
            $unknown = $this->getJson('/api/orders/999999')->assertNotFound();

            $this->assertSame($unknown->getContent(), $denied->getContent());
        }
    }

    public function test_roles_outside_the_orders_middleware_are_refused(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $order = $this->order($buyer);
        $head = User::factory()->create(['role' => 'DEPARTMENT_HEAD', 'organization_id' => $organization->id]);

        Sanctum::actingAs($head);
        $this->getJson("/api/orders/{$order->id}")->assertForbidden();
    }

    public function test_the_fixed_get_order_routes_still_resolve_ahead_of_the_show_route(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($admin);
        $this->get('/api/orders/export')->assertOk();
        $this->getJson('/api/orders/analytics/users?group=paid')->assertOk();
    }
}
