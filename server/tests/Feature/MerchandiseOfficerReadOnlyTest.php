<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** An SBO officer opens the inventory page to read it: the list loads, and every merchandise write is refused. */
class MerchandiseOfficerReadOnlyTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private Merchandise $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->item = Merchandise::factory()->create(['organization_id' => $this->organization->id, 'is_active' => true]);
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $this->organization->id]));
    }

    public function test_an_officer_can_read_the_merchandise_list_and_the_gcash_settings(): void
    {
        $this->getJson('/api/merchandise')->assertOk();
        $this->getJson('/api/merchandise/gcash-settings')->assertOk();
    }

    public function test_an_officer_is_refused_on_every_merchandise_write_route(): void
    {
        $this->postJson('/api/merchandise', ['name' => 'Tote', 'price' => 100, 'stock_quantity' => 5])->assertForbidden();
        $this->putJson("/api/merchandise/{$this->item->id}", ['name' => 'Renamed'])->assertForbidden();
        $this->patchJson("/api/merchandise/{$this->item->id}/stock", ['quantity' => 5, 'note' => 'Restock'])->assertForbidden();
        $this->deleteJson("/api/merchandise/{$this->item->id}")->assertForbidden();
        $this->postJson('/api/merchandise/gcash-settings', [])->assertForbidden();
        $this->getJson("/api/merchandise/{$this->item->id}/audit-logs")->assertForbidden();

        $this->assertNotSame('Renamed', $this->item->fresh()->name);
        $this->assertNull($this->item->fresh()->deleted_at);
    }
}
