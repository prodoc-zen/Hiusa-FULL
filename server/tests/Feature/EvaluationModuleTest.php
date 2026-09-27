<?php

namespace Tests\Feature;

use App\Models\EvaluationResponse;
use App\Models\EvaluationWindow;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use ReflectionClass;
use Tests\TestCase;

class EvaluationModuleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create([
            'role' => $role,
            'organization_id' => $organizationId ?? Organization::factory(),
            'account_status' => 'active',
        ]);
    }

    private function authenticate(User $user): void
    {
        Sanctum::actingAs($user);
    }

    private function openWindow(?string $title = 'HIUSA v1 Evaluation'): EvaluationWindow
    {
        return EvaluationWindow::create([
            'title' => $title,
            'status' => 'open',
            'opens_at' => now()->subDay(),
            'closes_at' => now()->addWeek(),
        ]);
    }

    private function validPayload(string $instrumentKey): array
    {
        $items = config("evaluation.instruments.{$instrumentKey}.items");
        $answers = [];

        foreach ($items as $item) {
            $answers[$item['code']] = match ($item['type']) {
                'likert' => 4,
                'single_choice' => $item['options'][0]['value'],
                'multi_choice' => [$item['options'][0]['value']],
                'text' => 'Sample fixture response.',
                default => null,
            };
        }

        return ['consent' => true, 'answers' => $answers];
    }

    public function test_consent_is_required_to_submit_a_response(): void
    {
        $student = $this->user('STUDENT');
        $this->authenticate($student);
        $this->openWindow();

        $payload = $this->validPayload('student');
        unset($payload['consent']);

        $this->postJson('/api/evaluation/responses', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors('consent');

        $this->assertDatabaseCount('evaluation_responses', 0);
    }

    public function test_item_code_and_range_validation_rejects_bad_answers(): void
    {
        $officer = $this->user('SBO_OFFICER');
        $this->authenticate($officer);
        $this->openWindow();

        $payload = $this->validPayload('officer');
        $payload['answers']['O-B1'] = 9; // out of the 1-5 likert range

        $this->postJson('/api/evaluation/responses', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors('answers.O-B1');

        $payload2 = $this->validPayload('officer');
        unset($payload2['answers']['O-A2']); // drop a required item entirely

        $this->postJson('/api/evaluation/responses', $payload2)
            ->assertStatus(422)
            ->assertJsonValidationErrors('answers.O-A2');
    }

    public function test_duplicate_submission_for_the_same_window_is_rejected(): void
    {
        $student = $this->user('STUDENT');
        $this->authenticate($student);
        $this->openWindow();

        $this->postJson('/api/evaluation/responses', $this->validPayload('student'))->assertCreated();
        $this->postJson('/api/evaluation/responses', $this->validPayload('student'))->assertStatus(409);

        $this->assertDatabaseCount('evaluation_responses', 1);
    }

    public function test_submission_is_rejected_when_no_window_is_open(): void
    {
        $student = $this->user('STUDENT');
        $this->authenticate($student);

        EvaluationWindow::create(['title' => 'Closed Window', 'status' => 'closed']);

        $this->postJson('/api/evaluation/responses', $this->validPayload('student'))
            ->assertStatus(422)
            ->assertJsonPath('message', 'There is no evaluation window currently open.');

        $this->assertDatabaseCount('evaluation_responses', 0);
    }

    public function test_current_endpoint_returns_the_correct_instrument_per_role(): void
    {
        $window = $this->openWindow();

        $student = $this->user('STUDENT');
        $this->authenticate($student);
        $studentResponse = $this->getJson('/api/evaluation/current')->assertOk();
        $studentResponse->assertJsonPath('respondent_type', 'student');
        $this->assertStringStartsWith('S-', $studentResponse->json('instrument.items.0.code'));
        $this->assertFalse($studentResponse->json('responded'));

        $officer = $this->user('SBO_OFFICER');
        $this->authenticate($officer);
        $officerResponse = $this->getJson('/api/evaluation/current')->assertOk();
        $officerResponse->assertJsonPath('respondent_type', 'officer');
        $this->assertStringStartsWith('O-', $officerResponse->json('instrument.items.0.code'));

        $adviser = $this->user('DEPARTMENT_HEAD');
        $this->authenticate($adviser);
        $adviserResponse = $this->getJson('/api/evaluation/current')->assertOk();
        $adviserResponse->assertJsonPath('respondent_type', 'adviser');
        $this->assertStringStartsWith('A-', $adviserResponse->json('instrument.items.0.code'));

        // ADMIN also answers the officer instrument per the role mapping.
        $admin = $this->user('ADMIN');
        $this->authenticate($admin);
        $this->getJson('/api/evaluation/current')->assertOk()->assertJsonPath('respondent_type', 'officer');

        // Submitting flips "responded" to true for that same window.
        $this->authenticate($student);
        $this->postJson('/api/evaluation/responses', $this->validPayload('student'))->assertCreated();
        $this->getJson('/api/evaluation/current')->assertOk()->assertJsonPath('responded', true);

        $this->assertNotNull($window->id);
    }

    public function test_super_admin_role_does_not_respond_to_the_survey(): void
    {
        $superAdmin = $this->user('SUPER_ADMIN');
        $this->authenticate($superAdmin);
        $this->openWindow();

        $this->getJson('/api/evaluation/current')->assertStatus(403);
        $this->postJson('/api/evaluation/responses', ['consent' => true, 'answers' => []])->assertStatus(403);
    }

    private function seedResponses(EvaluationWindow $window, Organization $org, string $respondentType, string $role, int $count, array $extraAnswers = []): void
    {
        $items = config("evaluation.instruments.{$respondentType}.items");
        $baseAnswers = [];
        foreach ($items as $item) {
            if ($item['type'] === 'likert') {
                $baseAnswers[$item['code']] = 3;
            }
        }

        for ($i = 0; $i < $count; $i++) {
            $user = User::factory()->create(['role' => $role, 'organization_id' => $org->id, 'account_status' => 'active']);
            $answers = $baseAnswers;
            foreach ($extraAnswers as $code => $values) {
                $answers[$code] = $values[$i] ?? end($values);
            }

            EvaluationResponse::create([
                'evaluation_window_id' => $window->id,
                'organization_id' => $org->id,
                'user_id' => $user->school_id,
                'respondent_type' => $respondentType,
                'consent_given_at' => now(),
                'profile' => [],
                'answers' => $answers,
                'feedback' => 'Feedback #'.$i,
                'submitted_at' => now(),
            ]);
        }

        // seedResponses writes directly via Eloquent, bypassing the cache.api
        // middleware's write-invalidation hook, so the results cache must be
        // cleared by hand for the next GET in the same test to see fresh data.
        Cache::flush();
    }

    public function test_anonymity_threshold_withholds_means_below_three_responses(): void
    {
        $org = Organization::factory()->create();
        $window = $this->openWindow();
        $this->seedResponses($window, $org, 'student', 'STUDENT', 2);

        $admin = $this->user('ADMIN', $org->id);
        $this->authenticate($admin);

        $this->getJson('/api/evaluation/results')
            ->assertOk()
            ->assertJsonPath('groups.student.anonymized', true)
            ->assertJsonPath('groups.student.n', 2)
            ->assertJsonMissingPath('groups.student.overall_mean');

        $this->seedResponses($window, $org, 'student', 'STUDENT', 1);

        $response = $this->getJson('/api/evaluation/results')
            ->assertOk()
            ->assertJsonPath('groups.student.anonymized', false)
            ->assertJsonPath('groups.student.n', 3);

        $this->assertEquals(3.0, $response->json('groups.student.overall_mean'));
    }

    public function test_weighted_means_and_labels_match_table_3_thresholds_exactly(): void
    {
        $org = Organization::factory()->create();
        $window = $this->openWindow();

        $stronglyAgreed = array_merge(array_fill(0, 21, 5), array_fill(0, 79, 4)); // mean 4.21
        $agreed = array_merge(array_fill(0, 41, 4), array_fill(0, 59, 3)); // mean 3.41
        $undecided = array_merge(array_fill(0, 61, 3), array_fill(0, 39, 2)); // mean 2.61
        $disagreed = array_merge(array_fill(0, 81, 2), array_fill(0, 19, 1)); // mean 1.81

        $this->seedResponses($window, $org, 'student', 'STUDENT', 100, [
            'S-B1' => $stronglyAgreed,
            'S-B2' => $agreed,
            'S-B3' => $undecided,
            'S-B4' => $disagreed,
        ]);

        $admin = $this->user('ADMIN', $org->id);
        $this->authenticate($admin);

        $response = $this->getJson('/api/evaluation/results')->assertOk();
        $items = collect($response->json('groups.student.sections.B.items'))->keyBy('code');

        $this->assertSame(4.21, $items['S-B1']['mean']);
        $this->assertSame('Strongly Agreed', $items['S-B1']['label']);

        $this->assertSame(3.41, $items['S-B2']['mean']);
        $this->assertSame('Agreed', $items['S-B2']['label']);

        $this->assertSame(2.61, $items['S-B3']['mean']);
        $this->assertSame('Undecided', $items['S-B3']['label']);

        $this->assertSame(1.81, $items['S-B4']['mean']);
        $this->assertSame('Disagreed', $items['S-B4']['label']);
    }

    public function test_likert_label_boundaries_are_exact_at_every_table_3_edge(): void
    {
        $controller = new \App\Http\Controllers\EvaluationController;
        $method = (new ReflectionClass($controller))->getMethod('likertLabel');
        $method->setAccessible(true);

        $cases = [
            5.00 => 'Strongly Agreed',
            4.21 => 'Strongly Agreed',
            4.20 => 'Agreed',
            3.41 => 'Agreed',
            3.40 => 'Undecided',
            2.61 => 'Undecided',
            2.60 => 'Disagreed',
            1.81 => 'Disagreed',
            1.80 => 'Strongly Disagreed',
            1.00 => 'Strongly Disagreed',
        ];

        foreach ($cases as $mean => $expectedLabel) {
            $this->assertSame($expectedLabel, $method->invoke($controller, $mean)['label'], "mean {$mean} should be labeled {$expectedLabel}");
        }
    }

    public function test_results_are_scoped_per_role_and_deny_cross_organization_access(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $window = $this->openWindow();
        $this->seedResponses($window, $orgA, 'student', 'STUDENT', 3);
        $this->seedResponses($window, $orgB, 'student', 'STUDENT', 3);

        $adminA = $this->user('ADMIN', $orgA->id);
        $this->authenticate($adminA);

        $this->getJson('/api/evaluation/results')
            ->assertOk()
            ->assertJsonPath('groups.student.n', 3);

        $this->getJson("/api/evaluation/results?organization_id={$orgB->id}")
            ->assertStatus(403);

        $departmentHead = $this->user('DEPARTMENT_HEAD', $orgB->id);
        $this->authenticate($departmentHead);
        $this->getJson('/api/evaluation/results')
            ->assertOk()
            ->assertJsonPath('groups.student.n', 3);

        $superAdmin = $this->user('SUPER_ADMIN');
        $this->authenticate($superAdmin);
        $this->getJson("/api/evaluation/results?organization_id={$orgA->id}")
            ->assertOk()
            ->assertJsonPath('groups.student.n', 3);

        $this->getJson('/api/evaluation/results')
            ->assertOk()
            ->assertJsonPath('groups.student.n', 6);

        $officer = $this->user('SBO_OFFICER', $orgA->id);
        $this->authenticate($officer);
        $this->getJson('/api/evaluation/results')->assertStatus(403);
    }

    public function test_results_export_is_scoped_and_streams_a_csv(): void
    {
        $org = Organization::factory()->create();
        $window = $this->openWindow();
        $this->seedResponses($window, $org, 'student', 'STUDENT', 3);

        $admin = $this->user('ADMIN', $org->id);
        $this->authenticate($admin);

        $response = $this->get('/api/evaluation/results/export');
        $response->assertOk();
        $response->assertHeader('content-type', 'text/csv; charset=UTF-8');

        $csv = $response->streamedContent();
        $this->assertStringContainsString('Item Code', $csv);
        $this->assertStringContainsString('S-B1', $csv);
        $this->assertStringContainsString('OVERALL_MEAN', $csv);

        $officer = $this->user('SBO_OFFICER', $org->id);
        $this->authenticate($officer);
        $this->get('/api/evaluation/results/export')->assertStatus(403);
    }

    public function test_only_super_admin_manages_evaluation_windows(): void
    {
        $student = $this->user('STUDENT');

        $superAdmin = $this->user('SUPER_ADMIN');
        $this->authenticate($superAdmin);

        $created = $this->postJson('/api/evaluation/windows', [
            'title' => 'Second Semester Evaluation',
            'opens_at' => now()->addDay()->toDateTimeString(),
            'closes_at' => now()->addWeeks(2)->toDateTimeString(),
        ])->assertCreated();

        $windowId = $created->json('id');
        $this->assertDatabaseHas('evaluation_windows', ['id' => $windowId, 'status' => 'draft']);
        $this->assertDatabaseHas('audit_logs', ['module' => 'evaluation', 'action' => 'window_created', 'record_id' => $windowId]);

        $this->patchJson("/api/evaluation/windows/{$windowId}", ['status' => 'open'])
            ->assertOk()
            ->assertJsonPath('status', 'open');

        $this->assertDatabaseHas('audit_logs', ['module' => 'evaluation', 'action' => 'window_status_changed', 'record_id' => $windowId]);
        $this->assertDatabaseHas('notifications', ['reference_id' => $windowId, 'user_id' => $student->school_id]);

        $this->authenticate($student);

        $this->getJson('/api/evaluation/windows')->assertStatus(403);
        $this->postJson('/api/evaluation/windows', ['title' => 'Nope'])->assertStatus(403);
        $this->patchJson("/api/evaluation/windows/{$windowId}", ['status' => 'closed'])->assertStatus(403);

        $admin = $this->user('ADMIN');
        $this->authenticate($admin);
        $this->getJson('/api/evaluation/windows')->assertStatus(403);
    }
}
