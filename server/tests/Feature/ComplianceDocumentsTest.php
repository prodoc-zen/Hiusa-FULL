<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ApprovalRequest;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ComplianceDocumentsTest extends TestCase
{
    use RefreshDatabase;

    private AcademicSemester $first;

    private AcademicSemester $second;

    private function periods(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $this->second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
    }

    private function studentOrganization(string $name, ?College $college = null, string $lifecycle = 'active'): Organization
    {
        return Organization::factory()->create([
            'name' => $name,
            'acronym' => strtoupper(substr($name, 0, 3)),
            'organization_type' => 'STUDENT_ORGANIZATION',
            'college_id' => $college?->id,
            'lifecycle_status' => $lifecycle,
        ]);
    }

    private function college(string $name): College
    {
        return College::create(['name' => $name, 'is_active' => true]);
    }

    private function collegeHead(College $college): User
    {
        $home = Organization::factory()->create([
            'name' => $college->name.' Office',
            'organization_type' => 'COLLEGE',
            'college_id' => $college->id,
            'lifecycle_status' => 'active',
        ]);

        return User::factory()->departmentHead()->create(['organization_id' => $home->id, 'account_status' => 'active']);
    }

    private function director(): User
    {
        $office = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'lifecycle_status' => 'active']);

        return User::factory()->superAdmin()->create(['organization_id' => $office->id, 'account_status' => 'active']);
    }

    private function submitter(Organization $organization): User
    {
        return User::factory()->admin()->create([
            'organization_id' => $organization->id,
            'first_name' => 'Ana',
            'last_name' => 'Reyes',
            'account_status' => 'active',
        ]);
    }

    /** One document per source for the organization, all in the first semester. */
    private function documentsFor(Organization $organization, User $submitter): array
    {
        $type = ComplianceRequirementType::create([
            'academic_year' => '2026-2027',
            'academic_semester_id' => $this->first->id,
            'name' => 'Letter of Intent',
            'deadline_at' => '2026-12-31 23:59:59',
            'is_active' => true,
            'created_by' => $submitter->school_id,
        ]);
        $submission = OrganizationComplianceSubmission::create([
            'organization_id' => $organization->id,
            'requirement_type_id' => $type->id,
            'status' => 'approved',
            'file_path' => 'compliance-submissions/'.$organization->id.'/loi.pdf',
            'file_original_name' => 'loi.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 1200,
            'submitted_by' => $submitter->school_id,
            'submitted_at' => '2026-09-01 08:00:00',
            'reviewed_by' => $submitter->school_id,
            'reviewed_at' => '2026-09-02 08:00:00',
        ]);

        $event = Event::factory()->create([
            'organization_id' => $organization->id,
            'academic_semester_id' => $this->first->id,
            'title' => 'Tech Summit',
            'created_by' => $submitter->school_id,
        ]);
        $requirement = EventRequirement::create([
            'name' => 'Request Letter',
            'venue_type' => 'on_campus',
            'academic_semester_id' => $this->first->id,
            'allowed_extensions' => ['pdf'],
            'is_active' => true,
            'is_optional' => false,
            'sort_order' => 1,
        ]);
        $file = EventRequirementFile::create([
            'event_id' => $event->id,
            'requirement_id' => $requirement->id,
            'organization_id' => $organization->id,
            'path' => 'event-requirements/'.$organization->id.'/'.$event->id.'/letter.pdf',
            'original_name' => 'letter.pdf',
            'uploaded_by' => $submitter->school_id,
        ]);
        $file->forceFill(['created_at' => '2026-09-10 08:00:00', 'updated_at' => '2026-09-10 08:00:00'])->save();
        ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'event',
            'entity_id' => $event->id,
            'requested_by' => $submitter->school_id,
            'required_role' => 'SUPER_ADMIN',
            'status' => 'rejected',
            'requested_at' => '2026-09-10 08:00:00',
            'reviewed_at' => '2026-09-11 08:00:00',
        ]);

        $report = FinancialReport::create([
            'organization_id' => $organization->id,
            'report_type' => 'monthly',
            'title' => 'September Financial Report',
            'period_start' => '2026-09-01',
            'period_end' => '2026-09-30',
            'submission_status' => 'pending_sao',
            'submitted_at' => '2026-09-20 08:00:00',
            'department_head_approved_at' => '2026-09-21 08:00:00',
            'generated_by' => $submitter->school_id,
            'supporting_documents' => [
                ['name' => 'receipts.pdf', 'path' => 'financial-reports/'.$organization->id.'/receipts.pdf', 'url' => 'x', 'mime_type' => 'application/pdf', 'size' => 10],
                ['name' => 'bank.pdf', 'path' => 'financial-reports/'.$organization->id.'/bank.pdf', 'url' => 'y', 'mime_type' => 'application/pdf', 'size' => 10],
            ],
        ]);

        return compact('submission', 'file', 'event', 'report');
    }

    public function test_documents_union_lists_every_source_with_the_normalized_shape(): void
    {
        $this->periods();
        $organization = $this->studentOrganization('Coding Club');
        $submitter = $this->submitter($organization);
        $made = $this->documentsFor($organization, $submitter);
        Sanctum::actingAs($this->director());

        $response = $this->getJson('/api/compliance/documents?organization_id='.$organization->id)->assertOk();

        $response->assertJsonStructure(['data', 'current_page', 'last_page', 'per_page', 'total']);
        $rows = collect($response->json('data'))->groupBy('source');
        $this->assertSame(5, $response->json('total'));
        $this->assertSame(['compliance', 'event_requirement', 'financial_report', 'financial_supporting_document'], $rows->keys()->sort()->values()->all());
        $this->assertCount(2, $rows['financial_supporting_document']);

        $compliance = $rows['compliance'][0];
        $this->assertSame(['id' => $organization->id, 'name' => 'Coding Club', 'acronym' => 'COD'], $compliance['organization']);
        $this->assertSame('Letter of Intent', $compliance['item']);
        $this->assertSame('2026-2027, Semester 1', $compliance['parent_title']);
        $this->assertSame('approved', $compliance['status']);
        $this->assertSame('semester_renewal', $compliance['family']);
        $this->assertSame('Ana Reyes', $compliance['submitted_by_name']);
        $this->assertNotNull($compliance['submitted_at']);
        $this->assertNotNull($compliance['reviewed_at']);
        $this->assertSame('loi.pdf', $compliance['file_name']);
        $this->assertSame('/compliance/submissions/'.$made['submission']->id.'/document', $compliance['open_url']);
        $this->assertSame($this->first->id, $compliance['academic_semester_id']);

        $event = $rows['event_requirement'][0];
        $this->assertSame('Request Letter', $event['item']);
        $this->assertSame('Tech Summit', $event['parent_title']);
        $this->assertSame('returned', $event['status']);
        $this->assertSame('sao', $event['stage']);
        $this->assertSame('event_requirement', $event['family']);
        $this->assertSame('letter.pdf', $event['file_name']);
        $this->assertSame('/events/'.$made['event']->id.'/submission/files/'.$made['file']->id, $event['open_url']);
        $this->assertSame($this->first->id, $event['academic_semester_id']);
        $this->assertNotNull($event['reviewed_at']);

        $report = $rows['financial_report'][0];
        $this->assertSame('September Financial Report', $report['item']);
        $this->assertSame('Monthly, Sep 1, 2026 to Sep 30, 2026', $report['parent_title']);
        $this->assertSame('under_review', $report['status']);
        $this->assertSame('sao', $report['stage']);
        $this->assertSame('/financial-reports/'.$made['report']->id.'/pdf?inline=1', $report['open_url']);
        $this->assertSame($this->first->id, $report['academic_semester_id']);

        $supporting = $rows['financial_supporting_document']->sortBy('file_name')->values();
        $this->assertSame('bank.pdf', $supporting[0]['file_name']);
        $this->assertSame('bank.pdf', $supporting[0]['item']);
        $this->assertSame('September Financial Report', $supporting[0]['parent_title']);
        $this->assertSame('/financial-reports/'.$made['report']->id.'/documents/1', $supporting[0]['open_url']);
        $this->assertSame('/financial-reports/'.$made['report']->id.'/documents/0', $supporting[1]['open_url']);
        $this->assertSame('under_review', $supporting[0]['status']);

        $submittedAt = collect($response->json('data'))->pluck('submitted_at')->all();
        $this->assertSame(collect($submittedAt)->sortDesc()->values()->all(), $submittedAt);
    }

    public function test_documents_filter_by_organization_semester_and_source(): void
    {
        $this->periods();
        $first = $this->studentOrganization('Coding Club');
        $second = $this->studentOrganization('Drama Guild');
        $this->documentsFor($first, $this->submitter($first));
        $secondSubmitter = $this->submitter($second);
        $secondType = ComplianceRequirementType::create([
            'academic_year' => '2026-2027',
            'academic_semester_id' => $this->second->id,
            'name' => 'List of Members',
            'deadline_at' => '2027-05-31 23:59:59',
            'is_active' => true,
            'created_by' => $secondSubmitter->school_id,
        ]);
        OrganizationComplianceSubmission::create([
            'organization_id' => $second->id,
            'requirement_type_id' => $secondType->id,
            'status' => 'submitted',
            'file_path' => 'compliance-submissions/'.$second->id.'/members.pdf',
            'file_original_name' => 'members.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 800,
            'submitted_by' => $secondSubmitter->school_id,
            'submitted_at' => '2027-02-01 08:00:00',
        ]);
        Sanctum::actingAs($this->director());

        $this->getJson('/api/compliance/documents')->assertOk()->assertJsonPath('total', 6);
        $this->getJson('/api/compliance/documents?organization_id='.$second->id)->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.item', 'List of Members');
        $this->getJson('/api/compliance/documents?academic_semester_id='.$this->second->id)->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.organization.name', 'Drama Guild');
        $this->getJson('/api/compliance/documents?academic_semester_id='.$this->first->id)->assertOk()->assertJsonPath('total', 5);
        $this->getJson('/api/compliance/documents?source=financial_supporting_document')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/compliance/documents?source=bogus')->assertUnprocessable();
    }

    public function test_draft_reports_are_not_listed_and_sao_only_sees_reports_the_department_head_approved(): void
    {
        $this->periods();
        $college = $this->college('College of Computing');
        $organization = $this->studentOrganization('Coding Club', $college);
        FinancialReport::create(['organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => 'Draft', 'submission_status' => 'draft']);
        FinancialReport::create(['organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => 'With head', 'submission_status' => 'pending_department_head', 'submitted_at' => '2026-09-20 08:00:00']);
        FinancialReport::create(['organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => 'Done', 'submission_status' => 'approved', 'submitted_at' => '2026-09-21 08:00:00', 'department_head_approved_at' => '2026-09-22 08:00:00']);

        Sanctum::actingAs($this->director());
        $sao = collect($this->getJson('/api/compliance/documents?source=financial_report')->assertOk()->assertJsonPath('total', 1)->json('data'));
        $this->assertSame(['Done' => 'approved'], $sao->pluck('status', 'item')->all());

        Sanctum::actingAs($this->collegeHead($college));
        $head = collect($this->getJson('/api/compliance/documents?source=financial_report')->assertOk()->assertJsonPath('total', 2)->json('data'));
        $this->assertSame(['Done' => 'approved', 'With head' => 'under_review'], $head->pluck('status', 'item')->all());
    }

    public function test_an_orphaned_event_requirement_file_does_not_break_the_list(): void
    {
        $this->periods();
        $organization = $this->studentOrganization('Coding Club');
        $admin = $this->submitter($organization);
        $made = $this->documentsFor($organization, $admin);
        Sanctum::actingAs($admin);

        if (DB::getDriverName() === 'sqlite') {
            DB::statement('PRAGMA defer_foreign_keys = ON');
        } else {
            DB::statement('SET FOREIGN_KEY_CHECKS=0');
        }
        DB::table('event_requirement_files')->where('id', $made['file']->id)->update(['event_id' => 999999, 'requirement_id' => 999999]);
        if (DB::getDriverName() !== 'sqlite') {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }

        $rows = collect($this->getJson('/api/compliance/documents?organization_id='.$organization->id.'&source=event_requirement')->assertOk()->json('data'));

        $this->assertCount(1, $rows);
        $this->assertNull($rows[0]['item']);
        $this->assertNull($rows[0]['parent_title']);
    }

    public function test_more_files_than_the_old_per_source_cap_are_all_reachable_by_paging(): void
    {
        $this->periods();
        $organization = $this->studentOrganization('Coding Club');
        $submitter = $this->submitter($organization);
        $now = now()->toDateTimeString();
        DB::table('compliance_requirement_types')->insert(collect(range(1, 520))->map(fn (int $number) => [
            'academic_year' => '2026-2027', 'academic_semester_id' => $this->first->id, 'name' => "Requirement {$number}",
            'deadline_at' => '2026-12-31 23:59:59', 'is_active' => true, 'created_by' => $submitter->school_id, 'created_at' => $now, 'updated_at' => $now,
        ])->all());
        $typeIds = ComplianceRequirementType::orderBy('id')->pluck('id')->values();
        DB::table('organization_compliance_submissions')->insert($typeIds->map(fn (int $typeId, int $index) => [
            'organization_id' => $organization->id, 'requirement_type_id' => $typeId, 'status' => 'submitted', 'file_path' => 'p/'.($index + 1).'.pdf',
            'file_original_name' => ($index + 1).'.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1, 'submitted_by' => $submitter->school_id,
            'submitted_at' => now()->subMinutes(1000 - $index)->toDateTimeString(), 'created_at' => $now, 'updated_at' => $now,
        ])->all());
        Sanctum::actingAs($this->director());

        $first = $this->getJson('/api/compliance/documents?source=compliance&per_page=100')->assertOk();
        $last = $this->getJson('/api/compliance/documents?source=compliance&per_page=100&page=6')->assertOk();

        $this->assertSame(520, $first->json('total'));
        $this->assertSame('520.pdf', $first->json('data.0.file_name'));
        $this->assertCount(20, $last->json('data'));
        $this->assertSame('1.pdf', $last->json('data.19.file_name'));
        $this->assertSame(520, $this->getJson('/api/compliance/documents?group=organization')->assertOk()->json('data.0.file_count'));
    }

    public function test_admin_sees_only_its_own_organization_and_gets_403_for_another(): void
    {
        $this->periods();
        $own = $this->studentOrganization('Coding Club');
        $other = $this->studentOrganization('Drama Guild');
        $admin = $this->submitter($own);
        $this->documentsFor($own, $admin);
        $this->documentsFor($other, $this->submitter($other));
        Sanctum::actingAs($admin);

        $this->getJson('/api/compliance/documents')->assertOk()->assertJsonPath('total', 5);
        $this->getJson('/api/compliance/documents?organization_id='.$own->id)->assertOk()->assertJsonPath('total', 5);
        $this->getJson('/api/compliance/documents?organization_id='.$other->id)->assertForbidden();
    }

    public function test_head_sees_only_its_college_and_gets_403_for_another_college(): void
    {
        $this->periods();
        $computing = $this->college('College of Computing');
        $arts = $this->college('College of Arts');
        $inCollege = $this->studentOrganization('Coding Club', $computing);
        $pending = $this->studentOrganization('Robotics Guild', $computing, 'pending');
        $elsewhere = $this->studentOrganization('Drama Guild', $arts);
        $this->documentsFor($inCollege, $this->submitter($inCollege));
        $pendingSubmitter = $this->submitter($pending);
        $registration = ComplianceRequirementType::create([
            'academic_year' => '2026-2027', 'academic_semester_id' => $this->first->id, 'name' => 'Letter of Intent',
            'deadline_at' => '2026-12-31 23:59:59', 'is_active' => true, 'created_by' => $pendingSubmitter->school_id,
        ]);
        OrganizationComplianceSubmission::create([
            'organization_id' => $pending->id, 'requirement_type_id' => $registration->id, 'status' => 'submitted',
            'file_path' => 'compliance-submissions/'.$pending->id.'/loi.pdf', 'file_original_name' => 'loi.pdf',
            'mime_type' => 'application/pdf', 'file_size' => 800, 'submitted_by' => $pendingSubmitter->school_id, 'submitted_at' => '2026-09-05 08:00:00',
        ]);
        $this->documentsFor($elsewhere, $this->submitter($elsewhere));
        Sanctum::actingAs($this->collegeHead($computing));

        $this->getJson('/api/compliance/documents')->assertOk()->assertJsonPath('total', 6);
        $this->getJson('/api/compliance/documents?organization_id='.$pending->id)->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/compliance/documents?organization_id='.$elsewhere->id)->assertForbidden();
    }

    public function test_officers_and_students_cannot_read_documents(): void
    {
        $organization = $this->studentOrganization('Coding Club');
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $organization->id]));
        $this->getJson('/api/compliance/documents')->assertForbidden();
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id]));
        $this->getJson('/api/compliance/documents')->assertForbidden();
    }

    public function test_documents_query_count_does_not_grow_with_the_row_count(): void
    {
        $this->periods();
        $first = $this->studentOrganization('Coding Club');
        $second = $this->studentOrganization('Drama Guild');
        $third = $this->studentOrganization('Chess Club');
        $this->documentsFor($first, $this->submitter($first));
        Sanctum::actingAs($this->director());
        $count = function (int $perPage): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson('/api/compliance/documents?per_page='.$perPage)->assertOk();

            return count(DB::getQueryLog());
        };

        $before = $count(100);
        $this->documentsFor($second, $this->submitter($second));
        $this->documentsFor($third, $this->submitter($third));

        $this->assertSame($before, $count(99));
    }

    public function test_documents_are_paginated_with_the_neighbor_envelope(): void
    {
        $this->periods();
        $organization = $this->studentOrganization('Coding Club');
        $this->documentsFor($organization, $this->submitter($organization));
        Sanctum::actingAs($this->director());

        $page = $this->getJson('/api/compliance/documents?per_page=2&page=2')->assertOk();

        $this->assertSame(2, $page->json('per_page'));
        $this->assertSame(5, $page->json('total'));
        $this->assertSame(3, $page->json('last_page'));
        $this->assertCount(2, $page->json('data'));
    }

    /** An event with one stored requirement file and the given approval rows, as [role => status]. */
    private function eventWithFile(Organization $organization, User $submitter, string $title, array $approvals, bool $approved = false): array
    {
        $event = Event::factory()->create([
            'organization_id' => $organization->id,
            'academic_semester_id' => $this->first->id,
            'title' => $title,
            'created_by' => $submitter->school_id,
        ]);
        if ($approved) {
            $event->forceFill(['approved_at' => '2026-09-15 08:00:00'])->save();
        }
        $requirement = EventRequirement::create([
            'name' => $title.' letter', 'venue_type' => 'on_campus', 'academic_semester_id' => $this->first->id,
            'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'sort_order' => 1,
        ]);
        $path = 'event-requirements/'.$organization->id.'/'.$event->id.'/letter.pdf';
        Storage::disk('local')->put($path, '%PDF-1.4 test');
        $file = EventRequirementFile::create([
            'event_id' => $event->id, 'requirement_id' => $requirement->id, 'organization_id' => $organization->id,
            'path' => $path, 'original_name' => 'letter.pdf', 'uploaded_by' => $submitter->school_id,
        ]);
        foreach ($approvals as $role => $status) {
            ApprovalRequest::create([
                'organization_id' => $organization->id, 'entity_type' => 'event', 'entity_id' => $event->id,
                'requested_by' => $submitter->school_id, 'required_role' => $role, 'status' => $status, 'requested_at' => '2026-09-10 08:00:00',
            ]);
        }

        return compact('event', 'file');
    }

    public function test_sao_never_lists_an_event_file_it_cannot_open_and_every_listed_file_opens(): void
    {
        Storage::fake('local');
        $this->periods();
        $college = $this->college('College of Computing');
        $organization = $this->studentOrganization('Coding Club', $college);
        $admin = $this->submitter($organization);
        $withHead = $this->eventWithFile($organization, $admin, 'Awaiting Head', ['DEPARTMENT_HEAD' => 'pending']);
        $this->eventWithFile($organization, $admin, 'Awaiting SAO', ['DEPARTMENT_HEAD' => 'approved', 'SUPER_ADMIN' => 'pending']);
        $this->eventWithFile($organization, $admin, 'Old Routing', ['SUPER_ADMIN' => 'pending']);
        $this->eventWithFile($organization, $admin, 'Cleared', ['DEPARTMENT_HEAD' => 'approved', 'SUPER_ADMIN' => 'approved'], approved: true);

        Sanctum::actingAs($this->director());
        $sao = collect($this->getJson('/api/compliance/documents?source=event_requirement')->assertOk()->assertJsonPath('total', 3)->json('data'));
        $this->assertEquals(['Cleared' => 'approved', 'Awaiting SAO' => 'under_review', 'Old Routing' => 'under_review'], $sao->pluck('status', 'parent_title')->all());
        $this->assertEquals(['Cleared' => null, 'Awaiting SAO' => 'sao', 'Old Routing' => 'sao'], $sao->pluck('stage', 'parent_title')->all());
        foreach ($sao as $row) {
            $response = $this->get('/api/'.ltrim($row['open_url'], '/'))->assertOk();
            $this->assertStringStartsWith('inline', $response->headers->get('Content-Disposition'));
        }
        $this->get('/api/events/'.$withHead['event']->id.'/submission/files/'.$withHead['file']->id)->assertNotFound();

        Sanctum::actingAs($this->collegeHead($college));
        $head = collect($this->getJson('/api/compliance/documents?source=event_requirement')->assertOk()->assertJsonPath('total', 4)->json('data'));
        $waiting = $head->firstWhere('parent_title', 'Awaiting Head');
        $this->assertSame(['under_review', 'department_head'], [$waiting['status'], $waiting['stage']]);
        foreach ($head as $row) {
            $this->get('/api/'.ltrim($row['open_url'], '/'))->assertOk();
        }
    }

    public function test_event_files_are_filtered_by_joins_and_an_event_with_two_sao_reviews_is_listed_once(): void
    {
        Storage::fake('local');
        $this->periods();
        $organization = $this->studentOrganization('Coding Club');
        $admin = $this->submitter($organization);
        $this->eventWithFile($organization, $admin, 'Resubmitted', ['DEPARTMENT_HEAD' => 'approved', 'SUPER_ADMIN' => 'returned']);
        ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'event', 'entity_id' => Event::where('title', 'Resubmitted')->value('id'),
            'requested_by' => $admin->school_id, 'required_role' => 'SUPER_ADMIN', 'status' => 'pending', 'requested_at' => '2026-09-12 08:00:00',
        ]);
        Sanctum::actingAs($this->director());
        $eventFileSql = [];
        DB::listen(function ($query) use (&$eventFileSql) {
            $sql = str_replace(['"', '`'], '', $query->sql);
            if (str_starts_with($sql, 'select') && str_contains($sql, 'event_requirement_files')) {
                $eventFileSql[] = $sql;
            }
        });

        $this->getJson('/api/compliance/documents?source=event_requirement&academic_semester_id='.$this->first->id)
            ->assertOk()->assertJsonPath('total', 1)->assertJsonCount(1, 'data');
        $this->getJson('/api/compliance/documents?group=organization&academic_semester_id='.$this->first->id)
            ->assertOk()->assertJsonPath('data.0.file_count', 1);

        $this->assertNotEmpty($eventFileSql);
        foreach ($eventFileSql as $sql) {
            $this->assertDoesNotMatchRegularExpression('/ in \(select/', $sql, 'event files were filtered by an IN subselect, which a large table plans as a block nested loop');
        }
    }

    public function test_a_rejected_event_names_who_returned_it(): void
    {
        Storage::fake('local');
        $this->periods();
        $organization = $this->studentOrganization('Coding Club');
        $admin = $this->submitter($organization);
        $this->eventWithFile($organization, $admin, 'Head Returned', ['DEPARTMENT_HEAD' => 'rejected']);
        $this->eventWithFile($organization, $admin, 'SAO Returned', ['DEPARTMENT_HEAD' => 'approved', 'SUPER_ADMIN' => 'rejected']);
        Sanctum::actingAs($admin);

        $rows = collect($this->getJson('/api/compliance/documents?source=event_requirement')->assertOk()->json('data'));

        $head = $rows->firstWhere('parent_title', 'Head Returned');
        $sao = $rows->firstWhere('parent_title', 'SAO Returned');
        $this->assertSame(['returned', 'department_head'], [$head['status'], $head['stage']]);
        $this->assertSame(['returned', 'sao'], [$sao['status'], $sao['stage']]);
    }

    private function complianceFile(Organization $organization, string $requirement, string $status): OrganizationComplianceSubmission
    {
        $submitter = User::where('organization_id', $organization->id)->first() ?? $this->submitter($organization);
        $type = ComplianceRequirementType::firstOrCreate(
            ['academic_year' => '2026-2027', 'academic_semester_id' => $this->first->id, 'name' => $requirement],
            ['deadline_at' => '2026-12-31 23:59:59', 'is_active' => true, 'created_by' => $submitter->school_id],
        );

        return OrganizationComplianceSubmission::create([
            'organization_id' => $organization->id, 'requirement_type_id' => $type->id, 'status' => $status,
            'file_path' => 'compliance-submissions/'.$organization->id.'/'.$type->id.'.pdf', 'file_original_name' => $requirement.'.pdf',
            'mime_type' => 'application/pdf', 'file_size' => 800, 'submitted_by' => $submitter->school_id, 'submitted_at' => '2026-09-05 08:00:00',
        ]);
    }

    public function test_compliance_files_are_grouped_into_registration_semestral_and_renewal_families(): void
    {
        $this->periods();
        $pending = $this->studentOrganization('Robotics Guild', null, 'pending');
        $returned = $this->studentOrganization('Chess Club', null, 'returned');
        $active = $this->studentOrganization('Coding Club');
        $this->complianceFile($pending, 'Letter of Intent', 'submitted');
        $this->complianceFile($returned, 'Letter of Intent', 'submitted');
        $this->complianceFile($active, 'Letter of Intent', 'submitted');
        $this->complianceFile($active, ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT, 'approved');
        Sanctum::actingAs($this->director());

        $rows = collect($this->getJson('/api/compliance/documents?source=compliance')->assertOk()->assertJsonPath('total', 4)->json('data'));
        $shape = fn (string $name, string $item) => collect($rows->first(fn (array $row) => $row['organization']['name'] === $name && $row['item'] === $item))
            ->only(['family', 'status', 'stage', 'organization_lifecycle_status'])->all();

        $this->assertSame(['family' => 'registration', 'organization_lifecycle_status' => 'pending', 'status' => 'under_review', 'stage' => 'sao'], $shape('Robotics Guild', 'Letter of Intent'));
        $this->assertSame(['family' => 'registration', 'organization_lifecycle_status' => 'returned', 'status' => 'returned', 'stage' => 'sao'], $shape('Chess Club', 'Letter of Intent'));
        $this->assertSame(['family' => 'semester_renewal', 'organization_lifecycle_status' => 'active', 'status' => 'under_review', 'stage' => 'sao'], $shape('Coding Club', 'Letter of Intent'));
        $this->assertSame(['family' => 'semestral_report', 'organization_lifecycle_status' => 'active', 'status' => 'approved', 'stage' => null], $shape('Coding Club', ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT));

        $this->getJson('/api/compliance/documents?family=registration')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/compliance/documents?family=semestral_report')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/compliance/documents?family=semester_renewal')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/compliance/documents?family=bogus')->assertUnprocessable();
    }

    public function test_review_queue_marks_registration_files_so_they_are_decided_in_the_organization_review(): void
    {
        $this->periods();
        $pending = $this->studentOrganization('Robotics Guild', null, 'pending');
        $active = $this->studentOrganization('Coding Club');
        $registration = $this->complianceFile($pending, 'Letter of Intent', 'submitted');
        $renewal = $this->complianceFile($active, 'Letter of Intent', 'submitted');
        Sanctum::actingAs($this->director());

        $queue = collect($this->getJson('/api/compliance/submissions?status=submitted')->assertOk()->assertJsonPath('total', 2)->json('data'));

        $this->assertTrue($queue->firstWhere('id', $registration->id)['is_registration']);
        $this->assertSame('pending', $queue->firstWhere('id', $registration->id)['organization']['lifecycle_status']);
        $this->assertFalse($queue->firstWhere('id', $renewal->id)['is_registration']);
    }

    public function test_documents_can_be_summarised_one_row_per_organization(): void
    {
        $this->periods();
        $computing = $this->college('College of Computing');
        $arts = $this->college('College of Arts');
        $first = $this->studentOrganization('Coding Club', $computing);
        $second = $this->studentOrganization('Drama Guild', $arts);
        $this->studentOrganization('Silent Club', $arts);
        $made = $this->documentsFor($first, $this->submitter($first));
        $this->complianceFile($second, 'List of Members', 'submitted');
        Sanctum::actingAs($this->director());

        $summary = $this->getJson('/api/compliance/documents?group=organization')->assertOk()->assertJsonPath('total', 2);

        $coding = collect($summary->json('data'))->firstWhere('organization.name', 'Coding Club');
        $this->assertSame(5, $coding['file_count']);
        $this->assertSame('College of Computing', $coding['organization']['college']);
        $this->assertSame($made['report']->submitted_at->getTimestamp(), Carbon::parse($coding['latest_submitted_at'])->getTimestamp());
        $this->assertSame('Coding Club', $summary->json('data.0.organization.name'));
        $this->assertSame('Drama Guild', $summary->json('data.1.organization.name'));

        $this->getJson('/api/compliance/documents?group=organization&search=drama')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.organization.name', 'Drama Guild');
        $this->getJson('/api/compliance/documents?group=organization&source=event_requirement')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.file_count', 1);
        $this->getJson('/api/compliance/documents?group=organization&per_page=1&page=2')->assertOk()->assertJsonPath('last_page', 2)->assertJsonCount(1, 'data');

        Sanctum::actingAs($this->collegeHead($arts));
        $this->getJson('/api/compliance/documents?group=organization')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.organization.name', 'Drama Guild');
    }

    public function test_registration_files_stay_registration_documents_after_the_sao_approves_the_organization(): void
    {
        $this->periods();
        Carbon::setTestNow('2026-09-10 12:00:00');
        $pending = $this->studentOrganization('Robotics Guild', null, 'pending');
        $pending->forceFill(['submitted_at' => '2026-09-04 09:00:00'])->save();
        $this->complianceFile($pending, 'Letter of Intent', 'submitted');
        $this->complianceFile($pending, ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT, 'submitted');
        Sanctum::actingAs($this->director());

        $this->patchJson('/api/system/organizations/'.$pending->id.'/review', ['decision' => 'approve', 'submitted_at' => '2026-09-04 09:00:00'])->assertOk();

        $later = $this->complianceFile($pending, 'List of Members', 'submitted');
        $later->forceFill(['submitted_at' => '2026-09-20 08:00:00'])->save();

        $families = fn (string $query = '') => collect($this->getJson('/api/compliance/documents?source=compliance&per_page=100'.$query)->assertOk()->json('data'))->pluck('family', 'item');
        $this->assertSame('active', $pending->fresh()->lifecycle_status);
        $this->assertEqualsCanonicalizing(['Letter of Intent' => 'registration', ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT => 'registration', 'List of Members' => 'semester_renewal'], $families()->all());
        $this->assertSame(['Letter of Intent', ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT], $families('&family=registration')->keys()->sort()->values()->all());
        $this->assertSame(['List of Members'], $families('&family=semester_renewal')->keys()->all());
        $this->getJson('/api/compliance/documents?group=organization&family=registration')->assertOk()->assertJsonPath('data.0.file_count', 2);
        $this->getJson('/api/compliance/documents?group=organization&family=semester_renewal')->assertOk()->assertJsonPath('data.0.file_count', 1);

        $queue = collect($this->getJson('/api/compliance/submissions?status=submitted')->assertOk()->json('data'));
        $this->assertFalse($queue->firstWhere('id', $later->id)['is_registration']);
        $approved = collect($this->getJson('/api/compliance/submissions?status=approved')->assertOk()->json('data'));
        $this->assertCount(2, $approved);
        $this->assertTrue($approved->every(fn (array $row) => $row['is_registration']));
        Carbon::setTestNow();
    }

    public function test_the_organization_summary_counts_exactly_what_the_file_list_shows_for_every_filter(): void
    {
        $this->periods();
        $computing = $this->college('College of Computing');
        $coding = $this->studentOrganization('Coding Club', $computing);
        $drama = $this->studentOrganization('Drama Guild');
        $robotics = $this->studentOrganization('Robotics Guild', null, 'pending');
        $chess = $this->studentOrganization('Chess Club');
        $chess->forceFill(['submitted_at' => '2026-09-01 08:00:00', 'reviewed_at' => '2026-09-06 08:00:00'])->save();
        $this->documentsFor($coding, $this->submitter($coding));
        $this->complianceFile($drama, 'List of Members', 'submitted');
        $this->complianceFile($robotics, 'Letter of Intent', 'submitted');
        $this->complianceFile($chess, 'Letter of Intent', 'approved');
        $this->complianceFile($chess, ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT, 'approved');
        $this->complianceFile($chess, 'Budget Plan', 'submitted')->forceFill(['submitted_at' => '2026-09-30 08:00:00'])->save();
        $submitter = $this->submitter($drama);
        FinancialReport::create([
            'organization_id' => $drama->id, 'report_type' => 'monthly', 'title' => 'February Financial Report', 'submission_status' => 'pending_sao',
            'submitted_at' => '2027-02-10 08:00:00', 'department_head_approved_at' => '2027-02-11 08:00:00', 'generated_by' => $submitter->school_id,
            'supporting_documents' => [['name' => 'receipts.pdf', 'path' => 'p', 'url' => 'x', 'mime_type' => 'application/pdf', 'size' => 10]],
        ]);
        $this->eventWithFile($drama, $submitter, 'Spring Fair', ['SUPER_ADMIN' => 'pending'])['event']->forceFill(['academic_semester_id' => $this->second->id])->save();
        Sanctum::actingAs($this->director());

        foreach (['', '&academic_semester_id='.$this->first->id, '&academic_semester_id='.$this->second->id, '&source=compliance', '&source=event_requirement&academic_semester_id='.$this->second->id,
            '&source=financial_report', '&source=financial_supporting_document', '&family=registration', '&family=semestral_report', '&family=semester_renewal',
            '&family=financial_supporting_document&academic_semester_id='.$this->second->id] as $query) {
            $listed = collect($this->getJson('/api/compliance/documents?per_page=100'.$query)->assertOk()->json('data'))->countBy('organization.name')->sortKeys()->all();
            $summarised = collect($this->getJson('/api/compliance/documents?group=organization&per_page=100'.$query)->assertOk()->json('data'))->pluck('file_count', 'organization.name')->sortKeys()->all();

            $this->assertSame($listed, $summarised, 'summary differs from the file list for ['.$query.']');
        }
    }

    public function test_a_page_reads_only_the_rows_it_needs_from_every_source(): void
    {
        $this->periods();
        foreach (['Coding Club', 'Drama Guild', 'Chess Club'] as $name) {
            $organization = $this->studentOrganization($name);
            $this->documentsFor($organization, $this->submitter($organization));
        }
        Sanctum::actingAs($this->director());
        $sources = [];
        DB::listen(function ($query) use (&$sources) {
            $sql = str_replace(['"', '`'], '', $query->sql);
            foreach (['organization_compliance_submissions', 'event_requirement_files', 'financial_reports'] as $table) {
                if (str_starts_with($sql, 'select') && str_contains($sql, "from {$table}") && str_contains($sql, 'order by')) {
                    $sources[$table] = $sql;
                }
            }
        });

        $page = $this->getJson('/api/compliance/documents?per_page=1')->assertOk();

        $this->assertSame(15, $page->json('total'));
        $this->assertCount(1, $page->json('data'));
        $this->assertCount(3, $sources);
        foreach ($sources as $table => $sql) {
            $this->assertStringContainsString(' limit ', $sql, "{$table} was read without a row limit");
        }
    }

    public function test_pages_walk_the_whole_list_in_the_same_order_for_every_filter(): void
    {
        $this->periods();
        foreach (['Coding Club', 'Drama Guild', 'Chess Club'] as $name) {
            $organization = $this->studentOrganization($name);
            $this->documentsFor($organization, $this->submitter($organization));
        }
        $this->complianceFile($this->studentOrganization('Robotics Guild', null, 'pending'), 'Letter of Intent', 'submitted');
        Sanctum::actingAs($this->director());

        foreach (['', '&academic_semester_id='.$this->first->id, '&academic_semester_id='.$this->second->id, '&source=compliance', '&family=registration',
            '&family=semester_renewal', '&source=financial_supporting_document', '&source=financial_report&academic_semester_id='.$this->first->id] as $query) {
            $whole = collect($this->getJson('/api/compliance/documents?per_page=100'.$query)->assertOk()->json('data'))->map(fn (array $row) => $row['open_url'])->all();
            $walked = [];
            foreach ([1, 2, 3, 4, 5, 6] as $page) {
                $walked = [...$walked, ...collect($this->getJson("/api/compliance/documents?per_page=3&page={$page}".$query)->assertOk()->json('data'))->map(fn (array $row) => $row['open_url'])->all()];
            }

            $this->assertSame($whole, $walked, 'paging differs from the whole list for ['.$query.']');
        }
    }

    public function test_a_window_deeper_than_the_cap_is_refused_instead_of_loaded(): void
    {
        Sanctum::actingAs($this->director());

        $this->getJson('/api/compliance/documents?per_page=100&page=20')->assertOk();
        $this->getJson('/api/compliance/documents?per_page=100&page=21')->assertUnprocessable();
        $this->getJson('/api/compliance/documents?per_page=100&page=21&group=organization')->assertOk();
    }

    public function test_malformed_query_parameters_are_refused_or_read_as_the_first_page(): void
    {
        Sanctum::actingAs($this->director());

        foreach (['per_page=0', 'per_page=101', 'per_page=abc', 'per_page[]=1', 'search[]=x', 'group=evil', 'family=evil', 'source=evil', 'organization_id=abc'] as $query) {
            $this->getJson("/api/compliance/documents?{$query}")->assertUnprocessable();
        }
        foreach (['page=abc', 'page=-5', 'page=99999999999999999999', 'page[]=1'] as $query) {
            $this->getJson("/api/compliance/documents?{$query}")->assertOk()->assertJsonPath('current_page', 1);
        }
        $this->getJson('/api/compliance/documents?search='.urlencode("%_'\"\\;--"))->assertOk();
    }
}
