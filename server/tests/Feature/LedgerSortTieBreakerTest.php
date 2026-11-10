<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LedgerSortTieBreakerTest extends TestCase
{
    use RefreshDatabase;

    public function test_same_day_entries_are_listed_newest_first_by_id(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'ADMIN',
            'account_status' => 'active',
        ]);

        $ids = [];
        foreach (range(1, 5) as $n) {
            $ids[] = Transaction::create([
                'organization_id' => $organization->id,
                'recorded_by' => $admin->school_id,
                'type' => 'income',
                'category' => 'General',
                'description' => "Entry {$n}",
                'amount' => 10,
                'transaction_date' => '2026-11-01 00:00:00',
            ])->id;
        }

        Sanctum::actingAs($admin);

        $listed = collect($this->getJson('/api/transactions')->assertOk()->json('data'))->pluck('id')->all();

        $this->assertSame(array_reverse($ids), $listed);
    }
}
