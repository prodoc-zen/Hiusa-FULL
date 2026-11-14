<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\ClearancePeriod;
use App\Models\ClearanceSignature;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ClearancePeriodEditTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId ?? Organization::factory(), 'account_status' => 'active']);
    }

    private function openPeriod(array $roles = ['organization', 'sao'], array $extra = []): int
    {
        return $this->postJson('/api/clearance-periods', array_merge([
            'academic_year' => '2026-2027', 'title' => 'Second Semester Clearance', 'required_roles' => $roles,
        ], $extra))->assertCreated()->json('id');
    }

    public function test_sync_adds_a_student_who_joined_after_the_period_opened_without_duplicates(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $early = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod();
        $this->assertDatabaseCount('clearance_signatures', 2);

        $late = $this->user('STUDENT', $organization->id);
        $this->assertDatabaseMissing('clearance_signatures', ['clearance_period_id' => $periodId, 'student_id' => $late->school_id]);

        $this->postJson("/api/clearance-periods/{$periodId}/sync")
            ->assertOk()
            ->assertJsonPath('students_added', 1)
            ->assertJsonPath('message', '1 student added to this clearance period.');

        foreach (['organization', 'sao'] as $role) {
            $this->assertDatabaseHas('clearance_signatures', ['clearance_period_id' => $periodId, 'student_id' => $late->school_id, 'organization_id' => $organization->id, 'required_role' => $role, 'status' => 'pending']);
        }
        $this->assertDatabaseCount('clearance_signatures', 4);
        $this->assertDatabaseHas('notifications', ['user_id' => $late->school_id, 'reference_type' => 'clearance_period', 'reference_id' => $periodId]);
        $this->assertSame(1, Notification::where('user_id', $early->school_id)->where('reference_type', 'clearance_period')->count());
        $this->assertDatabaseHas('audit_logs', ['module' => 'clearances', 'action' => 'clearance_period_students_added', 'record_id' => $periodId, 'user_id' => $superAdmin->school_id]);

        $this->postJson("/api/clearance-periods/{$periodId}/sync")
            ->assertOk()
            ->assertJsonPath('students_added', 0)
            ->assertJsonPath('message', 'Every active student is already in this clearance period.');
        $this->assertDatabaseCount('clearance_signatures', 4);
        $this->assertSame(1, AuditLog::where('action', 'clearance_period_students_added')->count());
    }

    public function test_sync_keeps_a_signed_line_untouched_and_is_super_admin_only_and_refused_once_closed(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod(['sao']);
        $line = ClearanceSignature::where('clearance_period_id', $periodId)->firstOrFail();
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'cleared'])->assertOk();
        $this->user('STUDENT', $organization->id);

        $this->postJson("/api/clearance-periods/{$periodId}/sync")->assertOk()->assertJsonPath('students_added', 1);
        $this->assertDatabaseHas('clearance_signatures', ['id' => $line->id, 'status' => 'cleared']);

        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'] as $role) {
            Sanctum::actingAs($this->user($role, $organization->id));
            $this->postJson("/api/clearance-periods/{$periodId}/sync")->assertForbidden();
        }

        Sanctum::actingAs($superAdmin);
        $this->postJson("/api/clearance-periods/{$periodId}/close")->assertOk();
        $this->user('STUDENT', $organization->id);
        $this->postJson("/api/clearance-periods/{$periodId}/sync")
            ->assertStatus(409)
            ->assertJsonPath('message', 'This clearance period is closed. Move its deadline to a later date to add students.');
        $this->assertDatabaseCount('clearance_signatures', 2);
    }

    public function test_the_title_description_and_deadline_can_be_edited_with_an_audit_row(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $this->user('STUDENT', Organization::factory()->create()->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod(['sao'], ['deadline_at' => '2027-03-01']);

        $this->patchJson("/api/clearance-periods/{$periodId}", [
            'title' => 'Final Clearance', 'description' => 'Bring your ID.', 'deadline_at' => '2027-04-15',
        ])->assertOk()->assertJsonPath('title', 'Final Clearance');

        $period = ClearancePeriod::findOrFail($periodId);
        $this->assertSame('Final Clearance', $period->title);
        $this->assertSame('Bring your ID.', $period->description);
        $this->assertSame('2027-04-15', $period->deadline_at->toDateString());
        $this->assertSame(['sao'], $period->required_roles);
        $this->assertDatabaseHas('audit_logs', ['module' => 'clearances', 'action' => 'clearance_period_updated', 'record_id' => $periodId, 'user_id' => $superAdmin->school_id]);

        $this->patchJson("/api/clearance-periods/{$periodId}", ['deadline_at' => null])->assertOk();
        $this->assertNull(ClearancePeriod::findOrFail($periodId)->deadline_at);
        $this->patchJson("/api/clearance-periods/{$periodId}", ['title' => ''])->assertStatus(422);
        $this->patchJson("/api/clearance-periods/{$periodId}", ['required_roles' => []])->assertStatus(422);
    }

    public function test_adding_a_required_role_gives_every_student_in_the_period_a_pending_line(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $inPeriod = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod(['sao']);
        $notYet = $this->user('STUDENT', $organization->id);

        $this->patchJson("/api/clearance-periods/{$periodId}", ['required_roles' => ['sao', 'department_head']])->assertOk();

        $this->assertDatabaseHas('clearance_signatures', ['clearance_period_id' => $periodId, 'student_id' => $inPeriod->school_id, 'organization_id' => $organization->id, 'required_role' => 'department_head', 'status' => 'pending']);
        $this->assertDatabaseMissing('clearance_signatures', ['clearance_period_id' => $periodId, 'student_id' => $notYet->school_id]);
        $this->assertDatabaseCount('clearance_signatures', 2);
        $this->assertSame(['sao', 'department_head'], ClearancePeriod::findOrFail($periodId)->required_roles);
    }

    public function test_a_role_nobody_has_signed_can_be_dropped_and_its_lines_go_with_it(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $this->user('STUDENT', Organization::factory()->create()->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod(['organization', 'sao']);

        $this->patchJson("/api/clearance-periods/{$periodId}", ['required_roles' => ['sao']])->assertOk();

        $this->assertDatabaseMissing('clearance_signatures', ['clearance_period_id' => $periodId, 'required_role' => 'organization']);
        $this->assertDatabaseHas('clearance_signatures', ['clearance_period_id' => $periodId, 'required_role' => 'sao']);
        $this->assertSame(['sao'], ClearancePeriod::findOrFail($periodId)->required_roles);
    }

    public function test_a_role_that_someone_already_signed_or_held_cannot_be_dropped(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod(['organization', 'sao']);
        $line = ClearanceSignature::where('clearance_period_id', $periodId)->where('required_role', 'organization')->firstOrFail();
        Sanctum::actingAs($admin);
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'held', 'remarks' => 'Unpaid dues.'])->assertOk();

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/clearance-periods/{$periodId}", ['title' => 'Renamed', 'required_roles' => ['sao']])
            ->assertStatus(409)
            ->assertJsonPath('message', 'The Organization role already has signed or held lines and cannot be removed.');

        $this->assertDatabaseHas('clearance_signatures', ['id' => $line->id, 'status' => 'held']);
        $this->assertSame(['organization', 'sao'], ClearancePeriod::findOrFail($periodId)->required_roles);
        $this->assertSame('Second Semester Clearance', ClearancePeriod::findOrFail($periodId)->title);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'clearance_period_updated']);
    }

    public function test_a_reopened_line_still_counts_as_signed_history(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $this->user('STUDENT', Organization::factory()->create()->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod(['sao']);
        $line = ClearanceSignature::where('clearance_period_id', $periodId)->firstOrFail();
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'cleared'])->assertOk();
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'pending', 'remarks' => 'Wrong student.'])->assertOk();

        $this->patchJson("/api/clearance-periods/{$periodId}", ['required_roles' => ['organization']])->assertStatus(409);
        $this->assertDatabaseHas('clearance_signatures', ['id' => $line->id, 'required_role' => 'sao']);
    }

    public function test_closing_a_period_sets_its_deadline_to_now_and_writes_an_audit_row(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $this->user('STUDENT', Organization::factory()->create()->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod(['sao'], ['deadline_at' => '2099-01-01']);

        $this->postJson("/api/clearance-periods/{$periodId}/close")->assertOk()->assertJsonPath('message', 'Clearance period closed.');

        $this->assertTrue(ClearancePeriod::findOrFail($periodId)->deadline_at->lte(now()));
        $this->assertDatabaseHas('audit_logs', ['module' => 'clearances', 'action' => 'clearance_period_closed', 'record_id' => $periodId, 'user_id' => $superAdmin->school_id]);
        $this->postJson("/api/clearance-periods/{$periodId}/close")->assertStatus(409)->assertJsonPath('message', 'This clearance period is already closed.');

        $this->patchJson("/api/clearance-periods/{$periodId}", ['deadline_at' => '2099-06-01'])->assertOk();
        $this->postJson("/api/clearance-periods/{$periodId}/sync")->assertOk();
    }

    public function test_only_super_admin_can_edit_or_close_a_period(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($superAdmin);
        $periodId = $this->openPeriod(['sao']);

        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'] as $role) {
            Sanctum::actingAs($this->user($role, $organization->id));
            $this->patchJson("/api/clearance-periods/{$periodId}", ['title' => 'Hijacked'])->assertForbidden();
            $this->postJson("/api/clearance-periods/{$periodId}/close")->assertForbidden();
        }
        $this->assertSame('Second Semester Clearance', ClearancePeriod::findOrFail($periodId)->title);
        $this->assertNull(ClearancePeriod::findOrFail($periodId)->deadline_at);
    }
}
