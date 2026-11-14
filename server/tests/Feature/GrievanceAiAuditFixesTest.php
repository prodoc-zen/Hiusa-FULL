<?php

namespace Tests\Feature;

use App\Http\Controllers\GrievanceController;
use App\Models\AuditLog;
use App\Models\Grievance;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionClassConstant;
use ReflectionMethod;
use Tests\TestCase;

class GrievanceAiAuditFixesTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create(['role' => $role, 'organization_id' => $organizationId ?? Organization::factory(), 'account_status' => 'active']);
    }

    private function grievance(User $filer, array $overrides = []): Grievance
    {
        $createdAt = $overrides['created_at'] ?? now();
        unset($overrides['created_at']);
        $grievance = Grievance::create($overrides + [
            'organization_id' => $filer->organization_id,
            'submitted_by' => $filer->school_id,
            'is_anonymous' => false,
            'title' => 'Leaking roof',
            'description' => 'The roof leaks in the org room.',
            'category' => 'Facilities & Maintenance',
            'urgency' => 'Low',
            'classification_confidence' => 0.5,
            'classification_reasoning' => 'No urgent or category words were found, so it is Low and General until a reviewer looks at it.',
            'classification_engine' => 'php-fallback',
            'status' => 'submitted',
        ]);
        $grievance->forceFill(['created_at' => $createdAt])->save();

        return $grievance;
    }

    private function classify(string $title, string $description = 'Details follow.'): array
    {
        $method = new ReflectionMethod(GrievanceController::class, 'localClassification');

        return $method->invoke(app(GrievanceController::class), $title, $description);
    }

    public function test_the_php_negators_equal_the_python_negators(): void
    {
        $python = str_replace("\r\n", "\n", file_get_contents(base_path('../ai-service/app/engines/grievance_classification.py')));
        $this->assertSame(1, preg_match('/^NEGATORS = \((.*?)\)$/ms', $python, $tuple));
        preg_match_all('/"([^"]+)"/u', $tuple[1], $words);

        $this->assertSame($words[1], (new ReflectionClassConstant(GrievanceController::class, 'NEGATORS'))->getValue());
    }

    public function test_the_fallback_reads_plural_and_inflected_wordings(): void
    {
        $this->assertSame('Financial Integrity', $this->classify('Our org funds and receipts are missing')['category']);
        $this->assertSame('Financial Integrity', $this->classify('The payments were never accounted for')['category']);

        $result = $this->classify('The teachers delayed releasing our grades and exams');
        $this->assertSame('Medium', $result['urgency']);
        $this->assertSame('Academic / Faculty', $result['category']);
        $this->assertSame('Marked Medium because the text mentions "delayed"; filed under Academic / Faculty because it mentions "grades", "teachers" and "exams".', $result['reasoning']);

        $this->assertSame('General', $this->classify('Example of a fundamental rule', 'The roommate asked about the exampled text.')['category']);
    }

    public function test_the_fallback_ignores_negated_urgency_words_but_not_a_real_one(): void
    {
        foreach ([['This is not an emergency', 'just a scheduling question'], ['Not urgent', 'Please advise when you can.'], ['Walang emergency', 'tanong lang po']] as [$title, $description]) {
            $result = $this->classify($title, $description);
            $this->assertSame('Low', $result['urgency'], $title);
            $this->assertNotSame('Safety & Security', $result['category'], $title);
        }

        $result = $this->classify('Not urgent, but the treasurer stole the funds');
        $this->assertSame('High', $result['urgency']);
        $this->assertSame('Marked High because the text mentions "stole"; filed under Financial Integrity because it mentions "funds" and "stole". It also mentions "urgent" after "not", which was not counted as urgent; a reviewer should check it.', $result['reasoning']);

        $this->assertSame('Critical', $this->classify('There is no excuse for this threat')['urgency']);
        $this->assertSame('Critical', $this->classify('I did not sleep. Emergency at the dorm')['urgency']);
    }

    /** @return array<string, array{string, string}> */
    public static function harmNextToANegator(): array
    {
        return array_map(null, [
            ['Officer', 'They did not stop bullying me even after I reported it.'],
            ['Officer conduct', 'The vice president would not stop harassing me after the meeting.'],
            ['No more bullying in our org', 'Please act on this.'],
            ['No response', 'Harassment by the treasurer during the meeting.'],
            ['Not again', 'Threatened by an officer at the venue.'],
            ['I can not take the bullying anymore', 'It happens every day.'],
            ['Help', 'He did not stop abusing me after the party.'],
            ['Not once did they stop the threats', 'Please help.'],
            ['No one helps me', 'The abuse continues every day.'],
            ['There is no way I can ignore the harassment', 'It is ongoing.'],
            ['Hindi tumitigil ang pagbabanta sa akin', 'Humihingi po ako ng tulong.'],
            ['Hindi na siya tumigil sa pananakit', 'Sinaktan niya ako ulit kahapon.'],
            ['Walang tigil ang pambu-bully', 'Binantaan niya ako ulit.'],
            ['Dili siya mohunong sa bullying nako', 'Gibantaan gyud ko niya.'],
            ['Wala siya mohunong sa pagbully', 'Gibantaan ko niya ug gisaktan.'],
        ]);
    }

    #[DataProvider('harmNextToANegator')]
    public function test_the_fallback_never_lowers_harm_described_next_to_a_negator(string $title, string $description): void
    {
        $this->assertSame('Critical', $this->classify($title, $description)['urgency']);
    }

    /** @return array<string, array{string, string}> */
    public static function directDenials(): array
    {
        return array_map(null, [
            ['There was no harassment', 'just a misunderstanding about the schedule'],
            ['This is not a danger to anyone', 'I only have a question'],
            ['Not any violence was reported', 'asking about the venue'],
            ['Hindi emergency ito', 'tanong lang po'],
            ['Dili emergency kini', 'pangutana lang'],
            ['Walay bullying nga nahitabo', 'pangutana lang'],
            ["Wala'y threat", 'pangutana lang'],
        ]);
    }

    #[DataProvider('directDenials')]
    public function test_the_fallback_lowers_urgency_for_a_direct_denial_and_says_so(string $title, string $description): void
    {
        $result = $this->classify($title, $description);

        $this->assertSame('Low', $result['urgency']);
        $this->assertStringContainsString('a reviewer should check it.', $result['reasoning']);
    }

    public function test_the_fallback_reasoning_names_the_denied_word(): void
    {
        $this->assertSame(
            'No urgent words were found, so it is Low; filed under Academic / Faculty because it mentions "scheduling". It also mentions "emergency" after "not", which was not counted as urgent; a reviewer should check it.',
            $this->classify('This is not an emergency', 'just a scheduling question')['reasoning'],
        );
    }

    public function test_the_fallback_files_theft_of_money_under_financial_integrity(): void
    {
        $result = $this->classify('Theft of money');

        $this->assertSame('High', $result['urgency']);
        $this->assertSame('Financial Integrity', $result['category']);
    }

    public function test_the_fallback_reasoning_names_the_matched_words_or_says_nothing_matched(): void
    {
        $this->assertSame(
            'Marked Critical because the text mentions "harassment" and "threatened"; filed under Safety & Security because it mentions "harassment", "threatened", "security" and "guard".',
            $this->classify('Harassment near the guard post', 'A security guard threatened a student.')['reasoning'],
        );
        $this->assertSame(
            'No urgent or category words were found, so it is Low and General until a reviewer looks at it.',
            $this->classify('Suggestion for the lounge', 'More seating would be nice.')['reasoning'],
        );
        $this->assertSame(
            'No urgent words were found, so it is Low; filed under Academic / Faculty because it mentions "grades".',
            $this->classify('Question about my grades')['reasoning'],
        );
        $this->assertSame(
            'Marked Medium because the text mentions "problem"; no category words were found, so it is filed under General.',
            $this->classify('There is a problem')['reasoning'],
        );
    }

    public function test_a_filed_grievance_stores_the_reasoning_that_names_its_words(): void
    {
        $this->user('SUPER_ADMIN');
        $student = $this->user('STUDENT');
        Sanctum::actingAs($student);

        $this->postJson('/api/grievances', ['title' => 'Theft of money', 'description' => 'Collections vanished.', 'addressed_to' => 'organization'])
            ->assertCreated()
            ->assertJsonPath('category', 'Financial Integrity')
            ->assertJsonPath('classification_reasoning', 'Marked High because the text mentions "theft"; filed under Financial Integrity because it mentions "money" and "theft".');
    }

    public function test_the_admin_notice_matches_whether_the_filer_is_anonymous(): void
    {
        $this->user('SUPER_ADMIN');
        $organization = Organization::factory()->create();
        $admin = $this->user('ADMIN', $organization->id);
        $student = $this->user('STUDENT', $organization->id);
        Sanctum::actingAs($student);

        $this->postJson('/api/grievances', ['title' => 'Broken chair', 'description' => 'It is broken.', 'addressed_to' => 'organization', 'is_anonymous' => true])->assertCreated();
        $this->postJson('/api/grievances', ['title' => 'Broken desk', 'description' => 'It is broken.', 'addressed_to' => 'organization', 'is_anonymous' => false])->assertCreated();

        $messages = Notification::where('user_id', $admin->school_id)->orderBy('id')->pluck('message')->all();
        $this->assertStringContainsString('The student chose to stay anonymous to your organization.', $messages[0]);
        $this->assertStringNotContainsString('name is shown', $messages[0]);
        $this->assertStringContainsString("The student's name is shown on the grievance.", $messages[1]);
        $this->assertStringNotContainsString('confidential', $messages[1]);
    }

    public function test_sorting_by_urgency_orders_the_whole_result_set_and_keeps_scope(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $other = $this->user('STUDENT');
        $oldest = $this->grievance($student, ['urgency' => 'Medium', 'created_at' => now()->subDays(9)]);
        $oldCritical = $this->grievance($student, ['urgency' => 'Critical', 'created_at' => now()->subDays(5)]);
        $this->grievance($student, ['urgency' => 'Low', 'created_at' => now()->subDays(1)]);
        $this->grievance($student, ['urgency' => 'Low', 'created_at' => now()]);
        $high = $this->grievance($student, ['urgency' => 'High', 'created_at' => now()->subDays(3)]);
        $foreignCritical = $this->grievance($other, ['urgency' => 'Critical']);

        Sanctum::actingAs($this->user('SUPER_ADMIN'));
        $first = $this->getJson('/api/grievances?sort=urgency&per_page=2')->assertOk();
        $this->assertSame([$foreignCritical->id, $oldCritical->id], array_column($first->json('data'), 'id'));
        $this->assertSame($high->id, $this->getJson('/api/grievances?sort=urgency&per_page=2&page=2')->json('data.0.id'));

        Sanctum::actingAs($this->user('ADMIN', $organization->id));
        $ids = array_column($this->getJson('/api/grievances?sort=urgency')->assertOk()->json('data'), 'id');
        $this->assertSame($oldCritical->id, $ids[0]);
        $this->assertNotContains($foreignCritical->id, $ids);
        $this->assertCount(5, $ids);

        Sanctum::actingAs($student);
        $this->assertSame($oldCritical->id, $this->getJson('/api/grievances?sort=urgency')->json('data.0.id'));

        Sanctum::actingAs($this->user('SUPER_ADMIN'));
        $least = $this->getJson('/api/grievances?sort=urgency&direction=desc&per_page=2')->assertOk();
        $this->assertSame('Low', $least->json('data.0.urgency'));
        $this->assertSame([$oldest->id], array_column($this->getJson('/api/grievances?sort=created_at&direction=asc&per_page=1')->json('data'), 'id'));
        $this->getJson('/api/grievances?sort=bogus')->assertUnprocessable();
        $this->getJson('/api/grievances?direction=sideways')->assertUnprocessable();
    }

    public function test_the_critical_tile_count_filters_urgency_and_a_json_list_of_open_statuses(): void
    {
        $student = $this->user('STUDENT');
        $this->grievance($student, ['urgency' => 'Critical', 'status' => 'submitted']);
        $this->grievance($student, ['urgency' => 'Critical', 'status' => 'under_review']);
        $this->grievance($student, ['urgency' => 'Critical', 'status' => 'resolved']);
        $this->grievance($student, ['urgency' => 'Critical', 'status' => 'dismissed']);
        $this->grievance($student, ['urgency' => 'High', 'status' => 'submitted']);

        Sanctum::actingAs($this->user('SUPER_ADMIN'));
        $open = urlencode(json_encode(['submitted', 'under_review']));
        $this->getJson("/api/grievances?urgency=Critical&status={$open}&per_page=1")->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/grievances?urgency=Critical&status=submitted,under_review&per_page=1')->assertUnprocessable();
    }

    public function test_the_sao_corrects_a_classification_and_the_machine_rating_stays_beside_it(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $grievance = $this->grievance($student, ['urgency' => 'Critical', 'category' => 'Safety & Security', 'classification_engine' => 'ai-service', 'classification_reasoning' => 'Marked Critical because the text mentions "emergency".']);
        $sao = $this->user('SUPER_ADMIN');
        Sanctum::actingAs($sao);

        $this->patchJson("/api/grievances/{$grievance->id}/classification", ['urgency' => 'Low', 'category' => 'General'])
            ->assertOk()
            ->assertJsonPath('urgency', 'Low')
            ->assertJsonPath('category', 'General')
            ->assertJsonPath('machine_urgency', 'Critical')
            ->assertJsonPath('machine_category', 'Safety & Security')
            ->assertJsonPath('classification_engine', 'reviewer')
            ->assertJsonPath('classification_corrected_by', $sao->school_id)
            ->assertJsonPath('classification_reasoning', 'Marked Critical because the text mentions "emergency".');

        $this->patchJson("/api/grievances/{$grievance->id}/classification", ['urgency' => 'Medium', 'category' => 'Academic / Faculty'])
            ->assertOk()
            ->assertJsonPath('machine_urgency', 'Critical')
            ->assertJsonPath('machine_category', 'Safety & Security');

        $this->assertDatabaseHas('audit_logs', ['module' => 'grievances', 'action' => 'grievance_classification_corrected', 'record_id' => $grievance->id, 'user_id' => $sao->school_id, 'actor_role' => 'SUPER_ADMIN']);
        $this->assertSame(2, AuditLog::where('action', 'grievance_classification_corrected')->count());
        $log = AuditLog::where('action', 'grievance_classification_corrected')->orderBy('id')->first();
        $this->assertSame(['urgency' => 'Critical', 'category' => 'Safety & Security'], $log->old_values);
        $this->assertSame(['urgency' => 'Low', 'category' => 'General'], $log->new_values);
        $this->assertNotNull($grievance->fresh()->classification_corrected_at);
    }

    public function test_the_correction_is_validated(): void
    {
        $grievance = $this->grievance($this->user('STUDENT'));
        Sanctum::actingAs($this->user('SUPER_ADMIN'));

        $this->patchJson("/api/grievances/{$grievance->id}/classification", ['urgency' => 'Urgent', 'category' => 'General'])->assertUnprocessable()->assertJsonValidationErrors('urgency');
        $this->patchJson("/api/grievances/{$grievance->id}/classification", ['urgency' => 'Low', 'category' => 'Other'])->assertUnprocessable()->assertJsonValidationErrors('category');
        $this->patchJson("/api/grievances/{$grievance->id}/classification", ['urgency' => 'Low'])->assertUnprocessable()->assertJsonValidationErrors('category');
        $this->assertSame('Low', $grievance->fresh()->urgency);
        $this->assertNull($grievance->fresh()->machine_urgency);
    }

    public function test_only_the_sao_can_correct_a_classification(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $grievance = $this->grievance($student, ['urgency' => 'Critical']);
        $payload = ['urgency' => 'Low', 'category' => 'General'];

        foreach ([$this->user('ADMIN', $organization->id), $this->user('ADMIN'), $student, $this->user('SBO_OFFICER', $organization->id), $this->user('DEPARTMENT_HEAD')] as $actor) {
            Sanctum::actingAs($actor);
            $this->patchJson("/api/grievances/{$grievance->id}/classification", $payload)->assertForbidden();
        }

        $this->app['auth']->forgetGuards();
        $this->patchJson("/api/grievances/{$grievance->id}/classification", $payload)->assertUnauthorized();
        $this->assertSame('Critical', $grievance->fresh()->urgency);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'grievance_classification_corrected']);
    }

    public function test_a_deleted_grievance_cannot_be_corrected(): void
    {
        $grievance = $this->grievance($this->user('STUDENT'), ['urgency' => 'Critical']);
        $grievance->delete();
        Sanctum::actingAs($this->user('SUPER_ADMIN'));

        $this->patchJson("/api/grievances/{$grievance->id}/classification", ['urgency' => 'Low', 'category' => 'General'])->assertNotFound();
    }

    public function test_the_correction_does_not_reveal_the_reviewer_or_an_anonymous_filer_to_the_organization(): void
    {
        $organization = Organization::factory()->create();
        $student = $this->user('STUDENT', $organization->id);
        $grievance = $this->grievance($student, ['is_anonymous' => true, 'urgency' => 'Critical']);
        Sanctum::actingAs($this->user('SUPER_ADMIN'));
        $this->patchJson("/api/grievances/{$grievance->id}/classification", ['urgency' => 'Low', 'category' => 'General'])
            ->assertOk()
            ->assertJsonPath('submitted_by', $student->school_id);

        Sanctum::actingAs($this->user('ADMIN', $organization->id));
        $shown = $this->getJson("/api/grievances/{$grievance->id}")->assertOk()
            ->assertJsonPath('urgency', 'Low')
            ->assertJsonPath('machine_urgency', 'Critical')
            ->assertJsonMissingPath('classification_corrected_by')
            ->assertJsonMissingPath('submitted_by')
            ->assertJsonMissingPath('submitter');
        $this->assertStringNotContainsString($student->school_id, $shown->getContent());
        $listed = $this->getJson('/api/grievances')->assertOk();
        $this->assertArrayNotHasKey('classification_corrected_by', $listed->json('data.0'));
        $this->assertArrayNotHasKey('submitted_by', $listed->json('data.0'));

        Sanctum::actingAs($this->user('ADMIN'));
        $this->getJson("/api/grievances/{$grievance->id}")->assertNotFound();

        Sanctum::actingAs($student);
        $this->getJson("/api/grievances/{$grievance->id}")->assertOk()->assertJsonMissingPath('classification_corrected_by');
    }
}
