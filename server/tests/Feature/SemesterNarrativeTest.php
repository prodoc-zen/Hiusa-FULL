<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AiOutput;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\Evaluation\GroundingCheck;
use App\Services\Ai\SemesterNarrativeDrafter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Support\NarrativeFakeGenerator;
use Tests\TestCase;

/** The semester narrative: the drafter's guards and template, and the endpoint that records each draft. */
class SemesterNarrativeTest extends TestCase
{
    use RefreshDatabase;

    private function digest(array $overrides = []): array
    {
        return [
            'organization' => 'Computer Science Society',
            'semester' => '1st Semester 2026-2027',
            'events' => [
                ['title' => 'Programming Contest', 'date' => '2026-09-12', 'status' => 'completed', 'attendance' => 120, 'budget_allocated' => 25000.0, 'budget_used' => 18400.0],
                ['title' => 'Foundation Day', 'date' => '2026-10-02', 'status' => 'cancelled', 'attendance' => null, 'budget_allocated' => null, 'budget_used' => null],
            ],
            'tasks' => ['completed' => 14, 'overdue' => 2, 'open' => 3],
            'elections' => [['title' => 'SBO Election', 'voters' => 412, 'ballots' => 266]],
            'merchandise' => ['orders' => 38, 'claimed' => 30],
            'announcements' => ['posted' => 12],
            'finance' => ['income' => 30000.0, 'expense' => 18400.0, 'closing_balance' => 11600.0],
            'upcoming_events' => [['title' => 'Hackathon', 'date' => '2026-12-05']],
            'officers' => [['name' => 'Juan Dela Cruz', 'position' => 'President']],
            ...$overrides,
        ];
    }

    /** @return array<string, string> */
    private function goodSections(array $overrides = []): array
    {
        return [
            'accomplishments' => 'The society held "Programming Contest" on September 12, 2026. "Foundation Day" was cancelled.',
            'implementation' => 'Officers completed 14 tasks and posted 12 announcements. The contest used PHP 18,400.00 of PHP 25,000.00.',
            'evaluation' => '120 students attended the contest. The "SBO Election" drew 266 ballots from 412 voters.',
            'next_semester_plan' => 'The "Hackathon" is set for December 5, 2026. [objectives and activities to be decided by the officers]',
            ...$overrides,
        ];
    }

    private function draft(NarrativeFakeGenerator $fake, ?array $digest = null): array
    {
        return (new SemesterNarrativeDrafter($fake))->draftFromDigest($digest ?? $this->digest());
    }

    public function test_a_model_draft_that_passes_every_check_is_used(): void
    {
        $fake = new NarrativeFakeGenerator(structured: $this->goodSections());

        $draft = $this->draft($fake);

        $this->assertSame('claude', $draft['engine']);
        $this->assertSame($this->goodSections(), $draft['sections']);
        $this->assertCount(1, $fake->calls);
        $this->assertSame('generateStructured', $fake->calls[0]['operation']);
        $this->assertStringContainsString('Programming Contest', $fake->calls[0]['input']);
    }

