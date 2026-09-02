<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MerchandiseOrderAnalyticsTest extends TestCase
{
    use RefreshDatabase;

    public function test_authorized_fulfillment_users_can_filter_summarize_drill_down_and_export_orders(): void
    {
        $organization = Organization::factory()->create(['college' => 'College of Computer Studies']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $buyer = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'department' => 'College of Computer Studies',
            'program' => 'BS Information Technology',
            'major' => 'Web Development',
            'year_level' => '4th Year',
            'section' => '4-A',
        ]);
        $nonBuyer = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'department' => 'College of Computer Studies',
            'program' => 'BS Information Technology',
            'major' => 'Web Development',
            'year_level' => '4th Year',
            'section' => '4-A',
        ]);
        User::factory()->student()->create([
            'organization_id' => $organization->id,
            'program' => 'BS Information Technology',
            'year_level' => '4th Year',
            'section' => '4-B',
        ]);

        $item = Merchandise::factory()->create([
            'organization_id' => $organization->id,
            'name' => 'HIUSA Shirt',
            'price' => 100,
        ]);
        $transaction = Transaction::create([
            'organization_id' => $organization->id,
            'type' => 'income',
            'amount' => 200,
            'category' => 'Merchandise',
            'description' => 'Analytics test payment',
            'recorded_by' => $admin->school_id,
            'payer_id' => $buyer->school_id,
            'transaction_date' => now(),
            'receipt_reference' => 'MERCH-TEST-1',
        ]);
        Order::create([
            'organization_id' => $organization->id,
            'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id,
            'quantity' => 2,
            'total_price' => 200,
            'payment_method' => 'cash',
            'status' => 'paid',
            'officer_review_status' => 'approved',
            'admin_review_status' => 'approved',
            'transaction_id' => $transaction->id,
            'claim_token' => 'ANALYTICSTEST01',
        ]);
        Order::create([
            'organization_id' => $organization->id,
            'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'total_price' => 100,
            'payment_method' => 'cash',
            'status' => 'pending',
            'claim_token' => 'ANALYTICSTEST02',
        ]);

        $otherOrganization = Organization::factory()->create();
        $otherBuyer = User::factory()->student()->create(['organization_id' => $otherOrganization->id]);
        $otherItem = Merchandise::factory()->create(['organization_id' => $otherOrganization->id]);
        Order::create([
            'organization_id' => $otherOrganization->id,
            'student_id' => $otherBuyer->school_id,
            'merchandise_id' => $otherItem->id,
            'quantity' => 9,
            'total_price' => 9999,
            'status' => 'paid',
            'claim_token' => 'OTHERORGORDER01',
        ]);

        Sanctum::actingAs($admin);
        $query = '?program=BS%20Information%20Technology&year_level=4th%20Year&section=4-A';
        $this->getJson('/api/orders'.$query)
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('summary.total_users', 2)
            ->assertJsonPath('summary.purchased_users', 1)
            ->assertJsonPath('summary.not_purchased_users', 1)
            ->assertJsonPath('summary.purchase_rate', 50)
            ->assertJsonPath('summary.paid_orders', 1)
            ->assertJsonPath('summary.pending_orders', 1)
            ->assertJsonPath('summary.total_quantity', 3)
            ->assertJsonPath('summary.total_collected', 200)
            ->assertJsonPath('summary.outstanding_balance', 100)
            ->assertJsonPath('data.0.claim_token', null);

        $this->getJson('/api/orders/analytics/users'.$query.'&group=not_purchased')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.school_id', $nonBuyer->school_id)
            ->assertJsonCount(0, 'data.0.orders');

        $export = $this->get('/api/orders/export'.$query)
            ->assertOk()
            ->assertHeader('content-type', 'text/csv; charset=UTF-8');
        $this->assertStringContainsString('ORD-', $export->streamedContent());
        $this->assertStringContainsString('HIUSA Shirt', $export->streamedContent());
    }

    public function test_students_cannot_access_order_cohort_drilldowns_or_exports(): void
    {
        $student = User::factory()->student()->create();
        Sanctum::actingAs($student);

        $this->getJson('/api/orders/analytics/users?group=purchased')->assertForbidden();
        $this->getJson('/api/orders/export')->assertForbidden();
    }
}
