<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A Department Head can withdraw a registration of their own college while the SAO has not
 * approved it. Once an organization is active or archived it is kept, and one that already
 * owns accounts or records is never removed.
 */
class CollegeOrganizationWithdrawTest extends TestCase
{
    use RefreshDatabase;

    private College $ccs;

    private College $cbe;

    private User $director;

    private User $head;

    private User $otherHead;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->ccs = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $this->cbe = College::create(['name' => 'College of Business Education', 'code' => 'CBE']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]);
        $this->head = User::factory()->departmentHead()->create(['organization_id' => $this->homeOrganization($this->ccs)->id]);
        $this->otherHead = User::factory()->departmentHead()->create(['organization_id' => $this->homeOrganization($this->cbe)->id]);
    }

    private function homeOrganization(College $college): Organization
    {
        return Organization::factory()->create([
            'name' => $college->name,
            'college' => $college->name,
            'college_id' => $college->id,
            'organization_type' => 'COLLEGE',
        ]);
    }

    private function register(): int
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        Sanctum::actingAs($this->director);
        $semesterId = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31'])->assertCreated()->json('id');
        $this->patchJson("/api/system/academic-semesters/{$semesterId}/active")->assertOk();
        $typeIds = ComplianceRequirementType::where('academic_semester_id', $semesterId)->where('name', '!=', ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT)->pluck('id');

        Sanctum::actingAs($this->head);
        $organization = Organization::create([
            'name' => 'Robotics Guild', 'slug' => 'robotics-guild', 'acronym' => 'ROBO',
            'college_id' => $this->ccs->id, 'college' => $this->ccs->name,
            'organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'pending',
            'is_active' => false, 'submitted_by' => $this->head->school_id, 'submitted_at' => now(),
        ]);
        foreach ($typeIds as $id) {
            $path = "compliance-submissions/{$organization->id}/requirement-{$id}.pdf";
            Storage::disk('local')->put($path, '%PDF-1.4');
            OrganizationComplianceSubmission::create([
                'organization_id' => $organization->id, 'requirement_type_id' => $id,
                'status' => 'submitted', 'file_path' => $path, 'file_original_name' => "requirement-{$id}.pdf",
                'mime_type' => 'application/pdf', 'file_size' => 8,
                'submitted_by' => $this->head->school_id, 'submitted_at' => now(),
            ]);
        }

        return $organization->id;
    }

    public function test_head_withdraws_a_pending_registration_and_the_sao_is_told(): void
    {
        $id = $this->register();
        $paths = OrganizationComplianceSubmission::where('organization_id', $id)->pluck('file_path');
        $this->assertCount(10, $paths);
        $paths->each(fn ($path) => Storage::disk('local')->assertExists($path));

        $this->deleteJson("/api/college/organizations/{$id}")->assertOk();

        $this->assertDatabaseMissing('organizations', ['id' => $id]);
        $this->assertSame(0, OrganizationComplianceSubmission::where('organization_id', $id)->count());
        $paths->each(fn ($path) => Storage::disk('local')->assertMissing($path));
        $audit = AuditLog::where('action', 'organization_registration_withdrawn')->sole();
        $this->assertSame($this->head->school_id, (int) $audit->user_id);
        $this->assertSame($id, (int) $audit->record_id);
        $this->assertSame($this->head->organization_id, (int) $audit->organization_id);
        $this->assertSame(1, Notification::where('user_id', $this->director->school_id)->where('title', 'Organization registration withdrawn')->count());
    }

    public function test_head_withdraws_a_returned_registration_without_notifying_the_sao(): void
    {
        $id = $this->register();
        Organization::whereKey($id)->update(['lifecycle_status' => 'returned', 'review_remarks' => 'Missing signature']);

        $this->deleteJson("/api/college/organizations/{$id}")->assertOk();

        $this->assertDatabaseMissing('organizations', ['id' => $id]);
        $this->assertSame(0, Notification::where('title', 'Organization registration withdrawn')->count());
        $this->assertSame(1, AuditLog::where('action', 'organization_registration_withdrawn')->count());
    }

    public function test_active_and_archived_organizations_cannot_be_withdrawn(): void
    {
        foreach (['active', 'archived'] as $status) {
            $organization = Organization::factory()->create([
                'college' => $this->ccs->name,
                'college_id' => $this->ccs->id,
                'lifecycle_status' => $status,
                'is_active' => $status === 'active',
            ]);
            Sanctum::actingAs($this->head);

            $this->deleteJson("/api/college/organizations/{$organization->id}")
                ->assertConflict()
                ->assertJsonPath('message', 'Only a pending or returned registration can be withdrawn. Ask the SAO to archive an active organization.');
            $this->assertDatabaseHas('organizations', ['id' => $organization->id]);
        }
        $this->assertSame(0, AuditLog::where('action', 'organization_registration_withdrawn')->count());
    }

    public function test_another_colleges_organization_cannot_be_withdrawn(): void
    {
        $id = $this->register();

        Sanctum::actingAs($this->otherHead);
        $this->deleteJson("/api/college/organizations/{$id}")->assertNotFound();

        $this->assertDatabaseHas('organizations', ['id' => $id]);
    }

    public function test_an_organization_with_accounts_or_records_cannot_be_withdrawn(): void
    {
        foreach (['pending', 'returned'] as $status) {
            $withUser = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'lifecycle_status' => $status, 'is_active' => false]);
            User::factory()->create(['organization_id' => $withUser->id, 'role' => 'STUDENT']);
            $withEvent = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'lifecycle_status' => $status, 'is_active' => false]);
            Event::factory()->create(['organization_id' => $withEvent->id, 'created_by' => $this->head->school_id, 'status' => 'planning']);
            Sanctum::actingAs($this->head);

            foreach ([$withUser, $withEvent] as $organization) {
                $this->deleteJson("/api/college/organizations/{$organization->id}")
                    ->assertConflict()
                    ->assertJsonPath('message', 'This organization already has members, users or other records, so it cannot be withdrawn.');
                $this->assertDatabaseHas('organizations', ['id' => $organization->id]);
            }
        }
    }

    public function test_the_record_scan_is_limited_to_the_connections_own_schema(): void
    {
        $id = $this->register();
        $schema = DB::connection()->getSchemaBuilder();
        $tables = $schema->getTables();
        Schema::partialMock()->shouldReceive('getCurrentSchemaListing')->andReturn(['hiusa_app']);
        Schema::shouldReceive('getColumnListing')->andReturnUsing(fn (string $table) => $schema->getColumnListing($table));
        Schema::shouldReceive('getTables')->once()->with(['hiusa_app'])->andReturn($tables);

        $this->deleteJson("/api/college/organizations/{$id}")->assertOk();

        $this->assertDatabaseMissing('organizations', ['id' => $id]);
    }

    public function test_every_foreign_key_that_points_at_organizations_is_covered_by_the_record_scan(): void
    {
        $scanned = ['organization_id', 'parent_organization_id', 'source_organization_id'];
        $own = ['audit_logs', 'organization_compliance_submissions'];
        $uncovered = [];
        foreach (Schema::getTables() as $table) {
            foreach (Schema::getForeignKeys($table['name']) as $foreignKey) {
                if ($foreignKey['foreign_table'] !== 'organizations' || in_array($table['name'], $own, true)) {
                    continue;
                }
                foreach (array_diff($foreignKey['columns'], $scanned) as $column) {
                    $uncovered[] = "{$table['name']}.{$column}";
                }
            }
        }

        $this->assertSame([], $uncovered, 'a new foreign key to organizations is not checked before a registration is withdrawn');
    }

    public function test_only_a_department_head_can_use_the_withdraw_route(): void
    {
        $id = $this->register();

        Sanctum::actingAs($this->director);
        $this->deleteJson("/api/college/organizations/{$id}")->assertForbidden();

        $this->assertDatabaseHas('organizations', ['id' => $id]);
    }
}
