<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The order queue search finds an order by the reference the card prints, ORD-<number>. */
class OrderSearchTest extends TestCase
{
    use RefreshDatabase;

    private function order(User $buyer): Order
    {
        $item = Merchandise::factory()->create(['organization_id' => $buyer->organization_id]);

        return Order::create([
            'organization_id' => $buyer->organization_id,
            'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'total_price' => (float) $item->price,
            'payment_method' => 'cash',
            'status' => 'pending',
            'officer_review_status' => 'pending',
            'admin_review_status' => 'pending',
            'claim_token' => 'SEARCHTOKEN'.$item->id,
        ]);
    }

    public function test_searching_the_printed_order_reference_finds_exactly_that_order(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $orders = collect([$this->order($buyer), $this->order($buyer), $this->order($buyer)]);
        $wanted = $orders[1];

        foreach (["ORD-{$wanted->id}", "ord-{$wanted->id}", " ORD-{$wanted->id} ", "ORD {$wanted->id}", "ORD{$wanted->id}"] as $search) {
            $ids = collect($this->getJson('/api/orders?'.http_build_query(['search' => $search]))->assertOk()->json('data'))->pluck('id')->all();
            $this->assertSame([$wanted->id], $ids, "Searching '{$search}' should find only ORD-{$wanted->id}.");
        }
    }

    public function test_a_half_typed_reference_does_not_empty_the_list(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $order = $this->order($buyer);

        foreach (['ORD-', 'ord'] as $search) {
            $ids = collect($this->getJson('/api/orders?'.http_build_query(['search' => $search]))->assertOk()->json('data'))->pluck('id')->all();
            $this->assertContains($order->id, $ids);
        }
    }

    public function test_a_bare_number_still_matches_by_partial_id(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $order = $this->order($buyer);

        $ids = collect($this->getJson('/api/orders?'.http_build_query(['search' => (string) $order->id]))->assertOk()->json('data'))->pluck('id')->all();

        $this->assertContains($order->id, $ids);
    }
}
