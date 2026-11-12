<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
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

    private function mineIds(string $search): array
    {
        return collect($this->getJson('/api/orders?'.http_build_query(['mine' => 1, 'search' => $search]))->assertOk()->json('data'))->pluck('id')->all();
    }

    public function test_a_buyer_searching_my_orders_gets_only_their_own_matching_order(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $other = User::factory()->student()->create(['organization_id' => $organization->id]);
        $mine = [$this->order($buyer), $this->order($buyer), $this->order($buyer)];
        $theirs = $this->order($other);
        $theirs->merchandise->update(['name' => $mine[1]->merchandise->name]);
        Sanctum::actingAs($buyer);

        foreach (["ORD-{$mine[1]->id}", $mine[1]->merchandise->name] as $search) {
            $ids = $this->mineIds($search);
            $this->assertContains($mine[1]->id, $ids, "Searching '{$search}' should find the buyer's order.");
            $this->assertNotContains($theirs->id, $ids, 'Another buyer\'s order must never appear.');
        }
        $this->assertSame([$mine[1]->id], $this->mineIds("ORD-{$mine[1]->id}"));
        $this->assertNotContains($theirs->id, $this->mineIds("ORD-{$theirs->id}"));
        $this->assertSame([], $this->mineIds("ORD-{$theirs->id}"));
        $this->assertSame([], $this->mineIds('zzz-no-such-order'));
    }

    public function test_a_buyer_search_does_not_reach_student_fields_or_review_remarks(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $order = $this->order($buyer);
        $order->update(['review_remarks' => 'secret-remark-text']);
        Sanctum::actingAs($buyer);

        $this->assertSame([], $this->mineIds($buyer->first_name.'zz'));
        $this->assertSame([], $this->mineIds('secret-remark-text'));
        $this->assertSame([], $this->mineIds((string) $buyer->email));
    }

    public function test_a_claim_token_matches_only_once_the_order_is_paid_or_claimed(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $order = $this->order($buyer);
        Sanctum::actingAs($buyer);

        $this->assertSame([], $this->mineIds($order->claim_token), 'An unpaid order must not be found by its unreleased token.');

        foreach (['paid', 'claimed'] as $status) {
            $order->update(['status' => $status]);
            // The order changed behind the API, so drop the cached list the way an API write would.
            Cache::flush();
            $token = $order->fresh()->claim_token;
            $this->assertSame([$order->id], $this->mineIds($token));
        }
    }
}
