<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Grievance;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class GrievanceTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId ?? Organization::factory(), 'account_status' => 'active']);
    }

    protected function setUp(): void
    {
        parent::setUp();

        // phpunit.xml forces HIUSA_AI_SERVICE_ENABLED=false globally so every
        // AI call short-circuits to null before Http::fake(); re-enable it
        // here, mirroring AiFallbackParityTest.
        config([
            'services.hiusa_ai.enabled' => true,
            'services.hiusa_ai.url' => 'http://127.0.0.1:8001',
            'services.hiusa_ai.key' => 'grievance-test-key',
        ]);
    }

    public function test_student_files_grievance_against_own_organization_using_ai_classification(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/grievance-classification' => Http::response([
                'urgency' => 'Critical',
                'category' => 'Safety & Security',
                'confidence_score' => 0.95,
                'reasoning' => 'Harassment keyword detected.',
            ]),
        ]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);

        $response = $this->postJson('/api/grievances', [
            'title' => 'Harassment incident',
            'description' => 'A classmate was harassed near the guard post.',
            'addressed_to' => 'organization',
        ])->assertCreated();

        $response->assertJsonPath('category', 'Safety & Security')
            ->assertJsonPath('urgency', 'Critical')
            ->assertJsonPath('classification_engine', 'ai-service')
            ->assertJsonPath('organization_id', $organization->id)
            ->assertJsonPath('submitted_by', $student->school_id);

        $this->assertDatabaseHas('audit_logs', ['module' => 'grievances', 'action' => 'grievance_filed']);
        $this->assertDatabaseHas('notifications', ['user_id' => $superAdmin->school_id, 'reference_type' => 'grievance']);
        $this->assertDatabaseHas('notifications', ['user_id' => $admin->school_id, 'reference_type' => 'grievance']);
    }

    public function test_a_grievance_against_an_organization_notifies_an_admin_who_holds_the_role_only_through_a_profile(): void
    {
        Http::fake(['http://127.0.0.1:8001/*' => Http::response(['urgency' => 'Low', 'category' => 'Other', 'confidence_score' => 0.9, 'reasoning' => 'x'])]);
        $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $head = $this->user('STUDENT');
        AccountProfile::create(['user_school_id' => $head->school_id, 'organization_id' => $organization->id, 'role' => 'ADMIN', 'account_status' => 'active']);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);

        $id = $this->postJson('/api/grievances', [
            'title' => 'Fund concern',
            'description' => 'The organization did not account for the collected fees.',
            'addressed_to' => 'organization',
        ])->assertCreated()->json('id');

        $this->assertDatabaseHas('notifications', ['user_id' => $head->school_id, 'organization_id' => $organization->id, 'title' => 'New grievance filed against your organization', 'reference_id' => $id]);
    }

    public function test_organization_id_is_always_derived_never_accepted_from_input(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $otherOrganization = Organization::factory()->create();
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);

        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Suggestion',
            'description' => 'It would be nice to have more seating.',
            'addressed_to' => 'organization',
            'organization_id' => $otherOrganization->id,
        ])->assertCreated()->json('id');

        $this->assertSame($organization->id, Grievance::find($grievanceId)->organization_id);
    }

    public function test_grievance_addressed_directly_to_sao_has_no_organization_and_notifies_only_sao(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);

        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Direct concern',
            'description' => 'I want to raise this directly with the Student Affairs Office.',
            'addressed_to' => 'sao',
        ])->assertCreated()->json('id');

        $this->assertNull(Grievance::find($grievanceId)->organization_id);
        $this->assertSame(1, Notification::where('reference_type', 'grievance')->where('reference_id', $grievanceId)->count());
        $this->assertDatabaseHas('notifications', ['user_id' => $superAdmin->school_id, 'reference_type' => 'grievance', 'reference_id' => $grievanceId]);
    }

    public function test_classification_falls_back_to_php_engine_on_connection_error(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/grievance-classification' => fn () => throw new ConnectionException('Connection refused'),
        ]);
        $student = $this->user('STUDENT');
        Sanctum::actingAs($student);

        $this->postJson('/api/grievances', [
            'title' => 'Harassment near the guard post',
            'description' => 'A security guard threatened a student late at night; this feels unsafe.',
            'addressed_to' => 'sao',
        ])->assertCreated()
            ->assertJsonPath('classification_engine', 'php-fallback')
            ->assertJsonPath('urgency', 'Critical')
            ->assertJsonPath('category', 'Safety & Security');
    }

    public function test_php_fallback_rates_natural_wordings_of_serious_complaints_by_their_stems(): void
    {
        Http::fake(['*' => fn () => throw new ConnectionException('Connection refused')]);
        Sanctum::actingAs($this->user('STUDENT'));

        $this->postJson('/api/grievances', [
            'title' => 'I was harassed and threatened by an officer',
            'description' => 'He also assaulted a classmate after the meeting.',
            'addressed_to' => 'sao',
        ])->assertCreated()->assertJsonPath('classification_engine', 'php-fallback')->assertJsonPath('urgency', 'Critical');

        $this->postJson('/api/grievances', [
            'title' => 'The treasurer has been stealing',
            'description' => 'Our collections keep disappearing from the cash box.',
            'addressed_to' => 'sao',
        ])->assertCreated()->assertJsonPath('urgency', 'High')->assertJsonPath('category', 'Financial Integrity');
    }

    public function test_classification_falls_back_to_php_engine_on_401(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/grievance-classification' => Http::response(['detail' => 'Invalid AI service key'], 401),
        ]);
        $student = $this->user('STUDENT');
        Sanctum::actingAs($student);

        $this->postJson('/api/grievances', [
            'title' => 'Missing organization fund',
            'description' => 'The treasurer cannot account for a payment and the receipt is missing.',
            'addressed_to' => 'sao',
        ])->assertCreated()
            ->assertJsonPath('classification_engine', 'php-fallback')
            ->assertJsonPath('urgency', 'Medium')
            ->assertJsonPath('category', 'Financial Integrity');
    }

    public function test_only_student_role_can_file_a_grievance(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        Sanctum::actingAs($this->user('ADMIN'));

        $this->postJson('/api/grievances', [
            'title' => 'Test',
            'description' => 'Officers should not be able to file this.',
            'addressed_to' => 'sao',
        ])->assertForbidden();
    }

    public function test_anonymity_hides_identity_from_org_admin_but_not_from_sao_or_the_filer(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);

        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Confidential concern',
            'description' => 'This is a sensitive matter I want kept anonymous from my organization.',
            'addressed_to' => 'organization',
            'is_anonymous' => true,
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $adminView = $this->getJson("/api/grievances/{$grievanceId}")->assertOk()->json();
        $this->assertArrayNotHasKey('submitted_by', $adminView);
        $this->assertArrayNotHasKey('submitter', $adminView);

        Sanctum::actingAs($superAdmin);
        $saoView = $this->getJson("/api/grievances/{$grievanceId}")->assertOk()->json();
        $this->assertSame($student->school_id, $saoView['submitted_by']);

        Sanctum::actingAs($student);
        $studentView = $this->getJson("/api/grievances/{$grievanceId}")->assertOk()->json();
        $this->assertSame($student->school_id, $studentView['submitted_by']);
    }

    public function test_organization_b_admin_cannot_see_organization_a_grievance(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $studentA = $this->user('STUDENT', $orgA->id);
        $adminB = $this->user('ADMIN', $orgB->id);
        Sanctum::actingAs($studentA);

        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Org A concern',
            'description' => 'A concern only relevant to organization A.',
            'addressed_to' => 'organization',
        ])->assertCreated()->json('id');

        Sanctum::actingAs($adminB);
        $this->getJson("/api/grievances/{$grievanceId}")->assertStatus(404);
        $this->getJson('/api/grievances')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'under_review'])->assertForbidden();
    }

    public function test_student_only_sees_own_grievances_not_others_in_same_organization(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $organization = Organization::factory()->create();
        $studentA = $this->user('STUDENT', $organization->id);
        $studentB = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($studentA);
        $this->postJson('/api/grievances', ['title' => 'A', 'description' => 'Student A concern here.', 'addressed_to' => 'sao'])->assertCreated();

        Sanctum::actingAs($studentB);
        $this->getJson('/api/grievances')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_sao_resolves_grievance_with_remarks_and_notifies_the_filer(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $student = $this->user('STUDENT');
        Sanctum::actingAs($student);
        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Concern', 'description' => 'A concern needing SAO review.', 'addressed_to' => 'sao',
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'resolved'])->assertStatus(422);
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'resolved', 'remarks' => 'Addressed directly with the student.'])
            ->assertOk()->assertJsonPath('status', 'resolved');

        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'reference_type' => 'grievance', 'reference_id' => $grievanceId]);
        $this->assertNotNull(Grievance::find($grievanceId)->resolved_at);
    }

    public function test_the_filer_notification_names_the_status_in_plain_words(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $student = $this->user('STUDENT');
        Sanctum::actingAs($student);
        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Concern', 'description' => 'A concern needing SAO review.', 'addressed_to' => 'sao',
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'under_review'])->assertOk();

        $message = Notification::where('user_id', $student->school_id)->where('reference_type', 'grievance')
            ->where('title', 'Your grievance was updated')->value('message');
        $this->assertSame('Your grievance "Concern" is now under review.', $message);
    }

    public function test_grievance_module_audit_rows_carry_no_identity_and_are_hidden_from_admin_but_visible_to_super_admin(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);

        $this->postJson('/api/grievances', [
            'title' => 'Anonymous facility concern', 'description' => 'Anonymous concern about a broken facility.',
            'addressed_to' => 'organization', 'is_anonymous' => true,
        ])->assertCreated();
        $this->postJson('/api/grievances', [
            'title' => 'Named facility concern', 'description' => 'Named concern about a broken facility.',
            'addressed_to' => 'organization',
        ])->assertCreated();
        $this->postJson('/api/grievances', [
            'title' => 'Direct SAO concern', 'description' => 'A concern addressed directly to SAO.',
            'addressed_to' => 'sao',
        ])->assertCreated();

        Sanctum::actingAs($admin);
        $adminLogs = $this->getJson('/api/audit-logs?module=grievances')->assertOk()->json();
        $this->assertCount(0, $adminLogs['data']);
        $payload = json_encode($adminLogs);
        $this->assertStringNotContainsString((string) $student->school_id, $payload);
        $this->assertStringNotContainsString($student->email, $payload);
        $this->assertStringNotContainsString($student->first_name, $payload);

        Sanctum::actingAs($superAdmin);
        $saoLogs = $this->getJson('/api/audit-logs?module=grievances')->assertOk()->json();
        $this->assertCount(3, $saoLogs['data']);
    }

    public function test_org_admin_can_transition_a_grievance_addressed_to_their_own_organization(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);
        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Org concern', 'description' => 'A concern for the org admin to handle.', 'addressed_to' => 'organization',
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'under_review'])
            ->assertOk()->assertJsonPath('status', 'under_review');
    }

    public function test_only_super_admin_can_transition_a_grievance_addressed_directly_to_sao(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);
        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Direct SAO concern', 'description' => 'Only SAO should be able to act on this.', 'addressed_to' => 'sao',
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'under_review'])->assertForbidden();

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'under_review'])->assertOk();
    }

    public function test_anonymous_grievance_status_response_still_hides_filer_identity_from_org_admin(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);
        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Anonymous org concern', 'description' => 'This should stay anonymous to the org.',
            'addressed_to' => 'organization', 'is_anonymous' => true,
        ])->assertCreated()->json('id');

        Sanctum::actingAs($admin);
        $response = $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'under_review'])->assertOk()->json();
        $this->assertArrayNotHasKey('submitted_by', $response);
        $this->assertArrayNotHasKey('submitter', $response);
    }

    public function test_grievance_lifecycle_enforces_allowed_transitions_and_terminal_states(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $student = $this->user('STUDENT');
        Sanctum::actingAs($student);
        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Lifecycle test', 'description' => 'Testing status transitions end to end.', 'addressed_to' => 'sao',
        ])->assertCreated()->json('id');

        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'under_review'])->assertOk();
        // under_review -> under_review is not an allowed transition.
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'under_review'])->assertStatus(409);
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'dismissed', 'remarks' => 'Not applicable.'])->assertOk();
        // dismissed is terminal.
        $this->patchJson("/api/grievances/{$grievanceId}/status", ['status' => 'resolved', 'remarks' => 'Reopen attempt.'])->assertStatus(409);
    }

    public function test_grievance_filters_support_status_urgency_category_addressed_to_and_pagination(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);
        $this->postJson('/api/grievances', [
            'title' => 'Harassment concern', 'description' => 'Harassment near the guard post is unsafe.', 'addressed_to' => 'organization',
        ])->assertCreated();
        $this->postJson('/api/grievances', [
            'title' => 'SAO fraud concern', 'description' => 'Suspected fraud in fund handling, needs review.', 'addressed_to' => 'sao',
        ])->assertCreated();

        Sanctum::actingAs($superAdmin);
        $this->getJson('/api/grievances?addressed_to=sao')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/grievances?addressed_to=organization')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/grievances?urgency=Critical')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/grievances?category=Financial+Integrity')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/grievances?per_page=1')->assertOk()->assertJsonPath('per_page', 1)->assertJsonCount(1, 'data');
    }

    private function grievance(User $filer, array $overrides = []): Grievance
    {
        return Grievance::create($overrides + [
            'organization_id' => $filer->organization_id,
            'submitted_by' => $filer->school_id,
            'is_anonymous' => false,
            'title' => 'Leaking roof',
            'description' => 'The roof leaks in the org room.',
            'category' => 'Facilities & Maintenance',
            'urgency' => 'Low',
            'status' => 'submitted',
        ]);
    }

    public function test_filer_can_delete_own_unreviewed_grievance_and_its_notifications_are_removed(): void
    {
        Http::fake(['*' => Http::response(['error' => 'unavailable'], 503)]);
        $superAdmin = $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);
        $grievanceId = $this->postJson('/api/grievances', [
            'title' => 'Filed by mistake', 'description' => 'Wrong office entirely.', 'addressed_to' => 'organization',
        ])->assertCreated()->json('id');
        $this->assertDatabaseHas('notifications', ['user_id' => $superAdmin->school_id, 'reference_type' => 'grievance', 'reference_id' => $grievanceId]);
        $this->assertDatabaseHas('notifications', ['user_id' => $admin->school_id, 'reference_type' => 'grievance', 'reference_id' => $grievanceId]);

        $this->deleteJson("/api/grievances/{$grievanceId}")->assertOk()->assertExactJson(['message' => 'Grievance deleted.']);

        $this->assertDatabaseMissing('grievances', ['id' => $grievanceId]);
        $this->assertDatabaseMissing('notifications', ['reference_type' => 'grievance', 'reference_id' => $grievanceId]);
        $this->assertDatabaseHas('audit_logs', ['module' => 'grievances', 'action' => 'grievance_deleted', 'record_type' => Grievance::class, 'record_id' => $grievanceId, 'actor_role' => 'STUDENT', 'user_id' => null, 'organization_id' => null]);
    }

    public function test_filer_can_delete_an_anonymous_grievance_without_the_response_naming_them(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $grievance = $this->grievance($student, ['is_anonymous' => true]);
        Sanctum::actingAs($student);

        $response = $this->deleteJson("/api/grievances/{$grievance->id}")->assertOk();

        $this->assertStringNotContainsString((string) $student->school_id, $response->getContent());
        $this->assertDatabaseMissing('grievances', ['id' => $grievance->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'grievance_deleted', 'record_id' => $grievance->id, 'user_id' => null]);
    }

    public function test_another_student_cannot_delete_a_grievance_they_did_not_file(): void
    {
        $organization = Organization::factory()->create();
        $filer = $this->user('STUDENT', $organization->id);
        $other = $this->user('STUDENT', $organization->id);
        $grievance = $this->grievance($filer);
        Sanctum::actingAs($other);

        $this->deleteJson("/api/grievances/{$grievance->id}")->assertNotFound()->assertJsonPath('message', 'Grievance not found.');

        $this->assertDatabaseHas('grievances', ['id' => $grievance->id]);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'grievance_deleted']);
    }

    public function test_a_grievance_that_is_no_longer_submitted_cannot_be_deleted(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);

        foreach (['under_review', 'resolved', 'dismissed'] as $status) {
            $grievance = $this->grievance($student, ['status' => $status]);
            $this->deleteJson("/api/grievances/{$grievance->id}")
                ->assertStatus(409)
                ->assertJsonPath('message', 'Only grievances that have not been reviewed can be deleted.');
            $this->assertDatabaseHas('grievances', ['id' => $grievance->id, 'status' => $status]);
        }
        $this->assertDatabaseMissing('audit_logs', ['action' => 'grievance_deleted']);
    }

    public function test_reviewers_must_close_a_grievance_before_deleting_and_other_roles_cannot_delete(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $grievance = $this->grievance($student);

        foreach (['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] as $role) {
            Sanctum::actingAs($this->user($role, $organization->id));
            $this->deleteJson("/api/grievances/{$grievance->id}")
                ->assertStatus(in_array($role, ['SUPER_ADMIN', 'ADMIN'], true) ? 409 : 403);
        }
        $this->assertDatabaseHas('grievances', ['id' => $grievance->id]);
    }

    public function test_the_sao_can_reopen_a_closed_grievance_with_a_reason_and_the_student_is_told(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $sao = $this->user('SUPER_ADMIN');
        Sanctum::actingAs($sao);

        foreach (['resolved', 'dismissed'] as $closed) {
            $grievance = $this->grievance($student, ['organization_id' => null, 'status' => $closed, 'remarks' => 'Closed earlier.', 'resolved_at' => now()]);

            $this->patchJson("/api/grievances/{$grievance->id}/status", ['status' => 'under_review'])->assertStatus(422)->assertJsonValidationErrors('remarks');
            $this->assertSame($closed, $grievance->fresh()->status);

            $this->patchJson("/api/grievances/{$grievance->id}/status", ['status' => 'under_review', 'remarks' => 'The student sent new facts.'])
                ->assertOk()->assertJsonPath('status', 'under_review')->assertJsonPath('remarks', 'The student sent new facts.');

            $this->assertNull($grievance->fresh()->resolved_at);
            $this->assertDatabaseHas('audit_logs', ['module' => 'grievances', 'action' => 'grievance_reopened', 'record_id' => $grievance->id, 'user_id' => $sao->school_id, 'actor_role' => 'SUPER_ADMIN']);
            $message = Notification::where('user_id', $student->school_id)->where('reference_type', 'grievance')->where('reference_id', $grievance->id)->latest('id')->value('message');
            $this->assertStringContainsString('reopened', $message);
            $this->assertStringContainsString('The student sent new facts.', $message);
        }
    }

    public function test_only_the_sao_can_reopen_and_a_closed_grievance_cannot_jump_to_another_closed_state(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $grievance = $this->grievance($student, ['status' => 'resolved', 'remarks' => 'Done.', 'resolved_at' => now()]);

        Sanctum::actingAs($this->user('ADMIN', $organization->id));
        $this->patchJson("/api/grievances/{$grievance->id}/status", ['status' => 'under_review', 'remarks' => 'Trying to reopen.'])->assertStatus(409);

        Sanctum::actingAs($this->user('SUPER_ADMIN'));
        $this->patchJson("/api/grievances/{$grievance->id}/status", ['status' => 'dismissed', 'remarks' => 'Switching.'])->assertStatus(409);

        $this->assertSame('resolved', $grievance->fresh()->status);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'grievance_reopened']);
    }
}
