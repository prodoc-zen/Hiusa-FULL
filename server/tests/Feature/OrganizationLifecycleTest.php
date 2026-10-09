<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrganizationLifecycleTest extends TestCase
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

    /** Opens the registration set exactly as the SAO does: a semester with its ten renewal requirements, activated. */
    private function openSemester(): array
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        Sanctum::actingAs($this->director);
        $semesterId = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31'])->assertCreated()->json('id');
        $this->patchJson("/api/system/academic-semesters/{$semesterId}/active")->assertOk();

        return ComplianceRequirementType::where('academic_semester_id', $semesterId)->where('name', '!=', ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT)->pluck('id')->all();
    }

    private function pdfs(array $typeIds): array
    {
        return collect($typeIds)->mapWithKeys(fn ($id) => [$id => UploadedFile::fake()->create("requirement-{$id}.pdf", 120, 'application/pdf')])->all();
    }

    private function registrationPayload(array $typeIds, array $overrides = []): array
    {
        return [
            'name' => 'Robotics Guild',
            'acronym' => 'ROBO',
            'description' => 'Builds robots.',
            'color' => '#1A2B3C',
            'files' => $this->pdfs($typeIds),
            ...$overrides,
        ];
    }

    private function register(array $typeIds, array $overrides = []): int
    {
        Sanctum::actingAs($this->head);

        return $this->post('/api/college/organizations', $this->registrationPayload($typeIds, $overrides), ['Accept' => 'application/json'])->assertCreated()->json('id');
    }

    private function review(int $organizationId, array $payload): array
    {
        return $payload + ['submitted_at' => Organization::findOrFail($organizationId)->submitted_at->toIso8601String()];
    }

    public function test_head_registers_an_organization_which_starts_pending_and_inactive_in_the_heads_college(): void
    {
        $typeIds = $this->openSemester();
        $this->assertCount(10, $typeIds);
        Sanctum::actingAs($this->head);

        $response = $this->post('/api/college/organizations', $this->registrationPayload($typeIds, ['college_id' => $this->cbe->id, 'college' => 'Injected', 'lifecycle_status' => 'active', 'is_active' => true]), ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('lifecycle_status', 'pending')
            ->assertJsonPath('is_active', false)
            ->assertJsonPath('college_id', $this->ccs->id)
            ->assertJsonPath('college', $this->ccs->name);

        $organization = Organization::findOrFail($response->json('id'));
        $this->assertSame('STUDENT_ORGANIZATION', $organization->organization_type);
        $this->assertSame('robotics-guild', $organization->slug);
        $this->assertSame($this->head->school_id, (int) $organization->submitted_by);
        $this->assertNotNull($organization->submitted_at);
        $submissions = OrganizationComplianceSubmission::where('organization_id', $organization->id)->get();
        $this->assertCount(10, $submissions);
        foreach ($submissions as $submission) {
            $this->assertSame('submitted', $submission->status);
            $this->assertSame($this->head->school_id, (int) $submission->submitted_by);
            $this->assertMatchesRegularExpression('#^compliance-submissions/'.$organization->id.'/[0-9a-zA-Z._-]+\.pdf$#', $submission->file_path);
            $this->assertTrue(Storage::disk('local')->exists($submission->file_path));
            $this->assertFalse(Storage::disk('public')->exists($submission->file_path));
        }
        $this->assertDatabaseHas('audit_logs', ['action' => 'organization_registration_submitted', 'organization_id' => $organization->id, 'user_id' => $this->head->school_id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $this->director->school_id, 'reference_type' => 'organization', 'reference_id' => $organization->id]);
    }

    public function test_registration_set_is_the_ten_renewal_items_and_leaves_out_the_semestral_report(): void
    {
        $typeIds = $this->openSemester();
        Sanctum::actingAs($this->head);

        $names = collect($this->getJson('/api/college/organizations/requirements')->assertOk()->json('requirements'));

        $this->assertCount(10, $typeIds);
        $this->assertCount(10, $names);
        $this->assertNotContains(ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT, $names->pluck('name')->all());
    }

    public function test_registration_responses_never_expose_a_file_path_or_url(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);

        $body = $this->getJson('/api/college/organizations')->assertOk()->getContent();

        $this->assertStringNotContainsString('compliance-submissions', $body);
        $this->assertStringNotContainsString('file_path', $body);
        $this->assertSame(10, OrganizationComplianceSubmission::where('organization_id', $id)->count());
    }

    public function test_registration_requires_every_pdf_a_current_semester_and_unique_names(): void
    {
        Sanctum::actingAs($this->head);
        $this->post('/api/college/organizations', $this->registrationPayload([]), ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonPath('message', 'No registration requirements are open. The SAO must activate a semester first.');

        $typeIds = $this->openSemester();
        Sanctum::actingAs($this->head);
        $missing = $this->registrationPayload($typeIds);
        unset($missing['files'][$typeIds[3]]);
        $this->post('/api/college/organizations', $missing, ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors("files.{$typeIds[3]}");

        $notPdf = $this->registrationPayload($typeIds);
        $notPdf['files'][$typeIds[0]] = UploadedFile::fake()->image('scan.png');
        $this->post('/api/college/organizations', $notPdf, ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors("files.{$typeIds[0]}");

        $oversized = $this->registrationPayload($typeIds);
        $oversized['files'][$typeIds[1]] = UploadedFile::fake()->create('big.pdf', 10241, 'application/pdf');
        $this->post('/api/college/organizations', $oversized, ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors("files.{$typeIds[1]}");

        $this->assertDatabaseMissing('organizations', ['acronym' => 'ROBO']);
        $this->assertSame(0, OrganizationComplianceSubmission::count());

        $existing = Organization::factory()->create(['name' => 'Taken Name', 'slug' => 'taken-name', 'acronym' => 'TAKE']);
        $this->post('/api/college/organizations', $this->registrationPayload($typeIds, ['name' => 'Taken Name']), ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->post('/api/college/organizations', $this->registrationPayload($typeIds, ['acronym' => 'TAKE']), ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('acronym');
        $this->post('/api/college/organizations', $this->registrationPayload($typeIds, ['name' => 'taken-name']), ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->assertSame(1, Organization::where('id', $existing->id)->count());
    }

    public function test_head_endpoints_are_for_department_heads_and_scoped_to_their_college(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);
        $mine = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'lifecycle_status' => 'archived', 'is_active' => false]);
        $theirs = Organization::factory()->create(['college' => $this->cbe->name, 'college_id' => $this->cbe->id]);

        Sanctum::actingAs($this->head);
        $ids = collect($this->getJson('/api/college/organizations')->assertOk()->json('data'))->pluck('id');
        $this->assertEqualsCanonicalizing([$id, $mine->id], $ids->all());

        Sanctum::actingAs($this->otherHead);
        $this->assertSame([$theirs->id], collect($this->getJson('/api/college/organizations')->assertOk()->json('data'))->pluck('id')->all());
        Organization::whereKey($id)->update(['lifecycle_status' => 'returned']);
        $this->post("/api/college/organizations/{$id}", ['_method' => 'PUT', 'name' => 'Hijacked'], ['Accept' => 'application/json'])->assertNotFound();
        $this->assertSame('Robotics Guild', Organization::find($id)->name);

        foreach ([User::factory()->admin()->create(['organization_id' => $theirs->id]), $this->director] as $outsider) {
            Sanctum::actingAs($outsider);
            $this->getJson('/api/college/organizations')->assertForbidden();
            $this->getJson('/api/college/organizations/requirements')->assertForbidden();
            $this->post('/api/college/organizations', $this->registrationPayload($typeIds), ['Accept' => 'application/json'])->assertForbidden();
        }
    }

    public function test_head_list_shows_status_and_checklist_only_for_pending_and_returned_organizations(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);
        $active = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id]);
        Sanctum::actingAs($this->head);

        $rows = collect($this->getJson('/api/college/organizations')->assertOk()->json('data'))->keyBy('id');

        $pending = $rows[$id];
        $this->assertSame('pending', $pending['lifecycle_status']);
        $this->assertNotNull($pending['submitted_at']);
        $this->assertCount(10, $pending['registration_requirements']);
        $this->assertSame(['requirement_type_id', 'requirement_name', 'file_name', 'status', 'submission_id'], array_keys($pending['registration_requirements'][0]));
        $this->assertSame('submitted', $pending['registration_requirements'][0]['status']);
        $this->assertStringEndsWith('.pdf', $pending['registration_requirements'][0]['file_name']);
        $this->assertSame(0, $pending['members_count']);
        $this->assertNull($rows[$active->id]['registration_requirements']);

        $requirements = $this->getJson('/api/college/organizations/requirements')->assertOk();
        $this->assertCount(10, $requirements->json('requirements'));
        $this->assertSame(['id', 'name', 'description', 'deadline_at'], array_keys($requirements->json('requirements.0')));
        $this->assertSame(1, $requirements->json('academic_semester.number'));
    }

    public function test_a_pending_organizations_admin_cannot_sign_in_until_the_sao_approves_and_a_provisioned_admin_then_can(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);
        $waiting = User::factory()->admin()->create(['organization_id' => $id]);

        $this->postJson('/api/login', ['school_id' => $waiting->school_id, 'password' => 'password'])->assertUnprocessable();

        Sanctum::actingAs($this->director);
        $this->postJson('/api/system/admins', ['organization_id' => $id, 'school_id' => 20260001, 'first_name' => 'Ada', 'last_name' => 'Lovelace', 'email' => 'ada@example.test', 'password' => 'Secret@12345', 'password_confirmation' => 'Secret@12345'])
            ->assertStatus(409);

        $this->patchJson("/api/system/organizations/{$id}/review", $this->review($id, ['decision' => 'approve']))
            ->assertOk()->assertJsonPath('lifecycle_status', 'active')->assertJsonPath('is_active', true);

        $organization = Organization::findOrFail($id);
        $this->assertSame($this->director->school_id, (int) $organization->reviewed_by);
        $this->assertNotNull($organization->reviewed_at);
        $this->assertSame(10, OrganizationComplianceSubmission::where('organization_id', $id)->where('status', 'approved')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'organization_approved', 'organization_id' => $id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $this->head->school_id, 'reference_type' => 'organization', 'reference_id' => $id]);

        $this->postJson('/api/system/admins', ['organization_id' => $id, 'school_id' => 20260001, 'first_name' => 'Ada', 'last_name' => 'Lovelace', 'email' => 'ada@example.test', 'password' => 'Secret@12345', 'password_confirmation' => 'Secret@12345'])->assertCreated();
        $this->postJson('/api/login', ['school_id' => 20260001, 'password' => 'Secret@12345'])->assertOk()->assertJsonPath('user.role', 'ADMIN');
        $this->postJson('/api/login', ['school_id' => $waiting->school_id, 'password' => 'password'])->assertOk();
    }

    public function test_returned_registration_can_be_edited_and_resubmitted_back_to_pending(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);
        $oldPath = OrganizationComplianceSubmission::where('organization_id', $id)->where('requirement_type_id', $typeIds[2])->value('file_path');
        Sanctum::actingAs($this->head);
        $edit = ['_method' => 'PUT', 'name' => 'Robotics Guild Revised', 'description' => 'New description.', 'files' => [$typeIds[2] => UploadedFile::fake()->create('replacement.pdf', 90, 'application/pdf')]];

        $this->post("/api/college/organizations/{$id}", $edit, ['Accept' => 'application/json'])->assertStatus(409);

        Sanctum::actingAs($this->director);
        $this->patchJson("/api/system/organizations/{$id}/review", $this->review($id, ['decision' => 'return']))->assertUnprocessable()->assertJsonValidationErrors('remarks');
        $this->patchJson("/api/system/organizations/{$id}/review", $this->review($id, ['decision' => 'return', 'remarks' => 'Constitution is unsigned.']))
            ->assertOk()->assertJsonPath('lifecycle_status', 'returned')->assertJsonPath('review_remarks', 'Constitution is unsigned.')->assertJsonPath('is_active', false);
        $this->assertDatabaseHas('notifications', ['user_id' => $this->head->school_id, 'reference_type' => 'organization', 'reference_id' => $id]);

        Sanctum::actingAs($this->head);
        $this->getJson('/api/college/organizations')->assertOk()->assertJsonPath('data.0.review_remarks', 'Constitution is unsigned.')->assertJsonPath('data.0.registration_requirements.0.status', 'submitted');
        $this->post("/api/college/organizations/{$id}", $edit, ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('lifecycle_status', 'pending')->assertJsonPath('review_remarks', null)->assertJsonPath('name', 'Robotics Guild Revised');

        $organization = Organization::findOrFail($id);
        $this->assertSame('robotics-guild-revised', $organization->slug);
        $this->assertFalse($organization->is_active);
        $this->assertNull($organization->reviewed_at);
        $replaced = OrganizationComplianceSubmission::where('organization_id', $id)->where('requirement_type_id', $typeIds[2])->first();
        $this->assertSame('replacement.pdf', $replaced->file_original_name);
        $this->assertNotSame($oldPath, $replaced->file_path);
        $this->assertFalse(Storage::disk('local')->exists($oldPath));
        $this->assertTrue(Storage::disk('local')->exists($replaced->file_path));
        $this->assertSame(10, OrganizationComplianceSubmission::where('organization_id', $id)->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'organization_registration_resubmitted', 'organization_id' => $id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $this->director->school_id, 'title' => 'Organization registration resubmitted']);

        $this->post("/api/college/organizations/{$id}", ['_method' => 'PUT', 'name' => 'Again'], ['Accept' => 'application/json'])->assertStatus(409);
        $this->post("/api/college/organizations/{$id}", ['_method' => 'PUT', 'files' => [999999 => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf')]], ['Accept' => 'application/json'])->assertStatus(409);
    }

    public function test_head_cannot_edit_a_pending_or_active_organization(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);
        $active = Organization::factory()->create(['name' => 'Chess Club', 'college' => $this->ccs->name, 'college_id' => $this->ccs->id]);
        Sanctum::actingAs($this->head);

        $this->post("/api/college/organizations/{$id}", ['_method' => 'PUT', 'name' => 'Nope'], ['Accept' => 'application/json'])->assertStatus(409);
        $this->post("/api/college/organizations/{$active->id}", ['_method' => 'PUT', 'name' => 'Nope'], ['Accept' => 'application/json'])->assertStatus(409);

        $this->assertSame('Chess Club', $active->fresh()->name);
        $this->assertSame('Robotics Guild', Organization::find($id)->name);
    }

    public function test_resubmission_rejects_files_for_unknown_requirements_and_duplicate_names(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);
        Organization::factory()->create(['name' => 'Taken Name', 'slug' => 'taken-name', 'acronym' => 'TAKE']);
        Organization::whereKey($id)->update(['lifecycle_status' => 'returned', 'review_remarks' => 'Fix it.']);
        Sanctum::actingAs($this->head);

        $this->post("/api/college/organizations/{$id}", ['_method' => 'PUT', 'files' => [999999 => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf')]], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->post("/api/college/organizations/{$id}", ['_method' => 'PUT', 'name' => 'Taken Name'], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->post("/api/college/organizations/{$id}", ['_method' => 'PUT', 'name' => 'Robotics Guild', 'acronym' => 'ROBO'], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('lifecycle_status', 'pending');
    }

    public function test_review_is_sao_only_pending_only_and_refuses_a_stale_submission(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);
        $payload = $this->review($id, ['decision' => 'approve']);

        foreach ([$this->head, User::factory()->admin()->create(['organization_id' => $id])] as $outsider) {
            Sanctum::actingAs($outsider);
            $this->patchJson("/api/system/organizations/{$id}/review", $payload)->assertForbidden();
        }
        $this->assertSame('pending', Organization::find($id)->lifecycle_status);

        Sanctum::actingAs($this->director);
        $this->patchJson("/api/system/organizations/{$id}/review", ['decision' => 'approve'])->assertUnprocessable()->assertJsonValidationErrors('submitted_at');
        $this->patchJson("/api/system/organizations/{$id}/review", ['decision' => 'maybe', 'submitted_at' => $payload['submitted_at']])->assertUnprocessable()->assertJsonValidationErrors('decision');

        Organization::whereKey($id)->update(['submitted_at' => now()->addMinute()]);
        $this->patchJson("/api/system/organizations/{$id}/review", $payload)->assertStatus(409);
        $this->assertSame('pending', Organization::find($id)->lifecycle_status);
        $this->assertSame(0, OrganizationComplianceSubmission::where('organization_id', $id)->where('status', 'approved')->count());

        $this->patchJson("/api/system/organizations/{$id}/review", $this->review($id, ['decision' => 'approve']))->assertOk();
        $this->patchJson("/api/system/organizations/{$id}/review", $this->review($id, ['decision' => 'return', 'remarks' => 'Too late.']))->assertStatus(409);
        $this->assertSame('active', Organization::find($id)->lifecycle_status);
    }

    public function test_a_college_cannot_have_more_than_ten_registrations_waiting_for_review(): void
    {
        $typeIds = $this->openSemester();
        Organization::factory()->count(10)->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'lifecycle_status' => 'pending', 'is_active' => false]);
        Organization::factory()->count(3)->create(['college' => $this->cbe->name, 'college_id' => $this->cbe->id, 'lifecycle_status' => 'pending', 'is_active' => false]);
        Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'lifecycle_status' => 'returned', 'is_active' => false]);
        Sanctum::actingAs($this->head);

        $this->post('/api/college/organizations', $this->registrationPayload($typeIds), ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Too many registrations are waiting for SAO review. Wait for a decision before registering more.');
        $this->assertDatabaseMissing('organizations', ['name' => 'Robotics Guild']);

        Organization::where('college_id', $this->ccs->id)->where('lifecycle_status', 'pending')->first()->update(['lifecycle_status' => 'active']);
        $this->post('/api/college/organizations', $this->registrationPayload($typeIds), ['Accept' => 'application/json'])->assertCreated();

        Sanctum::actingAs($this->otherHead);
        $this->post('/api/college/organizations', $this->registrationPayload($typeIds, ['name' => 'Other Guild', 'acronym' => 'OTH']), ['Accept' => 'application/json'])->assertCreated();
    }

    public function test_a_failing_audit_write_rolls_back_review_archive_and_restore(): void
    {
        $typeIds = $this->openSemester();
        $pendingId = $this->register($typeIds);
        $active = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id]);
        $archived = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'lifecycle_status' => 'archived', 'is_active' => false]);
        $payload = $this->review($pendingId, ['decision' => 'approve']);
        Sanctum::actingAs($this->director);
        AuditLog::creating(fn () => throw new \RuntimeException('audit store unavailable'));

        $this->patchJson("/api/system/organizations/{$pendingId}/review", $payload)->assertStatus(500);
        $this->postJson("/api/system/organizations/{$active->id}/archive")->assertStatus(500);
        $this->postJson("/api/system/organizations/{$archived->id}/restore")->assertStatus(500);

        $this->assertSame('pending', Organization::find($pendingId)->lifecycle_status);
        $this->assertSame('active', $active->fresh()->lifecycle_status);
        $this->assertSame('archived', $archived->fresh()->lifecycle_status);
    }

    public function test_archiving_blocks_organization_writes_and_member_sign_in_and_restoring_reverses_it(): void
    {
        $organization = Organization::factory()->create(['name' => 'Chess Club', 'acronym' => 'CHESS', 'college' => $this->ccs->name, 'college_id' => $this->ccs->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id, 'position_title' => 'President']);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/organizations/{$organization->id}/archive", ['reason' => 'Dissolved.'])->assertOk()
            ->assertJsonPath('lifecycle_status', 'archived')->assertJsonPath('is_active', false);
        $archived = $organization->fresh();
        $this->assertNotNull($archived->archived_at);
        $this->assertSame($this->director->school_id, (int) $archived->archived_by);
        $this->assertSame('Dissolved.', AuditLog::where('action', 'organization_archived')->sole()->new_values['reason']);
        $this->postJson("/api/system/organizations/{$organization->id}/archive")->assertStatus(409);

        $this->putJson("/api/system/organizations/{$organization->id}", ['color' => '#123ABC'])->assertStatus(409);
        $this->post("/api/system/organizations/{$organization->id}/logo", ['logo' => UploadedFile::fake()->image('logo.png')], ['Accept' => 'application/json'])->assertStatus(409);
        $this->postJson('/api/system/admins', ['organization_id' => $organization->id, 'school_id' => 20260002, 'first_name' => 'Bo', 'last_name' => 'Peep', 'email' => 'bo@example.test', 'password' => 'Secret@12345', 'password_confirmation' => 'Secret@12345'])->assertStatus(409);
        $this->putJson("/api/system/admins/{$admin->school_id}", ['first_name' => 'Renamed'])->assertStatus(409);
        $this->postJson("/api/system/admins/{$admin->school_id}/handover", ['mode' => 'existing', 'successor_school_id' => $student->school_id])->assertStatus(409);
        $this->assertSame('ADMIN', $admin->fresh()->role);
        $this->assertSame('STUDENT', $student->fresh()->role);
        $this->assertSame($admin->first_name, $admin->fresh()->first_name);

        $this->postJson('/api/login', ['school_id' => $admin->school_id, 'password' => 'password'])->assertUnprocessable();
        $this->postJson('/api/login', ['school_id' => $student->school_id, 'password' => 'password'])->assertUnprocessable();

        $this->postJson("/api/system/organizations/{$organization->id}/restore")->assertOk()
            ->assertJsonPath('lifecycle_status', 'active')->assertJsonPath('is_active', true)->assertJsonPath('archived_at', null)->assertJsonPath('archived_by', null);
        $this->assertDatabaseHas('audit_logs', ['action' => 'organization_restored', 'organization_id' => $organization->id]);
        $this->postJson("/api/system/organizations/{$organization->id}/restore")->assertStatus(409);
        $this->putJson("/api/system/organizations/{$organization->id}", ['color' => '#123ABC'])->assertOk();
        $this->postJson('/api/login', ['school_id' => $admin->school_id, 'password' => 'password'])->assertOk();
    }

    public function test_archive_only_applies_to_active_student_organizations_and_restore_only_to_archived(): void
    {
        $typeIds = $this->openSemester();
        $pending = $this->register($typeIds);
        $home = Organization::where('organization_type', 'COLLEGE')->where('college_id', $this->ccs->id)->firstOrFail();
        $active = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id]);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/organizations/{$pending}/archive")->assertStatus(409);
        $this->postJson("/api/system/organizations/{$home->id}/archive")->assertStatus(409);
        $this->postJson('/api/system/organizations/'.Organization::where('slug', 'student-affairs-office')->value('id').'/archive')->assertStatus(409);
        $this->postJson("/api/system/organizations/{$active->id}/restore")->assertStatus(409);
        $this->postJson("/api/system/organizations/{$pending}/restore")->assertStatus(409);

        foreach ([$this->head, User::factory()->admin()->create(['organization_id' => $active->id]), User::factory()->student()->create(['organization_id' => $active->id])] as $outsider) {
            Sanctum::actingAs($outsider);
            $this->postJson("/api/system/organizations/{$active->id}/archive")->assertForbidden();
            $this->postJson("/api/system/organizations/{$active->id}/restore")->assertForbidden();
        }
        $this->assertSame('active', $active->fresh()->lifecycle_status);
    }

    public function test_sao_organization_list_filters_by_lifecycle_status_and_carries_lifecycle_fields(): void
    {
        $typeIds = $this->openSemester();
        $pending = $this->register($typeIds);
        $active = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id]);
        $archived = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'lifecycle_status' => 'archived', 'is_active' => false]);
        Sanctum::actingAs($this->director);

        $this->assertSame([$pending], collect($this->getJson('/api/system/organizations?lifecycle_status=pending')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$archived->id], collect($this->getJson('/api/system/organizations?lifecycle_status=archived')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertSame([$active->id], collect($this->getJson('/api/system/organizations?lifecycle_status=active')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertCount(3, $this->getJson('/api/system/organizations?lifecycle_status=all')->assertOk()->json('data'));
        $this->assertCount(2, $this->getJson('/api/system/organizations?status=inactive')->assertOk()->json('data'));
        $this->getJson('/api/system/organizations?lifecycle_status=bogus')->assertUnprocessable();

        $row = collect($this->getJson('/api/system/organizations')->assertOk()->json('data'))->firstWhere('id', $pending);
        $this->assertSame('pending', $row['lifecycle_status']);
        $this->assertSame($this->ccs->id, $row['college_id']);
        $this->assertNotNull($row['submitted_at']);
        $this->assertArrayHasKey('review_remarks', $row);
    }

    public function test_agency_overview_aggregates_colleges_organizations_and_lifecycle_totals(): void
    {
        $typeIds = $this->openSemester();
        $pending = $this->register($typeIds);
        $active = Organization::factory()->create(['name' => 'Chess Club', 'college' => $this->ccs->name, 'college_id' => $this->ccs->id]);
        $archived = Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'lifecycle_status' => 'archived', 'is_active' => false]);
        $business = Organization::factory()->create(['college' => $this->cbe->name, 'college_id' => $this->cbe->id]);
        $stray = Organization::factory()->create(['college_id' => null]);
        User::factory()->admin()->create(['organization_id' => $active->id]);
        User::factory()->officer()->count(2)->create(['organization_id' => $active->id]);
        User::factory()->student()->count(3)->create(['organization_id' => $active->id]);
        User::factory()->student()->create(['organization_id' => $active->id, 'account_status' => 'inactive']);
        $submitter = User::factory()->admin()->create(['organization_id' => $active->id]);
        ApprovalRequest::create(['organization_id' => $active->id, 'entity_type' => 'budget', 'entity_id' => 1, 'requested_by' => $submitter->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending']);
        ApprovalRequest::create(['organization_id' => $active->id, 'entity_type' => 'budget', 'entity_id' => 2, 'requested_by' => $submitter->school_id, 'required_role' => 'SUPER_ADMIN', 'status' => 'approved']);
        $type = ComplianceRequirementType::find($typeIds[0]);
        OrganizationComplianceSubmission::create(['organization_id' => $active->id, 'requirement_type_id' => $type->id, 'status' => 'submitted', 'file_path' => 'compliance-submissions/'.$active->id.'/x.pdf', 'file_original_name' => 'x.pdf', 'mime_type' => 'application/pdf', 'file_size' => 10, 'submitted_by' => $submitter->school_id, 'submitted_at' => now()]);
        Sanctum::actingAs($this->director);

        $response = $this->getJson('/api/system/agency')->assertOk();

        $this->assertSame(['pending' => 1, 'returned' => 0, 'active' => 3, 'archived' => 1], $response->json('totals.by_lifecycle_status'));
        $this->assertSame(5, $response->json('totals.organizations'));
        $this->assertSame(2, $response->json('totals.colleges'));
        $ccs = collect($response->json('colleges'))->firstWhere('id', $this->ccs->id);
        $this->assertSame(Organization::where('organization_type', 'COLLEGE')->where('college_id', $this->ccs->id)->value('id'), $ccs['home_organization_id']);
        $this->assertSame(3, $ccs['organizations_count']);
        $this->assertSame(['pending' => 1, 'returned' => 0, 'active' => 1, 'archived' => 1], $ccs['by_lifecycle_status']);
        $row = collect($ccs['organizations'])->firstWhere('id', $active->id);
        $this->assertSame(['STUDENT' => 3, 'SBO_OFFICER' => 2, 'ADMIN' => 2, 'total' => 7], $row['member_counts']);
        $this->assertSame(2, $row['administrators_count']);
        $this->assertSame(1, $row['pending_approvals_count']);
        $this->assertSame(1, $row['pending_documents_count']);
        $this->assertSame('incomplete', $row['accreditation_status']);
        $this->assertSame('active', $row['lifecycle_status']);
        $pendingRow = collect($ccs['organizations'])->firstWhere('id', $pending);
        $this->assertSame('pending', $pendingRow['lifecycle_status']);
        $this->assertSame(10, $pendingRow['pending_documents_count']);
        $this->assertSame(['STUDENT' => 0, 'SBO_OFFICER' => 0, 'ADMIN' => 0, 'total' => 0], $pendingRow['member_counts']);
        $this->assertSame([$business->id], collect(collect($response->json('colleges'))->firstWhere('id', $this->cbe->id)['organizations'])->pluck('id')->all());
        $this->assertSame([$stray->id], collect($response->json('unassigned_organizations'))->pluck('id')->all());

        foreach ([$this->head, $submitter] as $outsider) {
            Sanctum::actingAs($outsider);
            $this->getJson('/api/system/agency')->assertForbidden();
        }
    }

    public function test_organization_overview_is_a_read_only_snapshot_counting_only_approved_budgets(): void
    {
        $typeIds = $this->openSemester();
        $organization = Organization::factory()->create(['name' => 'Chess Club', 'acronym' => 'CHESS', 'college' => $this->ccs->name, 'college_id' => $this->ccs->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id, 'first_name' => 'Ada', 'last_name' => 'Lovelace', 'position_title' => 'Adviser']);
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id, 'first_name' => 'Bob', 'last_name' => 'Ross', 'position_title' => 'Treasurer']);
        User::factory()->student()->count(2)->create(['organization_id' => $organization->id]);
        foreach (range(1, 6) as $number) {
            Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => "Upcoming {$number}", 'start_time' => now()->addDays($number), 'end_time' => now()->addDays($number)->addHour(), 'status' => 'approved']);
            Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => "Past {$number}", 'start_time' => now()->subDays($number), 'end_time' => now()->subDays($number)->addHour(), 'status' => 'completed']);
        }
        $approved = Budget::factory()->create(['organization_id' => $organization->id, 'submission_status' => 'approved', 'allocated_amount' => 1000]);
        $approvedToo = Budget::factory()->create(['organization_id' => $organization->id, 'submission_status' => 'approved', 'allocated_amount' => 500]);
        $pendingBudget = Budget::factory()->create(['organization_id' => $organization->id, 'submission_status' => 'pending_sao', 'allocated_amount' => 9000]);
        Transaction::factory()->create(['organization_id' => $organization->id, 'budget_id' => $approved->id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'amount' => 300]);
        Transaction::factory()->create(['organization_id' => $organization->id, 'budget_id' => $approved->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'amount' => 200]);
        Transaction::factory()->create(['organization_id' => $organization->id, 'budget_id' => $approvedToo->id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'amount' => 100]);
        Transaction::factory()->create(['organization_id' => $organization->id, 'budget_id' => $pendingBudget->id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'amount' => 4000]);
        $type = ComplianceRequirementType::find($typeIds[0]);
        OrganizationComplianceSubmission::create(['organization_id' => $organization->id, 'requirement_type_id' => $type->id, 'status' => 'submitted', 'file_path' => 'compliance-submissions/'.$organization->id.'/x.pdf', 'file_original_name' => 'letter.pdf', 'mime_type' => 'application/pdf', 'file_size' => 10, 'submitted_by' => $admin->school_id, 'submitted_at' => now()]);
        $before = [Organization::count(), User::count(), Budget::count(), OrganizationComplianceSubmission::count()];
        Sanctum::actingAs($this->director);

        $response = $this->getJson("/api/system/organizations/{$organization->id}/overview")->assertOk();

        $this->assertSame([Organization::count(), User::count(), Budget::count(), OrganizationComplianceSubmission::count()], $before);
        $this->assertSame('Chess Club', $response->json('organization.name'));
        $this->assertSame('active', $response->json('lifecycle.status'));
        $this->assertNull($response->json('lifecycle.review_remarks'));
        $this->assertEqualsCanonicalizing([['school_id' => $admin->school_id, 'name' => 'Ada Lovelace', 'role' => 'ADMIN', 'position_title' => 'Adviser', 'account_status' => 'active'], ['school_id' => $officer->school_id, 'name' => 'Bob Ross', 'role' => 'SBO_OFFICER', 'position_title' => 'Treasurer', 'account_status' => 'active']], $response->json('leadership'));
        $this->assertSame(['STUDENT' => 2, 'SBO_OFFICER' => 1, 'ADMIN' => 1, 'total' => 4], $response->json('member_counts'));
        $this->assertCount(5, $response->json('events.upcoming'));
        $this->assertSame('Upcoming 1', $response->json('events.upcoming.0.title'));
        $this->assertCount(5, $response->json('events.recent'));
        $this->assertSame('Past 1', $response->json('events.recent.0.title'));
        $this->assertEquals(['approved_budget_count' => 2, 'allocated' => 1500, 'spent' => 400, 'income' => 200, 'remaining' => 1300], $response->json('budget'));
        $this->assertSame('incomplete', $response->json('compliance.accreditation_status'));
        $this->assertSame(1, $response->json('compliance.pending_documents_count'));
        $this->assertSame('letter.pdf', $response->json('documents.0.file_name'));
        $this->assertSame('submitted', $response->json('documents.0.status'));
        $this->assertSame($type->name, $response->json('documents.0.requirement_name'));
        $this->assertStringNotContainsString('compliance-submissions', $response->getContent());

        $this->getJson('/api/system/organizations/'.Organization::where('organization_type', 'COLLEGE')->value('id').'/overview')->assertNotFound();
        foreach ([$this->head, $admin] as $outsider) {
            Sanctum::actingAs($outsider);
            $this->getJson("/api/system/organizations/{$organization->id}/overview")->assertForbidden();
        }
    }

    public function test_overview_shows_pending_registration_lifecycle_details(): void
    {
        $typeIds = $this->openSemester();
        $id = $this->register($typeIds);
        Sanctum::actingAs($this->director);

        $response = $this->getJson("/api/system/organizations/{$id}/overview")->assertOk();

        $this->assertSame('pending', $response->json('lifecycle.status'));
        $this->assertSame($this->head->school_id, $response->json('lifecycle.submitted_by.school_id'));
        $this->assertNotNull($response->json('lifecycle.submitted_at'));
        $this->assertCount(10, $response->json('documents'));
        $this->assertSame(0, $response->json('budget.approved_budget_count'));
        $this->assertSame([], $response->json('events.upcoming'));
    }

    public function test_no_notification_is_sent_to_inactive_sao_accounts(): void
    {
        $typeIds = $this->openSemester();
        $dormant = User::factory()->superAdmin()->create(['organization_id' => $this->director->organization_id, 'account_status' => 'inactive']);

        $this->register($typeIds);

        $this->assertSame(0, Notification::where('user_id', $dormant->school_id)->count());
        $this->assertSame(1, Notification::where('user_id', $this->director->school_id)->where('title', 'New organization registration')->count());
    }
}
