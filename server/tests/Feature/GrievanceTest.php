<?php

namespace Tests\Feature;

use App\Models\Grievance;
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
        $this->assertSame(1, \App\Models\Notification::where('reference_type', 'grievance')->where('reference_id', $grievanceId)->count());
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
}
