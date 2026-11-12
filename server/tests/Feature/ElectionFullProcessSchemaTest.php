<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionBallot;
use App\Models\ElectionPosition;
use App\Models\ElectionRuleVersion;
use App\Models\OfficerAppointment;
use App\Models\OfficerHandover;
use App\Models\Organization;
use App\Models\Partylist;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ElectionFullProcessSchemaTest extends TestCase
{
    use RefreshDatabase;

    private function migration(string $file)
    {
        return require database_path('migrations/'.$file);
    }

    private function election(array $overrides = []): Election
    {
        return Election::factory()->create(array_merge([
            'organization_id' => Organization::factory()->create()->id,
            'status' => 'upcoming',
        ], $overrides));
    }

    public function test_election_columns_exist_with_their_defaults(): void
    {
        $this->assertTrue(Schema::hasColumns('elections', [
            'description', 'filing_starts_at', 'filing_ends_at', 'screening_starts_at', 'screening_ends_at',
            'campaign_starts_at', 'campaign_ends_at', 'results_publish_at', 'runoff_starts_at', 'runoff_ends_at',
            'runoff_publish_at', 'rules', 'rules_version', 'tie_break_rule', 'min_gpa', 'min_units', 'phase',
            'phase_alert', 'notices_sent', 'submitted_at', 'declined_at', 'suspended_at', 'cancelled_at',
            'completed_at', 'halt_reason', 'tally_version',
        ]));

        $election = $this->election(['status' => 'upcoming'])->fresh();

        $this->assertSame(0, (int) $election->rules_version);
        $this->assertSame(2, (int) $election->tally_version);
        $this->assertNull($election->phase);
        $this->assertNull($election->filing_starts_at);
        $this->assertTrue(Schema::hasIndex('elections', ['phase']));
    }

    public function test_election_positions_columns_exist_with_their_defaults(): void
    {
        $this->assertTrue(Schema::hasColumns('election_positions', [
            'description', 'is_executive', 'vote_limit', 'eligible_year_levels', 'other_qualifications', 'is_active',
            'runoff_candidate_ids', 'runoff_seats', 'result_status', 'resolved_winner_ids', 'tie_rule_used',
            'tie_explanation', 'tie_resolved_by', 'tie_resolved_at',
        ]));

        $position = ElectionPosition::factory()->create(['election_id' => $this->election()->id])->fresh();

        $this->assertFalse($position->is_executive);
        $this->assertTrue($position->is_active);
        $this->assertNull($position->vote_limit);
        $this->assertNull($position->eligible_year_levels);
    }

    public function test_position_json_and_date_columns_are_cast(): void
    {
        $position = ElectionPosition::factory()->create([
            'election_id' => $this->election()->id,
            'eligible_year_levels' => [2, 3],
            'runoff_candidate_ids' => [4, 5],
            'resolved_winner_ids' => [4],
            'tie_resolved_at' => '2026-11-20 10:00:00',
        ])->fresh();

        $this->assertSame([2, 3], $position->eligible_year_levels);
        $this->assertSame([4, 5], $position->runoff_candidate_ids);
        $this->assertSame([4], $position->resolved_winner_ids);
        $this->assertInstanceOf(Carbon::class, $position->tie_resolved_at);
    }

    public function test_election_json_boolean_and_date_columns_are_cast(): void
    {
        $election = $this->election([
            'filing_starts_at' => '2026-11-01 08:00:00',
            'results_publish_at' => '2026-11-30 08:00:00',
            'runoff_publish_at' => '2026-12-05 08:00:00',
            'submitted_at' => '2026-10-30 08:00:00',
            'suspended_at' => '2026-11-02 08:00:00',
            'notices_sent' => ['filing_open' => true],
        ])->fresh();

        $this->assertInstanceOf(Carbon::class, $election->filing_starts_at);
        $this->assertInstanceOf(Carbon::class, $election->results_publish_at);
        $this->assertInstanceOf(Carbon::class, $election->runoff_publish_at);
        $this->assertInstanceOf(Carbon::class, $election->submitted_at);
        $this->assertInstanceOf(Carbon::class, $election->suspended_at);
        $this->assertSame(['filing_open' => true], $election->notices_sent);
    }

    public function test_new_tables_have_their_columns_and_unique_indexes(): void
    {
        $this->assertTrue(Schema::hasColumns('election_rule_versions', [
            'id', 'election_id', 'version', 'rules', 'tie_break_rule', 'approved_by', 'approved_at',
        ]));
        $this->assertTrue(Schema::hasIndex('election_rule_versions', ['election_id', 'version'], 'unique'));

        $this->assertTrue(Schema::hasColumns('partylists', ['motto', 'color', 'election_id', 'representative_school_id']));

        $this->assertTrue(Schema::hasColumns('election_applications', [
            'id', 'election_id', 'position_id', 'user_school_id', 'partylist_id', 'submitted_by', 'status', 'platform',
            'photo_url', 'coc_path', 'credentials_path', 'rules_version', 'rules_accepted_at', 'submitted_at',
            'review_notes', 'reviewed_by', 'reviewed_at', 'candidate_id', 'created_at', 'updated_at',
        ]));
        $this->assertTrue(Schema::hasIndex('election_applications', ['election_id', 'user_school_id'], 'unique'));

        $this->assertTrue(Schema::hasColumns('election_ballots', [
            'id', 'election_id', 'round', 'voter_id', 'receipt_ref', 'submitted_at',
        ]));
        $this->assertTrue(Schema::hasIndex('election_ballots', ['receipt_ref'], 'unique'));
        $this->assertTrue(Schema::hasIndex('election_ballots', ['election_id', 'round', 'voter_id'], 'unique'));

        $this->assertTrue(Schema::hasColumns('votes', ['round']));

        $this->assertTrue(Schema::hasColumns('officer_appointments', [
            'id', 'organization_id', 'election_id', 'election_position_id', 'user_school_id', 'position_title',
            'is_executive', 'role', 'kind', 'academic_year', 'academic_semester_id', 'deadline_at', 'term_starts_on',
            'term_ends_on', 'status', 'activation_status', 'flag', 'result_final_at', 'last_recalculated_at',
            'activated_at', 'ended_at', 'start_notice_at', 'end_notice_at', 'created_at', 'updated_at',
        ]));
        $this->assertTrue(Schema::hasIndex('officer_appointments', ['election_id', 'election_position_id', 'user_school_id'], 'unique'));
        $this->assertTrue(Schema::hasIndex('officer_appointments', ['organization_id', 'status']));

        $this->assertTrue(Schema::hasColumns('officer_handovers', [
            'id', 'organization_id', 'election_id', 'academic_year', 'category', 'reference_url', 'remarks',
            'attachment_path', 'attachment_name', 'status', 'prepared_by', 'prepared_at', 'acknowledged_by',
            'acknowledged_at', 'created_at', 'updated_at',
        ]));
        $this->assertTrue(Schema::hasIndex('officer_handovers', ['election_id', 'category'], 'unique'));
    }

    public function test_elections_backfill_submitted_at_and_tally_version(): void
    {
        $migration = $this->migration('2026_11_13_100001_add_full_process_fields_to_elections.php');
        $migration->down();

        $organizationId = Organization::factory()->create()->id;
        $closedId = DB::table('elections')->insertGetId([
            'organization_id' => $organizationId, 'title' => 'Closed', 'start_time' => '2026-01-01 08:00:00',
            'end_time' => '2026-01-02 08:00:00', 'status' => 'closed', 'created_at' => '2026-01-01 07:00:00',
            'updated_at' => '2026-01-01 07:00:00',
        ]);
        $openId = DB::table('elections')->insertGetId([
            'organization_id' => $organizationId, 'title' => 'Open', 'start_time' => '2026-12-01 08:00:00',
            'end_time' => '2026-12-02 08:00:00', 'status' => 'upcoming', 'created_at' => '2026-11-01 07:00:00',
            'updated_at' => '2026-11-01 07:00:00',
        ]);

        $migration->up();

        $closed = DB::table('elections')->find($closedId);
        $open = DB::table('elections')->find($openId);

        $this->assertSame(1, (int) $closed->tally_version);
        $this->assertSame(2, (int) $open->tally_version);
        $this->assertSame('2026-01-01 07:00:00', $closed->submitted_at);
        $this->assertSame('2026-11-01 07:00:00', $open->submitted_at);
    }

    public function test_ballots_are_backfilled_from_existing_votes_and_voter_id_becomes_nullable(): void
    {
        $migration = $this->migration('2026_11_13_100005_create_election_ballots_and_make_votes_secret.php');
        $migration->down();

        $this->assertFalse(Schema::hasTable('election_ballots'));
        $this->assertFalse(Schema::hasColumn('votes', 'round'));

        $election = $this->election();
        $positions = ElectionPosition::factory()->count(2)->sequence(['title' => 'President'], ['title' => 'Secretary'])
            ->create(['election_id' => $election->id]);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $positions[0]->id]);
        $voterA = User::factory()->student()->create();
        $voterB = User::factory()->student()->create();

        foreach ([[$voterA, $positions[0], 'hash-a1', '2026-11-05 09:00:00'], [$voterA, $positions[1], 'hash-a0', '2026-11-05 08:00:00'], [$voterB, $positions[0], 'hash-b1', '2026-11-06 10:30:00']] as [$voter, $position, $hash, $castAt]) {
            DB::table('votes')->insert([
                'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
                'voter_id' => $voter->school_id, 'vote_hash' => $hash, 'cast_at' => $castAt,
            ]);
        }

        $migration->up();

        $ballots = DB::table('election_ballots')->orderBy('voter_id')->get()->keyBy('voter_id');
        $this->assertCount(2, $ballots);
        $this->assertSame(1, (int) $ballots[$voterA->school_id]->round);
        $this->assertSame('hash-a0', $ballots[$voterA->school_id]->receipt_ref);
        $this->assertSame('2026-11-05 08:00:00', $ballots[$voterA->school_id]->submitted_at);
        $this->assertSame('hash-b1', $ballots[$voterB->school_id]->receipt_ref);
        $this->assertSame('2026-11-06 10:30:00', $ballots[$voterB->school_id]->submitted_at);
        $this->assertSame(1, (int) DB::table('votes')->where('voter_id', $voterA->school_id)->first()->round);
        $this->assertSame(2, DB::table('votes')->where('voter_id', $voterA->school_id)->count());
    }

    public function test_receipt_reference_fits_a_sixteen_character_column(): void
    {
        $migration = $this->migration('2026_11_13_100005_create_election_ballots_and_make_votes_secret.php');
        $migration->down();

        $election = $this->election();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id]);
        $voter = User::factory()->student()->create();
        DB::table('votes')->insert([
            'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
            'voter_id' => $voter->school_id, 'vote_hash' => str_repeat('f', 64), 'cast_at' => '2026-11-05 09:00:00',
        ]);

        $migration->up();

        $reference = DB::table('election_ballots')->value('receipt_ref');
        $this->assertSame(16, strlen($reference));
    }

    public function test_the_same_position_can_hold_two_votes_with_no_voter_id(): void
    {
        $election = $this->election();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id]);

        foreach (['first', 'second'] as $hash) {
            Vote::query()->create([
                'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
                'voter_id' => null, 'vote_hash' => $hash,
            ]);
        }

        $this->assertSame(2, Vote::query()->where('position_id', $position->id)->whereNull('voter_id')->count());
        $this->assertSame(1, Vote::query()->first()->round);
    }

    public function test_the_unique_vote_per_position_index_still_holds_for_a_known_voter(): void
    {
        $this->assertTrue(Schema::hasIndex('votes', ['election_id', 'position_id', 'voter_id'], 'unique'));

        $election = $this->election();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id]);
        $voter = User::factory()->student()->create();

        Vote::factory()->create([
            'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
            'voter_id' => $voter->school_id,
        ]);

        $this->expectException(QueryException::class);
        Vote::factory()->create([
            'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
            'voter_id' => $voter->school_id,
        ]);
    }

    public function test_the_vote_factory_records_the_round_one_ballot_once(): void
    {
        $election = $this->election();
        $positions = ElectionPosition::factory()->count(2)->sequence(['title' => 'President'], ['title' => 'Secretary'])
            ->create(['election_id' => $election->id]);
        $voter = User::factory()->student()->create();

        foreach ($positions as $position) {
            $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id]);
            Vote::factory()->create([
                'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
                'voter_id' => $voter->school_id,
            ]);
        }

        $this->assertSame(1, ElectionBallot::query()->where('election_id', $election->id)->count());
        $this->assertTrue(ElectionBallot::hasVoted($election->id, $voter->school_id));
    }

    public function test_the_vote_factory_makes_no_ballot_for_a_secret_vote(): void
    {
        $election = $this->election();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id]);

        Vote::factory()->create([
            'election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id,
            'voter_id' => null,
        ]);

        $this->assertSame(0, ElectionBallot::query()->count());
    }

    public function test_has_voted_is_per_round(): void
    {
        $election = $this->election();
        $voter = User::factory()->student()->create();
        ElectionBallot::factory()->create(['election_id' => $election->id, 'voter_id' => $voter->school_id, 'round' => 1]);

        $this->assertTrue(ElectionBallot::hasVoted($election->id, $voter->school_id));
        $this->assertTrue(ElectionBallot::hasVoted($election->id, $voter->school_id, 1));
        $this->assertFalse(ElectionBallot::hasVoted($election->id, $voter->school_id, 2));
        $this->assertFalse(ElectionBallot::hasVoted($election->id, $voter->school_id + 1));
    }

    public function test_uses_filing_and_is_halted(): void
    {
        $this->assertFalse($this->election()->usesFiling());
        $this->assertTrue($this->election(['filing_starts_at' => now()->addDay()])->usesFiling());

        $this->assertFalse($this->election()->isHalted());
        $this->assertTrue($this->election(['suspended_at' => now()])->isHalted());
        $this->assertTrue($this->election(['cancelled_at' => now()])->isHalted());
    }

    public function test_open_round_truth_table(): void
    {
        Carbon::setTestNow('2026-11-20 12:00:00');

        $voting = [
            'status' => 'active', 'approved_at' => '2026-11-01 08:00:00', 'finalized_at' => '2026-11-19 08:00:00',
            'start_time' => '2026-11-20 08:00:00', 'end_time' => '2026-11-20 17:00:00',
        ];

        $this->assertSame(1, $this->election($voting)->openRound());
        $this->assertNull($this->election(array_merge($voting, ['suspended_at' => now()]))->openRound());
        $this->assertNull($this->election(array_merge($voting, ['cancelled_at' => now()]))->openRound());
        $this->assertNull($this->election(array_merge($voting, ['status' => 'upcoming']))->openRound());
        $this->assertNull($this->election(array_merge($voting, ['status' => 'closed']))->openRound());
        $this->assertNull($this->election(array_merge($voting, ['approved_at' => null]))->openRound());
        $this->assertNull($this->election(array_merge($voting, ['finalized_at' => null]))->openRound());
        $this->assertNull($this->election(array_merge($voting, ['start_time' => '2026-11-20 13:00:00', 'end_time' => '2026-11-20 17:00:00']))->openRound());
        $this->assertNull($this->election(array_merge($voting, ['start_time' => '2026-11-20 08:00:00', 'end_time' => '2026-11-20 11:00:00']))->openRound());

        $runoff = [
            'status' => 'closed', 'phase' => 'runoff', 'approved_at' => '2026-11-01 08:00:00',
            'finalized_at' => '2026-11-19 08:00:00', 'start_time' => '2026-11-20 08:00:00',
            'end_time' => '2026-11-20 10:00:00', 'runoff_starts_at' => '2026-11-20 11:00:00',
            'runoff_ends_at' => '2026-11-20 13:00:00',
        ];

        $this->assertSame(2, $this->election($runoff)->openRound());
        $this->assertNull($this->election(array_merge($runoff, ['suspended_at' => now()]))->openRound());
        $this->assertNull($this->election(array_merge($runoff, ['phase' => 'tie_resolution']))->openRound());
        $this->assertNull($this->election(array_merge($runoff, ['runoff_starts_at' => '2026-11-20 12:30:00']))->openRound());
        $this->assertNull($this->election(array_merge($runoff, ['runoff_ends_at' => '2026-11-20 11:30:00']))->openRound());
        $this->assertNull($this->election(array_merge($runoff, ['runoff_starts_at' => null, 'runoff_ends_at' => null]))->openRound());

        Carbon::setTestNow();
    }

    public function test_side_of_reads_the_appointment_kind(): void
    {
        $election = $this->election();
        $incoming = User::factory()->student()->create();
        $outgoing = User::factory()->officer()->create();
        $stranger = User::factory()->student()->create();

        OfficerAppointment::factory()->create(['election_id' => $election->id, 'user_school_id' => $incoming->school_id, 'kind' => 'incoming']);
        OfficerAppointment::factory()->create(['election_id' => $election->id, 'user_school_id' => $outgoing->school_id, 'kind' => 'outgoing']);

        $this->assertSame('incoming', OfficerAppointment::sideOf($incoming->school_id, $election->id));
        $this->assertSame('outgoing', OfficerAppointment::sideOf($outgoing->school_id, $election->id));
        $this->assertNull(OfficerAppointment::sideOf($stranger->school_id, $election->id));
        $this->assertNull(OfficerAppointment::sideOf($incoming->school_id, $election->id + 1));
    }

    public function test_ensure_for_creates_the_six_handover_rows_once(): void
    {
        $election = $this->election();

        OfficerHandover::ensureFor($election);
        OfficerHandover::ensureFor($election);

        $rows = OfficerHandover::query()->where('election_id', $election->id)->get()->keyBy('category');
        $this->assertCount(6, $rows);
        $this->assertSame(['compliance', 'election', 'events', 'finance', 'organization', 'tasks'], $rows->keys()->sort()->values()->all());
        $this->assertSame('pending', $rows['finance']->status);
        $this->assertSame($election->organization_id, $rows['finance']->organization_id);
        $this->assertSame('/dashboard/finance', $rows['finance']->reference_url);
        $this->assertSame('/dashboard/events', $rows['events']->reference_url);
        $this->assertSame('/dashboard/tasks', $rows['tasks']->reference_url);
        $this->assertSame('/dashboard/records', $rows['organization']->reference_url);
        $this->assertSame('/dashboard/elections/election-results', $rows['election']->reference_url);
        $this->assertSame('/dashboard/compliance', $rows['compliance']->reference_url);
    }

    public function test_ensure_for_keeps_edited_rows(): void
    {
        $election = $this->election();
        OfficerHandover::ensureFor($election);
        OfficerHandover::query()->where('election_id', $election->id)->where('category', 'finance')
            ->update(['remarks' => 'Ledger is closed.', 'status' => 'prepared']);

        OfficerHandover::ensureFor($election);

        $finance = OfficerHandover::query()->where('election_id', $election->id)->where('category', 'finance')->first();
        $this->assertSame('Ledger is closed.', $finance->remarks);
        $this->assertSame('prepared', $finance->status);
    }

    public function test_relations_resolve(): void
    {
        $election = $this->election();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
        $student = User::factory()->student()->create();
        $partylist = Partylist::query()->create(['name' => 'Slate A']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id]);

        $application = ElectionApplication::factory()->create([
            'election_id' => $election->id, 'position_id' => $position->id, 'user_school_id' => $student->school_id,
            'partylist_id' => $partylist->id, 'candidate_id' => $candidate->id,
        ]);
        $version = ElectionRuleVersion::factory()->create(['election_id' => $election->id, 'version' => 1]);
        $ballot = ElectionBallot::factory()->create(['election_id' => $election->id]);
        $appointment = OfficerAppointment::factory()->create(['election_id' => $election->id, 'election_position_id' => $position->id]);

        $this->assertSame('draft', $application->fresh()->status);
        $this->assertTrue($application->election->is($election));
        $this->assertTrue($application->position->is($position));
        $this->assertTrue($application->partylist->is($partylist));
        $this->assertTrue($application->candidate->is($candidate));
        $this->assertTrue($application->user->is($student));

        $this->assertTrue($election->applications->first()->is($application));
        $this->assertTrue($election->ruleVersions->first()->is($version));
        $this->assertTrue($election->ballots->first()->is($ballot));
        $this->assertTrue($election->appointments->first()->is($appointment));
    }

    public function test_new_model_factories_pin_their_default_statuses(): void
    {
        $election = $this->election();

        $appointment = OfficerAppointment::factory()->create(['election_id' => $election->id]);
        $this->assertSame('incoming', $appointment->kind);
        $this->assertSame('upcoming', $appointment->status);
        $this->assertSame('scheduled', $appointment->activation_status);

        $handover = OfficerHandover::factory()->create(['election_id' => $election->id]);
        $this->assertSame('pending', $handover->status);

        $this->assertSame('draft', ElectionApplication::factory()->create(['election_id' => $election->id])->status);
        $this->assertSame(1, ElectionBallot::factory()->create(['election_id' => $election->id])->round);
        $this->assertSame(16, strlen(ElectionBallot::factory()->create(['election_id' => $election->id])->receipt_ref));
    }

    public function test_each_migration_rolls_back_and_up_again(): void
    {
        $files = [
            '2026_11_13_100007_create_officer_handovers_table.php',
            '2026_11_13_100006_create_officer_appointments_table.php',
            '2026_11_13_100005_create_election_ballots_and_make_votes_secret.php',
            '2026_11_13_100004_create_election_applications_and_extend_partylists.php',
            '2026_11_13_100003_create_election_rule_versions_table.php',
            '2026_11_13_100002_add_full_process_fields_to_election_positions.php',
            '2026_11_13_100001_add_full_process_fields_to_elections.php',
        ];

        foreach ($files as $file) {
            $this->migration($file)->down();
        }

        $this->assertFalse(Schema::hasTable('officer_handovers'));
        $this->assertFalse(Schema::hasTable('officer_appointments'));
        $this->assertFalse(Schema::hasTable('election_ballots'));
        $this->assertFalse(Schema::hasTable('election_applications'));
        $this->assertFalse(Schema::hasTable('election_rule_versions'));
        $this->assertFalse(Schema::hasColumn('elections', 'tally_version'));
        $this->assertFalse(Schema::hasColumn('election_positions', 'is_executive'));
        $this->assertFalse(Schema::hasColumn('partylists', 'motto'));
        $this->assertFalse(Schema::hasColumn('votes', 'round'));

        foreach (array_reverse($files) as $file) {
            $this->migration($file)->up();
        }

        $this->assertTrue(Schema::hasTable('officer_handovers'));
        $this->assertTrue(Schema::hasColumn('elections', 'tally_version'));
        $this->assertTrue(Schema::hasIndex('votes', ['election_id', 'position_id', 'voter_id'], 'unique'));
    }
}