    public function test_a_provider_that_is_not_claude_is_reported_as_groq(): void
    {
        $draft = $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(), model: 'llama-test'));

        $this->assertSame('groq', $draft['engine']);
    }

    public function test_markdown_is_stripped_from_a_section(): void
    {
        $draft = $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(['evaluation' => '**120** students attended the contest.'])));

        $this->assertSame('claude', $draft['engine']);
        $this->assertSame('120 students attended the contest.', $draft['sections']['evaluation']);
    }

    public function test_with_both_providers_silent_the_template_restates_the_digest(): void
    {
        $draft = $this->draft(new NarrativeFakeGenerator);

        $this->assertSame('template', $draft['engine']);
        $this->assertSame(SemesterNarrativeDrafter::SECTIONS, array_keys($draft['sections']));
        $this->assertStringContainsString('- "Programming Contest" was held on September 12, 2026.', $draft['sections']['accomplishments']);
        $this->assertStringContainsString('- "Foundation Day" was cancelled and was not held (October 2, 2026).', $draft['sections']['accomplishments']);
        $this->assertStringContainsString('budget used PHP 18,400.00 of PHP 25,000.00', $draft['sections']['implementation']);
        $this->assertStringContainsString('- "Programming Contest": 120 attended.', $draft['sections']['evaluation']);
        $this->assertStringContainsString('266 ballots cast by 412 eligible voters', $draft['sections']['evaluation']);
        $this->assertStringContainsString('- "Hackathon" on December 5, 2026.', $draft['sections']['next_semester_plan']);
        $this->assertStringContainsString('Juan Dela Cruz (President)', $draft['sections']['next_semester_plan']);

        $facts = json_encode($this->digest());
        foreach ($draft['sections'] as $text) {
            $this->assertSame([], GroundingCheck::check($text, $facts)['violations'], 'the template introduces no number the facts lack');
        }
    }

    public function test_a_missing_fact_is_a_bracket_not_a_guess_in_the_template(): void
    {
        $digest = $this->digest(['events' => [['title' => 'Programming Contest', 'date' => '2026-09-12', 'status' => 'completed', 'attendance' => null, 'budget_allocated' => null, 'budget_used' => null]]]);

        $draft = $this->draft(new NarrativeFakeGenerator, $digest);

        $this->assertStringContainsString('[number of attendees not recorded]', $draft['sections']['evaluation']);
        $this->assertStringContainsString('[budget used not recorded]', $draft['sections']['implementation']);
    }

    public function test_a_semester_with_no_events_says_so_and_invents_nothing(): void
    {
        $digest = $this->digest(['events' => [], 'elections' => [], 'upcoming_events' => []]);

        $draft = $this->draft(new NarrativeFakeGenerator, $digest);

        $this->assertSame('- No events were recorded for 1st Semester 2026-2027.', $draft['sections']['accomplishments']);
        $this->assertStringContainsString('- No events are scheduled yet.', $draft['sections']['next_semester_plan']);
    }

    public function test_a_draft_for_an_empty_semester_that_does_not_say_so_is_replaced(): void
    {
        $digest = $this->digest(['events' => [], 'elections' => [], 'upcoming_events' => []]);
        $quiet = new NarrativeFakeGenerator(structured: $this->goodSections(['accomplishments' => 'The society had a productive semester.', 'evaluation' => 'The semester went well.', 'next_semester_plan' => 'More of the same.', 'implementation' => 'Officers completed 14 tasks.']));
        $honest = new NarrativeFakeGenerator(structured: $this->goodSections(['accomplishments' => 'No events were recorded for this semester.', 'evaluation' => 'The semester went well.', 'next_semester_plan' => 'More of the same.', 'implementation' => 'Officers completed 14 tasks.']));

        $this->assertSame('template', $this->draft($quiet, $digest)['engine']);
        $this->assertSame('claude', $this->draft($honest, $digest)['engine']);
    }

    public function test_a_cancelled_event_described_as_held_sends_the_whole_draft_to_the_template(): void
    {
        foreach ([
            'The "Foundation Day" was held on October 2, 2026.',
            'Many students attended "Foundation Day".',
            'The "Foundation Day" took place successfully.',
        ] as $sentence) {
            $draft = $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(['accomplishments' => $sentence])));
            $this->assertSame('template', $draft['engine'], $sentence);
            $this->assertStringNotContainsString('was held on October', $draft['sections']['accomplishments']);
        }

        $kept = $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(['accomplishments' => 'The "Foundation Day" was cancelled and was not held.'])));
        $this->assertSame('claude', $kept['engine']);
    }

    public function test_a_number_the_digest_does_not_hold_is_rejected(): void
    {
        $draft = $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(['evaluation' => '120 students attended and 75 percent were first years.'])));

        $this->assertSame('template', $draft['engine']);
    }

    public function test_a_quoted_title_the_digest_does_not_hold_is_rejected(): void
    {
        $draft = $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(['accomplishments' => 'The society held "Intramurals Cup" and "Programming Contest".'])));

        $this->assertSame('template', $draft['engine']);
    }

    public function test_a_section_over_the_word_limit_or_missing_is_rejected(): void
    {
        $long = implode(' ', array_fill(0, 121, 'word'));
        $this->assertSame('template', $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(['implementation' => $long])))['engine']);

        $edge = implode(' ', array_fill(0, 120, 'word'));
        $this->assertSame('claude', $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(['implementation' => $edge])))['engine'], 'exactly 120 words is allowed');

        $missing = $this->goodSections();
        unset($missing['evaluation']);
        $this->assertSame('template', $this->draft(new NarrativeFakeGenerator(structured: $missing))['engine']);
        $this->assertSame('template', $this->draft(new NarrativeFakeGenerator(structured: $this->goodSections(['evaluation' => '  '])))['engine']);
    }

    public function test_the_template_for_twelve_events_stays_inside_the_word_limit(): void
    {
        $events = [];
        foreach (range(1, 12) as $index) {
            $events[] = ['title' => "Annual Leadership Training Seminar Series Number {$index}", 'date' => '2026-09-'.str_pad((string) $index, 2, '0', STR_PAD_LEFT), 'status' => 'completed', 'attendance' => 40 + $index, 'budget_allocated' => 1000.0 * $index, 'budget_used' => 500.0 * $index];
        }

        $draft = $this->draft(new NarrativeFakeGenerator, $this->digest(['events' => $events]));

        foreach ($draft['sections'] as $key => $text) {
            $this->assertLessThanOrEqual(120, SemesterNarrativeDrafter::words($text), $key);
        }
        $this->assertStringContainsString('- More are listed in the system.', $draft['sections']['accomplishments']);
        $this->assertStringContainsString('"Annual Leadership Training Seminar Series Number 1" was held', $draft['sections']['accomplishments']);
    }

    public function test_the_text_checks_stay_fast_on_a_huge_or_hostile_draft(): void
    {
        $digest = $this->digest();
        $hostile = [
            str_repeat('"a ', 100000),
            str_repeat("\u{201C}a ", 100000),
            '"'.str_repeat('a', 300000),
            str_repeat('Foundation Day. ', 20000),
            str_repeat(' ', 300000).'x',
        ];

        $started = microtime(true);
        foreach ($hostile as $text) {
            SemesterNarrativeDrafter::quotesOnlySuppliedTitles($text, $digest);
            SemesterNarrativeDrafter::describesCancelledAsHeld($text, ['Foundation Day']);
            SemesterNarrativeDrafter::words($text);
        }

        $this->assertLessThan(2.0, microtime(true) - $started);
        // The largest legitimate draft still passes: four sections of exactly 120 words each.
        $edge = implode(' ', array_fill(0, 120, 'word'));
        $this->assertSame('claude', $this->draft(new NarrativeFakeGenerator(structured: array_fill_keys(SemesterNarrativeDrafter::SECTIONS, $edge)))['engine']);
    }

    // The endpoint

    private function semester(string $status = 'active'): AcademicSemester
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => now()->subMonths(4)->toDateString(), 'ends_on' => now()->addMonths(6)->toDateString(), 'is_current' => true]);

        return AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => now()->subMonths(3)->toDateString(), 'ends_on' => now()->addMonths(1)->toDateString(), 'status' => $status]);
    }

    /** @return array{0: Organization, 1: User, 2: AcademicSemester} */
    private function world(): array
    {
        $organization = Organization::factory()->create(['name' => 'Computer Science Society']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id, 'first_name' => 'Maria', 'last_name' => 'Santos']);

        return [$organization, $admin, $this->semester()];
    }

    private function heldEvent(Organization $organization, User $by, AcademicSemester $semester, array $overrides = []): Event
    {
        return Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $by->school_id, 'academic_semester_id' => $semester->id,
            'status' => 'completed', 'start_time' => now()->subDays(20), 'end_time' => now()->subDays(20)->addHours(3), ...$overrides,
        ]);
    }

    public function test_an_admin_gets_a_draft_and_it_is_recorded(): void
    {
        [$organization, $admin, $semester] = $this->world();
        $event = $this->heldEvent($organization, $admin, $semester, ['title' => 'Programming Contest']);
        $student = User::factory()->student()->create(['first_name' => 'Ligaya', 'last_name' => 'Bautista']);
        Attendance::factory()->create(['event_id' => $event->id, 'user_id' => $student->school_id, 'method' => 'manual']);
        $budget = Budget::factory()->create(['organization_id' => $organization->id, 'event_id' => $event->id, 'allocated_amount' => 25000, 'submission_status' => 'approved']);
        Transaction::factory()->create(['organization_id' => $organization->id, 'budget_id' => $budget->id, 'type' => 'expense', 'amount' => 18400, 'description' => 'Paid Ligaya Bautista for printing', 'payer_id' => $student->school_id, 'transaction_date' => now()->subDays(19)]);
        $fake = new NarrativeFakeGenerator(structured: [
            'accomplishments' => 'The society held "Programming Contest".',
            'implementation' => 'The contest used PHP 18,400.00 of PHP 25,000.00.',
            'evaluation' => '1 student attended.',
            'next_semester_plan' => 'No events are scheduled yet. [objectives and activities to be decided by the officers]',
        ]);
        $this->app->instance(TextGenerator::class, $fake);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertOk();

        $response->assertJsonPath('engine', 'claude');
        $response->assertJsonPath('sections.accomplishments', 'The society held "Programming Contest".');
        $response->assertJsonPath('facts.organization', 'Computer Science Society');
        $this->assertSame(implode("\n\n", $response->json('sections')), $response->json('text'));

        $row = AiOutput::findOrFail($response->json('ai_output_id'));
        $this->assertSame(['semester_narrative', 'pending', $admin->school_id, $organization->id, 1], [$row->feature_type, $row->decision_status, (int) $row->requested_by, $row->organization_id, $row->version]);
        $this->assertSame('Programming Contest', $row->structured_input['events'][0]['title']);
        $this->assertSame($response->json('text'), $row->structured_output['text']);

        $sent = $fake->sent();
        foreach (['Ligaya', 'Bautista', (string) $student->school_id, 'Paid', 'printing'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $sent, "the model was never shown {$forbidden}");
        }
    }

    public function test_with_no_model_the_endpoint_answers_from_the_template(): void
    {
        [$organization, $admin, $semester] = $this->world();
        $this->heldEvent($organization, $admin, $semester, ['title' => 'Programming Contest']);
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertOk();

        $response->assertJsonPath('engine', 'template');
        $this->assertStringContainsString('"Programming Contest" was held on', $response->json('sections.accomplishments'));
        $this->assertSame('template', AiOutput::findOrFail($response->json('ai_output_id'))->structured_output['engine']);
    }

    public function test_a_model_draft_that_fails_a_check_falls_back_to_the_template(): void
    {
        [$organization, $admin, $semester] = $this->world();
        $this->heldEvent($organization, $admin, $semester, ['title' => 'Programming Contest']);
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator(structured: [
            'accomplishments' => 'The society reached 9999 students.', 'implementation' => 'x', 'evaluation' => 'x', 'next_semester_plan' => 'x',
        ]));
        Sanctum::actingAs($admin);

        $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertOk()->assertJsonPath('engine', 'template');
    }

    public function test_only_the_organizations_own_records_reach_the_draft(): void
    {
        [$organization, $admin, $semester] = $this->world();
        $rival = Organization::factory()->create(['name' => 'Rival Club']);
        $this->heldEvent($organization, $admin, $semester, ['title' => 'Our Contest']);
        $this->heldEvent($rival, $admin, $semester, ['title' => 'Their Secret Gala']);
        $fake = new NarrativeFakeGenerator;
        $this->app->instance(TextGenerator::class, $fake);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertOk();

        $this->assertStringContainsString('Our Contest', $response->getContent());
        $this->assertStringNotContainsString('Their Secret Gala', $response->getContent());
        $this->assertStringNotContainsString('Their Secret Gala', $fake->sent());
        $this->assertStringNotContainsString('Rival Club', $fake->sent());
    }

    public function test_an_sbo_officer_cannot_draft_it_belongs_to_the_admin(): void
    {
        [$organization, , $semester] = $this->world();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);
        Sanctum::actingAs($officer);

        $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertForbidden();
        $this->assertSame(0, AiOutput::count());
    }

    public function test_students_and_deans_cannot_draft(): void
    {
        [$organization, , $semester] = $this->world();
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);

        $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertUnauthorized();
        foreach ([User::factory()->student()->create(['organization_id' => $organization->id]), User::factory()->departmentHead()->create(['organization_id' => $organization->id]), User::factory()->superAdmin()->create()] as $user) {
            Sanctum::actingAs($user);
            $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertForbidden();
        }
        $this->assertSame(0, AiOutput::count());
    }

    public function test_the_semester_must_exist_and_must_have_started(): void
    {
        [, $admin, $semester] = $this->world();
        $year = AcademicYear::first();
        $upcoming = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => now()->addMonths(2)->toDateString(), 'ends_on' => now()->addMonths(5)->toDateString(), 'status' => 'upcoming']);
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);
        Sanctum::actingAs($admin);

        $this->postJson('/api/compliance/semester-narrative', [])->assertUnprocessable();
        $this->postJson('/api/compliance/semester-narrative', ['semester_id' => 9999])->assertUnprocessable();
        $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $upcoming->id])->assertUnprocessable()->assertJsonPath('message', 'This semester has not started, so there is nothing to write about yet.');
        $this->assertSame(0, AiOutput::count());
    }

    public function test_copying_the_draft_unchanged_counts_as_accepted_and_editing_it_as_edited(): void
    {
        [$organization, $admin, $semester] = $this->world();
        $this->heldEvent($organization, $admin, $semester, ['title' => 'Programming Contest']);
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);
        Sanctum::actingAs($admin);

        $first = $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertOk();
        $this->postJson("/api/ai/outputs/{$first->json('ai_output_id')}/outcome", ['final_text' => $first->json('text')])->assertOk()->assertJsonPath('data.decision_status', 'accepted');

        $second = $this->postJson('/api/compliance/semester-narrative', ['semester_id' => $semester->id])->assertOk();
        $this->assertNotSame($first->json('ai_output_id'), $second->json('ai_output_id'));
        $this->assertSame(2, AiOutput::findOrFail($second->json('ai_output_id'))->version);
        $this->postJson("/api/ai/outputs/{$second->json('ai_output_id')}/outcome", ['final_text' => $second->json('text').' Edited by the officer.'])->assertOk()->assertJsonPath('data.decision_status', 'edited');
    }
}
