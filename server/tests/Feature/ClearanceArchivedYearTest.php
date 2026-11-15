<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsurePeriodWritable;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ClearancePeriod;
use App\Models\ClearanceSignature;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/** A year label can be archived and added again; the archived year's clearance lines must not stay live beside the new year's. */
class ClearanceArchivedYearTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private User $director;

    private Organization $organization;

    private User $student;

    private AcademicYear $oldYear;

    protected function setUp(): void
    {
        parent::setUp();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $this->organization = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION']);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->oldYear = AcademicYear::create(['label' => '2024-2025', 'starts_on' => '2024-08-01', 'ends_on' => '2025-05-31', 'is_current' => true]);
        Sanctum::actingAs($this->director);
    }

    private function openPeriod(string $title, array $roles = ['sao']): int
    {
        return $this->postJson('/api/clearance-periods', ['academic_year' => '2024-2025', 'title' => $title, 'required_roles' => $roles])->assertCreated()->json('id');
    }

    private function archiveAndReAddLabel(): AcademicYear
    {
        $this->postJson("/api/system/academic-years/{$this->oldYear->id}/archive")->assertOk();

        return AcademicYear::findOrFail($this->postJson('/api/system/academic-years', ['label' => '2024-2025', 'starts_on' => '2024-08-01', 'ends_on' => '2025-05-31'])->assertCreated()->json('id'));
    }

    private function line(int $periodId, string $role = 'sao'): ClearanceSignature
    {
        return ClearanceSignature::where('clearance_period_id', $periodId)->where('student_id', $this->student->school_id)->where('required_role', $role)->firstOrFail();
    }

    public function test_a_period_of_an_archived_year_is_flagged_and_its_lines_are_read_only_while_the_new_years_period_stays_live(): void
    {
        $oldPeriod = $this->openPeriod('Old finals');
        $this->archiveAndReAddLabel();
        $newPeriod = $this->openPeriod('New finals');

        $listed = collect($this->getJson('/api/clearance-periods?per_page=100')->assertOk()->json('data'))->keyBy('id');
        $this->assertSame('2024-2025', $listed[$oldPeriod]['academic_year']);
        $this->assertSame('2024-2025', $listed[$newPeriod]['academic_year']);
        $this->assertTrue($listed[$oldPeriod]['archived']);
        $this->assertFalse($listed[$newPeriod]['archived']);

        $oldLine = $this->line($oldPeriod);
        $newLine = $this->line($newPeriod);
        foreach (['cleared', 'held'] as $status) {
            $this->patchJson("/api/clearance-signatures/{$oldLine->id}", ['status' => $status, 'remarks' => 'Late'])
                ->assertStatus(409)->assertJsonPath('message', EnsurePeriodWritable::CLOSED);
        }
        $this->assertSame('pending', $oldLine->fresh()->status);
        $this->assertSame(0, AuditLog::where('record_type', ClearanceSignature::class)->where('record_id', $oldLine->id)->count());

        $this->patchJson("/api/clearance-signatures/{$newLine->id}", ['status' => 'cleared'])->assertOk()->assertJsonPath('status', 'cleared');
    }

    public function test_a_line_cleared_before_the_archive_cannot_be_reopened_afterwards(): void
    {
        $oldPeriod = $this->openPeriod('Old finals');
        $oldLine = $this->line($oldPeriod);
        $this->patchJson("/api/clearance-signatures/{$oldLine->id}", ['status' => 'cleared'])->assertOk();
        $this->archiveAndReAddLabel();

        $this->patchJson("/api/clearance-signatures/{$oldLine->id}", ['status' => 'pending', 'remarks' => 'Reopen'])
            ->assertStatus(409)->assertJsonPath('message', EnsurePeriodWritable::CLOSED);
        $this->assertSame('cleared', $oldLine->fresh()->status);
    }

    public function test_archived_lines_leave_the_signing_queue_but_open_flagged_when_their_period_is_named(): void
    {
        $oldPeriod = $this->openPeriod('Old finals');
        $this->archiveAndReAddLabel();
        $newPeriod = $this->openPeriod('New finals');

        $queue = $this->getJson('/api/clearance-signatures?status=pending')->assertOk();
        $this->assertSame(1, $queue->json('total'));
        $this->assertSame($newPeriod, $queue->json('data.0.clearance_period_id'));
        $this->assertFalse($queue->json('data.0.archived'));

        $opened = $this->getJson("/api/clearance-signatures?clearance_period_id={$oldPeriod}")->assertOk();
        $this->assertSame(1, $opened->json('total'));
        $this->assertTrue($opened->json('data.0.archived'));
    }

    public function test_a_restored_year_makes_its_periods_live_again(): void
    {
        $oldPeriod = $this->openPeriod('Old finals');
        $this->postJson("/api/system/academic-years/{$this->oldYear->id}/archive")->assertOk();
        $this->assertTrue(ClearancePeriod::findOrFail($oldPeriod)->isInArchivedYear());

        $this->postJson("/api/system/academic-years/{$this->oldYear->id}/restore")->assertOk();

        $this->assertFalse(ClearancePeriod::findOrFail($oldPeriod)->isInArchivedYear());
        $this->patchJson('/api/clearance-signatures/'.$this->line($oldPeriod)->id, ['status' => 'cleared'])->assertOk();
    }

    public function test_the_dashboard_sao_clearance_count_skips_archived_lines(): void
    {
        $this->openPeriod('Old finals');
        $this->archiveAndReAddLabel();
        $this->openPeriod('New finals');

        $this->assertSame(2, ClearanceSignature::where('required_role', 'sao')->where('status', 'pending')->count());
        $item = collect($this->getJson('/api/dashboard/briefing')->assertOk()->json('attention'))->firstWhere('type', 'clearance_sao_pending');
        $this->assertSame(1, $item['count']);
    }

    public function test_the_audit_row_of_an_office_staff_signature_names_their_real_role(): void
    {
        $college = $this->makeCollege('COC');
        $home = $this->makeCollegeHome($college);
        $club = $this->makeCollegeStudentOrganization($college);
        $student = User::factory()->student()->create(['organization_id' => $club->id]);
        $staff = User::factory()->admin()->create(['organization_id' => $home->id, 'position_title' => 'College Secretary']);
        $periodId = $this->openPeriod('Finals', ['department_head']);
        $line = ClearanceSignature::where('clearance_period_id', $periodId)->where('student_id', $student->school_id)->firstOrFail();

        Sanctum::actingAs($staff);
        $this->patchJson("/api/clearance-signatures/{$line->id}", ['status' => 'cleared'])->assertOk();

        $audit = AuditLog::where('action', 'signature_cleared')->where('record_id', $line->id)->sole();
        $this->assertSame('ADMIN', $audit->actor_role);
        $this->assertSame($staff->school_id, $audit->user_id);
    }
}
