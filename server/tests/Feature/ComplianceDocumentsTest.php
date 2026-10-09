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
use Illuminate\Support\Facades\DB;
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
        $this->assertSame('letter.pdf', $event['file_name']);
        $this->assertSame('/events/'.$made['event']->id.'/submission/files/'.$made['file']->id, $event['open_url']);
        $this->assertSame($this->first->id, $event['academic_semester_id']);
        $this->assertNotNull($event['reviewed_at']);

        $report = $rows['financial_report'][0];
        $this->assertSame('September Financial Report', $report['item']);
        $this->assertSame('Monthly, Sep 1, 2026 to Sep 30, 2026', $report['parent_title']);
        $this->assertSame('submitted', $report['status']);
        $this->assertSame('/financial-reports/'.$made['report']->id.'/pdf', $report['open_url']);
        $this->assertSame($this->first->id, $report['academic_semester_id']);

        $supporting = $rows['financial_supporting_document']->sortBy('file_name')->values();
        $this->assertSame('bank.pdf', $supporting[0]['file_name']);
        $this->assertSame('bank.pdf', $supporting[0]['item']);
        $this->assertSame('September Financial Report', $supporting[0]['parent_title']);
        $this->assertSame('/financial-reports/'.$made['report']->id.'/documents/1', $supporting[0]['open_url']);
        $this->assertSame('/financial-reports/'.$made['report']->id.'/documents/0', $supporting[1]['open_url']);
        $this->assertSame('submitted', $supporting[0]['status']);

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
        $this->assertSame(['Done' => 'approved', 'With head' => 'submitted'], $head->pluck('status', 'item')->all());
    }

    public function test_an_orphaned_event_requirement_file_does_not_break_the_list(): void
    {
        $this->periods();
        $organization = $this->studentOrganization('Coding Club');
        $made = $this->documentsFor($organization, $this->submitter($organization));
        Sanctum::actingAs($this->director());

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

    public function test_each_source_is_capped_at_its_newest_rows(): void
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

        $response = $this->getJson('/api/compliance/documents?source=compliance&per_page=100')->assertOk();

        $this->assertSame(500, $response->json('total'));
        $this->assertSame('520.pdf', $response->json('data.0.file_name'));
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
}
