<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SetupChecklistTest extends TestCase
{
    use RefreshDatabase;

    private function checklistFor(User $user): array
    {
        Sanctum::actingAs($user);

        return $this->getJson('/api/dashboard/briefing')->assertOk()->json('setup');
    }

    private function steps(array $setup): array
    {
        return collect($setup['steps'])->keyBy('key')->all();
    }

    public function test_a_new_organization_admin_sees_every_step_open_with_working_links(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        $setup = $this->checklistFor($admin);
        $steps = $this->steps($setup);

        $this->assertSame(['positions', 'members', 'academic', 'budget', 'event'], array_keys($steps), 'No compliance step before the SAO publishes requirements.');
        $this->assertSame(0, $setup['completed']);
        $this->assertSame('/dashboard/admin/users', $steps['members']['href']);
        $this->assertSame('/dashboard/finance/budget-allocation', $steps['budget']['href']);
    }

    public function test_steps_check_themselves_off_from_real_records(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);
        Budget::factory()->create(['organization_id' => $organization->id]);
        DB::table('compliance_requirement_types')->insert(['academic_year' => '2026-2027', 'name' => 'Constitution and by-laws', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $admin->school_id, 'created_at' => now(), 'updated_at' => now()]);

        $setup = $this->checklistFor($admin);
        $steps = $this->steps($setup);

        $this->assertTrue($steps['positions']['done']);
        $this->assertNull($steps['positions']['href'], 'A finished step needs no link.');
        $this->assertTrue($steps['budget']['done']);
        $this->assertFalse($steps['compliance']['done']);
        $this->assertSame('/dashboard/compliance', $steps['compliance']['href']);
        $this->assertSame(2, $setup['completed']);
        $this->assertSame(6, $setup['total']);
    }

    public function test_the_sao_checklist_counts_organizations_without_an_administrator(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $withAdmin = Organization::factory()->create();
        Organization::factory()->create();
        User::factory()->admin()->create(['organization_id' => $withAdmin->id]);

        $steps = $this->steps($this->checklistFor($director));

        $this->assertTrue($steps['organizations']['done']);
        $this->assertFalse($steps['admins']['done']);
        $this->assertSame('1 of 2 organizations have an active administrator.', $steps['admins']['detail']);
        $this->assertSame('/dashboard/super-admin/admins', $steps['admins']['href']);
    }

    public function test_a_student_checklist_omits_evaluation_even_when_a_window_is_open(): void
    {
        $organization = Organization::factory()->create();
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active', 'contact_number' => '09171234567']);
        DB::table('evaluation_windows')->insert(['title' => 'First semester evaluation', 'status' => 'open', 'created_at' => now(), 'updated_at' => now()]);

        $steps = $this->steps($this->checklistFor($student));

        $this->assertSame(['contact', 'fingerprint', 'event'], array_keys($steps));
        $this->assertTrue($steps['contact']['done']);
        $this->assertNull($steps['fingerprint']['href'], 'Fingerprint enrollment happens in person, so there is nothing to link.');
        $this->assertSame('/dashboard/events/activity-calendar', $steps['event']['href']);
    }

    public function test_a_department_head_only_sees_steps_that_apply_to_the_role(): void
    {
        $organization = Organization::factory()->create();
        $head = User::factory()->create(['organization_id' => $organization->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active', 'contact_number' => null]);

        $steps = $this->steps($this->checklistFor($head));

        $this->assertSame(['contact'], array_keys($steps));
        $this->assertSame('/dashboard/profile', $steps['contact']['href']);
    }
}
