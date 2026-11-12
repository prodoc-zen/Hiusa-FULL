<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A student who sends a returned application again changes only some files; the reviewer's earlier acceptances of the rest stand. */
class OrganizationApplicationCarryForwardTest extends TestCase
{
    use RefreshDatabase;

    private int $constitutionId;

    private int $letterId;

    private User $sao;

    private User $dean;

    private User $student;

    private OrganizationApplication $application;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $type = fn (string $name) => ComplianceRequirementType::create(['academic_year' => $year->label, 'academic_semester_id' => $semester->id, 'name' => $name, 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $this->sao->school_id])->id;
        $this->constitutionId = $type('Constitution');
        $this->letterId = $type('Adviser letter');

        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $this->dean = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $home->id]);
        $grant = OrganizationApplicantGrant::create(['college_id' => $college->id, 'user_school_id' => $this->student->school_id, 'granted_by' => $this->sao->school_id]);
        $this->application = OrganizationApplication::create([
            'college_id' => $college->id, 'name' => 'Computing Council', 'acronym' => 'CC', 'school_id' => $this->student->school_id, 'first_name' => $this->student->first_name,
            'last_name' => $this->student->last_name, 'email' => $this->student->email, 'position_title' => 'President', 'status' => 'pending_dean', 'round' => 1, 'submitted_at' => now(),
            'requires_documents' => true, 'required_documents_count' => 2,
        ]);
        foreach ([$this->constitutionId => 'constitution.pdf', $this->letterId => 'letter.pdf'] as $id => $name) {
            Storage::disk('local')->put("organization-applications/{$this->application->id}/{$name}", '%PDF-1.4');
            $this->application->documents()->create(['requirement_type_id' => $id, 'file_path' => "organization-applications/{$this->application->id}/{$name}", 'file_original_name' => $name, 'mime_type' => 'application/pdf', 'file_size' => 8]);
        }
        $grant->update(['used_application_id' => $this->application->id]);
    }

    private function review(array $payload)
    {
        return $this->patchJson("/api/organization-applications/{$this->application->id}/review", $payload);
    }

    private function show()
    {
        return $this->getJson("/api/organization-applications/{$this->application->id}");
    }

    /** The dean accepts the constitution and flags the letter; the student replaces the named files and sends it again. */
    private function returnedThenResent(array $replace, array $marks = ['ok', 'needs_changes'], string $actor = 'dean'): void
    {
        $this->travel(10)->minutes();
        Sanctum::actingAs($actor === 'dean' ? $this->dean : $this->sao);
        $this->review(['action' => 'return', 'remarks' => 'Please fix.', 'requirements' => [
            ['requirement_type_id' => $this->constitutionId, 'status' => $marks[0]],
            ['requirement_type_id' => $this->letterId, 'status' => $marks[1], 'note' => $marks[1] === 'ok' ? null : 'Fix it.'],
        ]])->assertOk()->assertJsonPath('status', 'returned');

        $this->travel(10)->minutes();
        Sanctum::actingAs($this->student);
        $files = collect($replace)->mapWithKeys(fn ($id) => [$id => UploadedFile::fake()->create("replacement-{$id}.pdf", 10, 'application/pdf')])->all();
        $this->post("/api/my/organization-applications/{$this->application->id}/resubmit", ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'President', 'files' => $files], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('status', 'pending_dean');
    }

    private function reviewsOf($response, int $requirementId): array
    {
        return collect($response->json('requirements'))->firstWhere('id', $requirementId)['reviews'];
    }

    public function test_the_first_round_starts_with_nothing_accepted(): void
    {
        Sanctum::actingAs($this->dean);
        $response = $this->show()->assertOk()->assertJsonPath('round', 1);
        $this->assertSame([], $this->reviewsOf($response, $this->constitutionId));
        $this->assertSame([], $this->reviewsOf($response, $this->letterId));
    }

    public function test_a_resent_application_arrives_with_the_unchanged_file_accepted_and_the_replaced_one_not_checked(): void
    {
        $this->returnedThenResent([$this->letterId]);

        Sanctum::actingAs($this->dean);
        $response = $this->show()->assertOk()->assertJsonPath('round', 2);
        $constitution = $this->reviewsOf($response, $this->constitutionId);
        $this->assertCount(1, $constitution);
        $this->assertSame(['stage' => 'dean', 'stage_label' => 'Department Head', 'status' => 'ok', 'note' => null, 'carried' => true], $constitution[0]);
        $this->assertSame([], $this->reviewsOf($response, $this->letterId));
        $this->assertSame(0, $this->application->requirementReviews()->where('round', 2)->count());
    }

    public function test_the_dean_endorses_in_one_step_once_the_replaced_file_is_accepted_and_the_server_still_checks_every_mark(): void
    {
        $this->returnedThenResent([$this->letterId]);

        Sanctum::actingAs($this->dean);
        $this->review(['action' => 'endorse', 'requirements' => [['requirement_type_id' => $this->constitutionId, 'status' => 'ok'], ['requirement_type_id' => $this->letterId, 'status' => 'needs_changes']]])
            ->assertUnprocessable()->assertJsonValidationErrors('requirements');
        $this->review(['action' => 'endorse', 'requirements' => [['requirement_type_id' => $this->constitutionId, 'status' => 'ok'], ['requirement_type_id' => $this->letterId, 'status' => 'ok']]])
            ->assertOk()->assertJsonPath('status', 'pending_sao');
        $this->assertSame(2, $this->application->requirementReviews()->where('round', 2)->where('stage', 'dean')->where('status', 'ok')->count());
    }

    public function test_a_replaced_file_is_never_carried_forward_even_if_it_was_accepted_before(): void
    {
        $this->returnedThenResent([$this->constitutionId], ['ok', 'ok']);

        Sanctum::actingAs($this->dean);
        $response = $this->show()->assertOk();
        $this->assertSame([], $this->reviewsOf($response, $this->constitutionId));
        $this->assertSame('ok', $this->reviewsOf($response, $this->letterId)[0]['status']);
        $this->assertTrue($this->reviewsOf($response, $this->letterId)[0]['carried']);
    }

    public function test_a_returned_requirement_is_not_carried_even_when_its_file_is_unchanged(): void
    {
        $this->returnedThenResent([]);

        Sanctum::actingAs($this->dean);
        $response = $this->show()->assertOk();
        $this->assertSame([], $this->reviewsOf($response, $this->letterId));
        $this->assertTrue($this->reviewsOf($response, $this->constitutionId)[0]['carried']);
    }

    public function test_a_file_the_sao_returned_and_the_student_sent_back_unchanged_is_not_carried_to_the_dean(): void
    {
        $this->travel(10)->minutes();
        Sanctum::actingAs($this->dean);
        $this->review(['action' => 'endorse', 'requirements' => [
            ['requirement_type_id' => $this->constitutionId, 'status' => 'ok'],
            ['requirement_type_id' => $this->letterId, 'status' => 'ok'],
        ]])->assertOk()->assertJsonPath('status', 'pending_sao');

        $this->travel(10)->minutes();
        Sanctum::actingAs($this->sao);
        $this->review(['action' => 'return', 'remarks' => 'Fix the constitution.', 'requirements' => [
            ['requirement_type_id' => $this->constitutionId, 'status' => 'needs_changes', 'note' => 'Fix it.'],
            ['requirement_type_id' => $this->letterId, 'status' => 'ok'],
        ]])->assertOk()->assertJsonPath('status', 'returned');

        $this->travel(10)->minutes();
        Sanctum::actingAs($this->student);
        $this->post("/api/my/organization-applications/{$this->application->id}/resubmit", ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'President', 'files' => []], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('status', 'pending_dean');

        Sanctum::actingAs($this->dean);
        $response = $this->show()->assertOk()->assertJsonPath('round', 2);
        $this->assertSame([], array_values(array_filter($this->reviewsOf($response, $this->constitutionId), fn ($review) => $review['stage'] === 'dean')));
        $letter = array_values(array_filter($this->reviewsOf($response, $this->letterId), fn ($review) => $review['stage'] === 'dean'));
        $this->assertCount(1, $letter);
        $this->assertTrue($letter[0]['carried']);
    }

    public function test_carried_marks_follow_the_reviewer_who_made_them_and_never_leak_to_the_applicant(): void
    {
        $this->returnedThenResent([$this->letterId]);
        Sanctum::actingAs($this->student);
        $this->getJson("/api/my/organization-applications/{$this->application->id}")->assertOk()->assertJsonPath('requirements.0.reviews', []);

        Sanctum::actingAs($this->dean);
        $this->review(['action' => 'endorse'])->assertOk()->assertJsonPath('status', 'pending_sao');
        $this->travel(10)->minutes();
        Sanctum::actingAs($this->sao);
        $this->review(['action' => 'return', 'remarks' => 'Fix the letter.', 'requirements' => [
            ['requirement_type_id' => $this->constitutionId, 'status' => 'ok'],
            ['requirement_type_id' => $this->letterId, 'status' => 'missing'],
        ]])->assertOk()->assertJsonPath('status', 'returned');

        $this->travel(10)->minutes();
        Sanctum::actingAs($this->student);
        $this->post("/api/my/organization-applications/{$this->application->id}/resubmit", ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'President', 'files' => [$this->letterId => UploadedFile::fake()->create('letter-v3.pdf', 10, 'application/pdf')]], ['Accept' => 'application/json'])->assertOk();
        Sanctum::actingAs($this->dean);
        $this->review(['action' => 'endorse'])->assertOk()->assertJsonPath('status', 'pending_sao');

        Sanctum::actingAs($this->sao);
        $response = $this->show()->assertOk()->assertJsonPath('round', 3);
        $constitution = $this->reviewsOf($response, $this->constitutionId);
        $this->assertSame(['dean', 'sao'], array_column($constitution, 'stage'));
        $this->assertSame([null, true], array_map(fn ($review) => $review['carried'] ?? null, $constitution));
        $this->assertSame(['dean'], array_column($this->reviewsOf($response, $this->letterId), 'stage'));
    }
}
