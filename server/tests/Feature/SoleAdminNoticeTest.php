<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\Collection;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An organization with one Admin cannot verify its own collections or approve its own cash advances, and the two
 * person check stays exactly as strict. The finance dashboard tells the screen how many Admins can act and who names
 * another, so the screen can say so in one line instead of leaving money at Pending.
 */
class SoleAdminNoticeTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create(['is_university_wide' => false]);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']);
    }

    public function test_the_dashboard_counts_one_admin_and_names_the_department_head(): void
    {
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/financial-dashboard')->assertOk()
            ->assertJsonPath('admin_count', 1)->assertJsonPath('second_admin_named_by', 'Department Head');
    }

    public function test_a_university_wide_organization_is_told_to_ask_the_sao(): void
    {
        $wide = Organization::factory()->create(['is_university_wide' => true]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $wide->id, 'account_status' => 'active']));

        $this->getJson('/api/financial-dashboard')->assertOk()
            ->assertJsonPath('admin_count', 1)->assertJsonPath('second_admin_named_by', 'SAO');
    }

    public function test_a_second_active_admin_makes_the_count_two(): void
    {
        User::factory()->admin()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']);
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/financial-dashboard')->assertOk()->assertJsonPath('admin_count', 2);
    }

    public function test_a_disabled_admin_is_not_counted(): void
    {
        User::factory()->admin()->create(['organization_id' => $this->organization->id, 'account_status' => 'inactive']);
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/financial-dashboard')->assertOk()->assertJsonPath('admin_count', 1);
    }

    public function test_an_officer_is_not_given_the_admin_count(): void
    {
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']));

        $this->getJson('/api/financial-dashboard')->assertOk()->assertJsonPath('admin_count', null);
    }

    public function test_the_two_person_check_is_unchanged_for_a_sole_admin(): void
    {
        $collection = Collection::create(['organization_id' => $this->organization->id, 'reference' => 'COL-ONE', 'source' => 'Dues', 'amount_collected' => '500.00', 'expected_amount' => 0, 'collected_by' => $this->admin->school_id, 'collected_at' => now(), 'status' => 'pending']);
        $advance = CashAdvance::create(['organization_id' => $this->organization->id, 'reference' => 'ADV-ONE', 'amount' => '300.00', 'purpose' => 'Event supplies', 'borrower_id' => $this->admin->school_id, 'status' => 'pending']);
        Sanctum::actingAs($this->admin);

        $this->patchJson("/api/collections/{$collection->id}/verify")->assertForbidden();
        $this->patchJson("/api/cash-advances/{$advance->id}/approve")->assertForbidden();
        $this->assertSame('pending', $collection->fresh()->status);
        $this->assertSame('pending', $advance->fresh()->status);
    }
}
