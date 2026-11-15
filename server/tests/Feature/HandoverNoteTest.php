<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AiOutput;
use App\Models\Election;
use App\Models\Event;
use App\Models\OfficerAppointment;
use App\Models\OfficerHandover;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use App\Services\Ai\Evaluation\GroundingCheck;
use App\Services\Ai\HandoverNoteDrafter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use InvalidArgumentException;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\Support\NarrativeFakeGenerator;
use Tests\TestCase;

/** The handover remarks drafter: what the model sees per item, its guards and template, and the endpoint. */
class HandoverNoteTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function facts(string $category): array
    {
        return [
            'category' => $category,
            'digest' => [
                'organization' => 'Computer Science Society',
                'semester' => '2nd Semester 2026-2027',
                'events' => [
                    ['title' => 'Programming Contest', 'date' => '2027-02-12', 'status' => 'completed', 'attendance' => 120, 'budget_allocated' => 25000.0, 'budget_used' => 18400.0],
                    ['title' => 'Foundation Day', 'date' => '2027-03-02', 'status' => 'cancelled', 'attendance' => null, 'budget_allocated' => null, 'budget_used' => null],
                ],
                'tasks' => ['completed' => 14, 'overdue' => 2, 'open' => 3],
                'elections' => [['title' => 'SBO Election', 'voters' => 412, 'ballots' => 266]],
                'merchandise' => ['orders' => 38, 'claimed' => 30],
                'announcements' => ['posted' => 12],
                'finance' => ['income' => 30000.0, 'expense' => 18400.0, 'closing_balance' => 11600.0],
                'upcoming_events' => [['title' => 'Hackathon', 'date' => '2027-04-05']],
                'officers' => [['name' => 'Juan Dela Cruz', 'position' => 'President']],
            ],
            'open_items' => [
                'pending_tasks' => [['title' => 'Liquidate the fund', 'owner' => 'Ana Reyes', 'deadline' => '2027-04-10']],
                'unsettled' => [['kind' => 'cash_advance', 'amount' => 1500.0, 'note' => 'A cash advance is not fully repaid.']],
                'scheduled_events' => [['title' => 'Hackathon', 'date' => '2027-04-05']],
                'election_state' => 'closed',
                'missing_compliance' => ['Accomplishment Report'],
            ],
        ];
    }

    /** What each item may be told, and a word from every other item that it must never be shown. */
    public static function categories(): array
    {
        $everything = ['Programming Contest', 'Hackathon', 'Liquidate the fund', 'SBO Election', 'Accomplishment Report', 'PHP 11,600.00', '1500', 'Juan Dela Cruz', '"posted":12', '"claimed":30'];

        return [
            'finance' => ['finance', ['11600', '1500'], array_values(array_diff($everything, ['PHP 11,600.00', '1500']))],
            'events' => ['events', ['Programming Contest', 'Foundation Day', 'Hackathon'], array_values(array_diff($everything, ['Programming Contest', 'Hackathon']))],
            'tasks' => ['tasks', ['Liquidate the fund', 'Ana Reyes'], array_values(array_diff($everything, ['Liquidate the fund']))],
            'organization' => ['organization', ['Juan Dela Cruz', '"posted":12', '"claimed":30'], array_values(array_diff($everything, ['Juan Dela Cruz', '"posted":12', '"claimed":30']))],
            'election' => ['election', ['SBO Election', '"election_state":"closed"'], array_values(array_diff($everything, ['SBO Election']))],
            'compliance' => ['compliance', ['Accomplishment Report'], array_values(array_diff($everything, ['Accomplishment Report']))],
        ];
    }

    private function draft(NarrativeFakeGenerator $fake, string $category, ?array $facts = null): array
    {
        return (new HandoverNoteDrafter($fake))->draftFromFacts($facts ?? $this->facts($category));
    }

    #[DataProvider('categories')]
    public function test_the_model_is_shown_the_facts_of_its_own_item_only(string $category, array $shown, array $hidden): void
    {
        $fake = new NarrativeFakeGenerator(text: '- Nothing to add.');

        $this->draft($fake, $category);

        $sent = $fake->sent();
        $this->assertSame("{$category}", json_decode($fake->calls[0]['input'], true)['category']);
        foreach ($shown as $fact) {
            $this->assertStringContainsString($fact, $sent, "the {$category} item is told {$fact}");
        }
        foreach ($hidden as $fact) {
            $this->assertStringNotContainsString($fact, $sent, "the {$category} item is never told {$fact}");
        }
    }

    #[DataProvider('categories')]
    public function test_with_no_model_each_item_is_a_template_of_its_own_facts(string $category): void
    {
        $draft = $this->draft(new NarrativeFakeGenerator, $category);

        $this->assertSame('template', $draft['engine']);
        $this->assertNotSame('', $draft['text']);
        $this->assertLessThanOrEqual(HandoverNoteDrafter::MAX_CHARACTERS, mb_strlen($draft['text']));
        $this->assertSame([], GroundingCheck::check($draft['text'], json_encode($draft['facts']))['violations'], 'the template introduces no number the facts lack');
        foreach (explode("\n", $draft['text']) as $line) {
            $this->assertStringStartsWith('- ', $line);
        }
    }

    public function test_the_template_lines_say_what_the_incoming_officers_need(): void
    {
        $text = fn (string $category) => $this->draft(new NarrativeFakeGenerator, $category)['text'];

        $this->assertStringContainsString('This term: income PHP 30,000.00, expenses PHP 18,400.00, closing balance PHP 11,600.00.', $text('finance'));
        $this->assertStringContainsString('Unsettled cash advance: PHP 1,500.00. A cash advance is not fully repaid.', $text('finance'));
        $this->assertStringContainsString('"Programming Contest" was held on February 12, 2027 with 120 attending.', $text('events'));
        $this->assertStringContainsString('"Foundation Day" was cancelled and was not held (March 2, 2027).', $text('events'));
        $this->assertStringContainsString('Still scheduled: "Hackathon" on April 5, 2027.', $text('events'));
        $this->assertStringContainsString('Tasks this term: 14 completed, 2 overdue, 3 still open.', $text('tasks'));
        $this->assertStringContainsString('"Liquidate the fund" is with Ana Reyes, due 2027-04-10.', $text('tasks'));
        $this->assertStringContainsString('Officers this term: Juan Dela Cruz (President).', $text('organization'));
        $this->assertStringContainsString('The election is closed and its results are not finalized yet.', $text('election'));
        $this->assertStringContainsString('Election "SBO Election": 266 ballots cast by 412 eligible voters.', $text('election'));
        $this->assertStringContainsString('Still missing: Accomplishment Report.', $text('compliance'));
    }

    public function test_an_item_with_nothing_open_says_so(): void
    {
        $facts = $this->facts('finance');
        $facts['open_items'] = ['pending_tasks' => [], 'unsettled' => [], 'scheduled_events' => [], 'election_state' => 'none', 'missing_compliance' => []];

        $this->assertStringContainsString('- Nothing is recorded as unsettled.', $this->draft(new NarrativeFakeGenerator, 'finance', $facts)['text']);
        $this->assertStringContainsString('- No compliance requirement is recorded as missing.', $this->draft(new NarrativeFakeGenerator, 'compliance', [...$facts, 'category' => 'compliance'])['text']);
        $this->assertStringContainsString('- No task is waiting on anyone.', $this->draft(new NarrativeFakeGenerator, 'tasks', [...$facts, 'category' => 'tasks'])['text']);
        $this->assertStringContainsString('- No election is recorded.', $this->draft(new NarrativeFakeGenerator, 'election', [...$facts, 'category' => 'election', 'digest' => [...$facts['digest'], 'elections' => []]])['text']);
    }

    public function test_a_good_model_note_is_used_and_stripped_of_markdown(): void
    {
        $draft = $this->draft(new NarrativeFakeGenerator(text: "- **Closing balance** is PHP 11,600.00.\n- One cash advance of PHP 1,500.00 is still open."), 'finance');

        $this->assertSame('claude', $draft['engine']);
        $this->assertSame("- Closing balance is PHP 11,600.00.\n- One cash advance of PHP 1,500.00 is still open.", $draft['text']);
    }

    public function test_a_note_that_fails_a_check_is_replaced_by_the_template(): void
    {
        $cases = [
            'a number the facts lack' => ['finance', '- The balance is PHP 99,999.00.'],
            'another item title' => ['finance', '- The "Hackathon" still needs a budget.'],
            'another item title in other case' => ['finance', '- The hackathon still needs a budget.'],
            'a task title in an events note' => ['events', '- Do not forget to Liquidate the fund.'],
            'an election title in a tasks note' => ['tasks', '- Ask the winners of the SBO Election.'],
            'a requirement name in a finance note' => ['finance', '- The Accomplishment Report is late.'],
            'nothing' => ['finance', '   '],
            'over the remarks limit' => ['finance', str_repeat('- Closing balance is PHP 11,600.00. ', 80)],
        ];

        foreach ($cases as $name => [$category, $text]) {
            $draft = $this->draft(new NarrativeFakeGenerator(text: $text), $category);
            $this->assertSame('template', $draft['engine'], $name);
            $this->assertLessThanOrEqual(HandoverNoteDrafter::MAX_CHARACTERS, mb_strlen($draft['text']), $name);
        }
    }

    public function test_a_title_that_belongs_to_the_item_is_allowed(): void
    {
        $draft = $this->draft(new NarrativeFakeGenerator(text: '- "Hackathon" is still scheduled for April 5, 2027.'), 'events');

        $this->assertSame('claude', $draft['engine']);
    }

    public function test_a_note_of_exactly_the_remarks_limit_is_allowed_and_one_more_is_not(): void
    {
        $edge = str_repeat('a', HandoverNoteDrafter::MAX_CHARACTERS);

        $this->assertSame('claude', $this->draft(new NarrativeFakeGenerator(text: $edge), 'finance')['engine']);
        $this->assertSame('template', $this->draft(new NarrativeFakeGenerator(text: $edge.'a'), 'finance')['engine']);
    }

    public function test_a_long_template_is_trimmed_to_the_remarks_limit(): void
    {
        $facts = $this->facts('tasks');
        $facts['open_items']['pending_tasks'] = array_map(fn (int $n) => ['title' => "Prepare the long named report number {$n} for the audit", 'owner' => 'Ana Reyes', 'deadline' => '2027-04-10'], range(1, 80));

        $draft = $this->draft(new NarrativeFakeGenerator, 'tasks', $facts);

        $this->assertLessThanOrEqual(HandoverNoteDrafter::MAX_CHARACTERS, mb_strlen($draft['text']));
        $this->assertStringEndsWith('- More items are listed in the system.', $draft['text']);
        $this->assertStringContainsString('report number 1 for the audit', $draft['text']);
    }

    public function test_an_unknown_category_is_refused(): void
    {
        $this->expectException(InvalidArgumentException::class);

        $this->draft(new NarrativeFakeGenerator, 'budget', [...$this->facts('finance'), 'category' => 'budget']);
    }

    // The endpoint

    /** @return array{0: Organization, 1: Election, 2: User, 3: AcademicSemester} */
    private function world(): array
    {
        $college = $this->makeCollege('CCS');
        $organization = $this->makeCollegeStudentOrganization($college, ['name' => 'Computer Science Society']);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => now()->subMonths(4)->toDateString(), 'ends_on' => now()->addMonths(6)->toDateString(), 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => now()->subMonths(3)->toDateString(), 'ends_on' => now()->addMonths(1)->toDateString(), 'status' => 'active']);
        $election = Election::factory()->create([
            'organization_id' => $organization->id, 'academic_semester_id' => $semester->id, 'title' => 'SBO Election',
            'status' => 'closed', 'start_time' => now()->subDays(20), 'end_time' => now()->subDays(19),
        ]);
        OfficerHandover::ensureFor($election);
        $outgoing = User::factory()->officer()->create(['organization_id' => $organization->id, 'first_name' => 'Ana', 'last_name' => 'Reyes']);
        OfficerAppointment::factory()->create(['organization_id' => $organization->id, 'election_id' => $election->id, 'user_school_id' => $outgoing->school_id, 'kind' => 'outgoing', 'status' => 'active']);

        return [$organization, $election, $outgoing, $semester];
    }

    public function test_an_outgoing_officer_gets_a_draft_for_the_item_and_it_is_recorded(): void
    {
        [$organization, $election, $outgoing, $semester] = $this->world();
        $contest = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $outgoing->school_id, 'academic_semester_id' => $semester->id, 'title' => 'Programming Contest', 'status' => 'completed', 'start_time' => now()->subDays(20), 'end_time' => now()->subDays(20)->addHours(2)]);
        Task::factory()->create(['event_id' => null, 'organization_id' => $organization->id, 'created_by' => $outgoing->school_id, 'assigned_to' => $outgoing->school_id, 'academic_semester_id' => $semester->id, 'status' => 'pending', 'title' => 'Liquidate the fund', 'deadline' => now()->addDays(5)]);
        $fake = new NarrativeFakeGenerator(text: '- One task, Liquidate the fund, is with Ana Reyes.');
        $this->app->instance(TextGenerator::class, $fake);
        Sanctum::actingAs($outgoing);

        $response = $this->postJson('/api/officer-handovers/draft-note', ['category' => 'tasks'])->assertOk();

        $response->assertJsonPath('engine', 'claude');
        $response->assertJsonPath('text', '- One task, Liquidate the fund, is with Ana Reyes.');
        $row = AiOutput::findOrFail($response->json('ai_output_id'));
        $item = OfficerHandover::where('election_id', $election->id)->where('category', 'tasks')->sole();
        $this->assertSame(['handover_note', 'officer_handover', $item->id, 'pending', $outgoing->school_id, $organization->id], [$row->feature_type, $row->reference_type, (int) $row->reference_id, $row->decision_status, (int) $row->requested_by, $row->organization_id]);
        $this->assertSame('tasks', $row->structured_input['category']);
        $this->assertStringContainsString('Liquidate the fund', $fake->sent());
        $this->assertStringNotContainsString('Programming Contest', $fake->sent(), 'events belong to another item');
        $this->assertNull($item->fresh()->remarks, 'drafting saves nothing');
        $this->assertSame($contest->title, 'Programming Contest');
    }

    public function test_with_no_model_the_endpoint_answers_from_the_template(): void
    {
        [, , $outgoing] = $this->world();
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);
        Sanctum::actingAs($outgoing);

        $response = $this->postJson('/api/officer-handovers/draft-note', ['category' => 'compliance'])->assertOk();

        $response->assertJsonPath('engine', 'template');
        $this->assertSame('- No compliance requirement is recorded as missing.', $response->json('text'));
    }

    public function test_an_admin_who_is_not_an_incoming_appointee_may_draft(): void
    {
        [$organization] = $this->world();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);
        Sanctum::actingAs($admin);

        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertOk();
    }

    public function test_an_incoming_officer_a_student_and_a_stranger_cannot_draft(): void
    {
        [$organization, $election] = $this->world();
        $incoming = User::factory()->officer()->create(['organization_id' => $organization->id]);
        OfficerAppointment::factory()->create(['organization_id' => $organization->id, 'election_id' => $election->id, 'user_school_id' => $incoming->school_id, 'kind' => 'incoming', 'status' => 'active']);
        $outsiderOrganization = $this->makeCollegeStudentOrganization($this->makeCollege('CBA'));
        $outsider = User::factory()->officer()->create(['organization_id' => $outsiderOrganization->id]);
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);

        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertUnauthorized();

        Sanctum::actingAs($incoming);
        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertForbidden();

        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id]));
        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertForbidden();

        Sanctum::actingAs($outsider);
        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertNotFound();
        $this->assertSame(0, AiOutput::count());
    }

    public function test_the_category_is_required_and_must_be_one_of_the_six(): void
    {
        [, , $outgoing] = $this->world();
        Sanctum::actingAs($outgoing);

        $this->postJson('/api/officer-handovers/draft-note', [])->assertUnprocessable();
        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'budget'])->assertUnprocessable();
    }

    public function test_an_acknowledged_item_is_read_only(): void
    {
        [, $election, $outgoing] = $this->world();
        OfficerHandover::where('election_id', $election->id)->where('category', 'finance')->update(['status' => 'acknowledged']);
        Sanctum::actingAs($outgoing);

        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertStatus(409);
    }

    public function test_with_no_handover_in_force_there_is_nothing_to_draft(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($officer);

        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertNotFound();
    }

    public function test_without_any_semester_the_draft_is_refused(): void
    {
        [$organization, $election, $outgoing, $semester] = $this->world();
        Election::whereKey($election->id)->update(['academic_semester_id' => null]);
        $semester->update(['status' => 'completed']);
        Sanctum::actingAs($outgoing);

        $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertUnprocessable();
    }

    public function test_saving_the_draft_unchanged_counts_as_accepted(): void
    {
        [, , $outgoing] = $this->world();
        $this->app->instance(TextGenerator::class, new NarrativeFakeGenerator);
        Sanctum::actingAs($outgoing);

        $draft = $this->postJson('/api/officer-handovers/draft-note', ['category' => 'finance'])->assertOk();
        $this->postJson("/api/ai/outputs/{$draft->json('ai_output_id')}/outcome", ['final_text' => $draft->json('text')])->assertOk()->assertJsonPath('data.decision_status', 'accepted');
    }
}
