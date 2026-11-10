<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ElectionHandoverTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = $this->makeCollegeStudentOrganization($this->makeCollege('CCS'));
        $this->admin = $this->member('ADMIN', 'President');
    }

    private function member(string $role, ?string $title = null): User
    {
        $user = User::factory()->create(['organization_id' => $this->organization->id, 'role' => $role, 'position_title' => $title]);
        AccountProfile::updateOrCreate(
            ['user_school_id' => $user->school_id, 'organization_id' => $this->organization->id],
            ['role' => $role, 'account_status' => 'active', 'position_title' => $title],
        );

        return $user;
    }

    private function profile(User $user): ?AccountProfile
    {
        return AccountProfile::where('user_school_id', $user->school_id)->where('organization_id', $this->organization->id)->first();
    }

    private function access(User $user): ?AccountProfile
    {
        $profile = $this->profile($user);

        return $profile && $profile->role !== 'STUDENT' ? $profile : null;
    }

    private function closedElection(bool $visible = false): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->organization->id,
            'status' => 'closed',
            'start_time' => now()->subDays(3),
            'end_time' => now()->subDay(),
            'approved_at' => now()->subDays(4),
            'finalized_at' => now()->subDays(4),
            'results_visible' => $visible,
        ]);
    }

    /** @param  array<int, int>  $votesByCandidate  candidate user => vote count */
    private function position(Election $election, string $title, array $votesByCandidate, int $seats = 1): array
    {
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => $title, 'max_winners' => $seats]);
        $users = [];
        foreach ($votesByCandidate as $votes) {
            $user = User::factory()->student()->create(['organization_id' => $this->organization->id]);
            $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $user->school_id]);
            for ($i = 0; $i < $votes; $i++) {
                Vote::create([
                    'election_id' => $election->id,
                    'position_id' => $position->id,
                    'candidate_id' => $candidate->id,
                    'voter_id' => User::factory()->student()->create(['organization_id' => $this->organization->id])->school_id,
                    'vote_hash' => bin2hex(random_bytes(16)),
                ]);
            }
            $users[] = $user;
        }

        return $users;
    }

    private function release(Election $election)
    {
        Sanctum::actingAs($this->admin);

        return $this->putJson('/api/elections/'.$election->id, ['results_visible' => true]);
    }

    public function test_the_winner_of_a_head_position_becomes_an_admin_and_is_told(): void
    {
        $election = $this->closedElection();
        [$winner] = $this->position($election, 'President', [5, 2]);

        $this->release($election)->assertOk();

        $profile = $this->profile($winner);
        $this->assertSame('ADMIN', $profile->role);
        $this->assertSame('President', $profile->position_title);
        $this->assertSame('active', $profile->account_status);
        $this->assertNull($profile->modules ?? null);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $winner->school_id,
            'organization_id' => $this->organization->id,
            'title' => 'You now have access to '.$this->organization->name,
        ]);
        $this->assertNotNull($election->fresh()->access_handed_over_at);
    }

    public function test_other_positions_become_officers_and_listed_head_titles_become_admins(): void
    {
        SboPosition::create(['organization_id' => $this->organization->id, 'role' => 'ADMIN', 'title' => 'Chairperson']);
        $election = $this->closedElection();
        [$chair] = $this->position($election, 'chairperson', [3]);
        [$secretary] = $this->position($election, 'Secretary', [4, 1]);

        $this->release($election)->assertOk();

        $this->assertSame('ADMIN', $this->profile($chair)->role);
        $this->assertSame('SBO_OFFICER', $this->profile($secretary)->role);
        $this->assertSame('Secretary', $this->profile($secretary)->position_title);
    }

    public function test_an_unlisted_vice_president_becomes_an_officer_not_an_admin(): void
    {
        $election = $this->closedElection();
        [$vp] = $this->position($election, 'Vice President', [3]);
        [$vpFinance] = $this->position($election, 'Vice President for Finance', [3]);
        [$president] = $this->position($election, '  PRESIDENT ', [3]);

        $this->release($election)->assertOk();

        $this->assertSame('SBO_OFFICER', $this->profile($vp)->role);
        $this->assertSame('SBO_OFFICER', $this->profile($vpFinance)->role);
        $this->assertSame('ADMIN', $this->profile($president)->role);
    }

    public function test_a_tie_grants_nothing_and_the_results_flag_it(): void
    {
        $election = $this->closedElection();
        [$first, $second] = $this->position($election, 'Treasurer', [3, 3]);

        $this->release($election)->assertOk();

        $this->assertNull($this->access($first));
        $this->assertNull($this->access($second));
        $this->assertSame(0, Notification::where('reference_type', 'election')->where('reference_id', $election->id)->count());

        $row = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json('0');
        $this->assertTrue($row['tie']);
        $this->assertSame([], $row['winner_ids']);
        $this->assertFalse($row['access_handed_over']);
    }

    public function test_a_position_nobody_voted_for_grants_nothing(): void
    {
        $election = $this->closedElection();
        [$candidate] = $this->position($election, 'Auditor', [0]);

        $this->release($election)->assertOk();

        $this->assertNull($this->access($candidate));
    }

    public function test_a_tie_that_straddles_the_last_seat_keeps_only_those_ahead(): void
    {
        $election = $this->closedElection();
        [$top, $tiedA, $tiedB] = $this->position($election, 'Senator', [9, 4, 4], 2);

        $this->release($election)->assertOk();

        $this->assertSame('SBO_OFFICER', $this->profile($top)->role);
        $this->assertNull($this->access($tiedA));
        $this->assertNull($this->access($tiedB));
    }

    public function test_an_outgoing_officer_is_told_the_profile_is_unavailable_so_the_client_can_sign_out(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->closedElection();
        $this->position($election, 'Secretary', [6, 1]);

        $this->release($election)->assertOk();

        Sanctum::actingAs($outgoing);
        $this->getJson('/api/elections')
            ->assertForbidden()
            ->assertJson(['message' => 'This account profile is unavailable.', 'error_code' => 'PROFILE_UNAVAILABLE']);
    }

    public function test_every_winner_of_a_multi_seat_position_gets_access(): void
    {
        $election = $this->closedElection();
        [$one, $two, $three] = $this->position($election, 'Representative', [9, 6, 2], 2);

        $this->release($election)->assertOk();

        $this->assertNotNull($this->access($one));
        $this->assertNotNull($this->access($two));
        $this->assertNull($this->access($three));
    }

    public function test_outgoing_holders_of_the_same_position_are_deactivated_and_other_admins_are_left(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $deansAdmin = $this->member('ADMIN', 'Org Head');
        $otherOfficer = $this->member('SBO_OFFICER', 'Treasurer');
        $election = $this->closedElection();
        [$winner] = $this->position($election, 'secretary', [6, 1]);

        $this->release($election)->assertOk();

        $this->assertSame('inactive', $this->profile($outgoing)->account_status);
        $this->assertSame('active', $this->profile($deansAdmin)->account_status);
        $this->assertSame('ADMIN', $this->profile($deansAdmin)->role);
        $this->assertSame('active', $this->profile($otherOfficer)->account_status);
        $this->assertSame('active', $this->profile($this->admin)->account_status);
        $this->assertSame('secretary', strtolower($this->profile($winner)->position_title));
    }

    public function test_an_outgoing_holder_who_is_re_elected_stays_active(): void
    {
        $holder = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->closedElection();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'Secretary']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $holder->school_id]);
        Vote::create(['election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id, 'voter_id' => $this->admin->school_id, 'vote_hash' => 'h1']);

        $this->release($election)->assertOk();

        $this->assertSame('active', $this->profile($holder)->account_status);
    }

    public function test_a_dean_granted_admin_keeps_access_when_winning_an_officer_seat(): void
    {
        $head = $this->member('ADMIN', 'Org Head');
        $election = $this->closedElection();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'Secretary']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $head->school_id]);
        Vote::create(['election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id, 'voter_id' => $this->admin->school_id, 'vote_hash' => 'h2']);

        $this->release($election)->assertOk();

        $this->assertSame('ADMIN', $this->profile($head)->role);
        $this->assertSame('Org Head', $this->profile($head)->position_title);
    }

    public function test_a_winner_with_a_module_limited_profile_gets_every_area(): void
    {
        $officer = $this->member('SBO_OFFICER', 'Treasurer');
        $this->profile($officer)->update(['modules' => ['events']]);
        $election = $this->closedElection();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'Secretary']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $officer->school_id]);
        Vote::create(['election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id, 'voter_id' => $this->admin->school_id, 'vote_hash' => 'h3']);

        $this->release($election)->assertOk();

        $profile = $this->profile($officer)->fresh();
        $this->assertSame('Secretary', $profile->position_title);
        $this->assertNull($profile->modules);
    }

    public function test_a_second_release_does_nothing_more(): void
    {
        $election = $this->closedElection();
        [$winner] = $this->position($election, 'Secretary', [4, 1]);

        $this->release($election)->assertOk();
        $this->profile($winner)->update(['account_status' => 'inactive']);

        $this->release($election)->assertOk();
        $this->putJson('/api/elections/'.$election->id, ['results_visible' => false])->assertOk();
        $this->putJson('/api/elections/'.$election->id, ['results_visible' => true])->assertOk();

        $this->assertSame('inactive', $this->profile($winner)->account_status);
        $this->assertSame(1, Notification::where('user_id', $winner->school_id)->where('reference_type', 'election')->count());
        $this->assertSame(1, AuditLog::where('action', 'access_handed_over')->where('record_id', $election->id)->count());
    }

    public function test_hidden_results_do_nothing(): void
    {
        $election = $this->closedElection();
        [$winner] = $this->position($election, 'Secretary', [4, 1]);

        Sanctum::actingAs($this->admin);
        $this->putJson('/api/elections/'.$election->id, ['results_visible' => false])->assertOk();

        $this->assertNull($this->access($winner));
        $this->assertNull($election->fresh()->access_handed_over_at);
    }

    public function test_an_election_that_is_not_closed_does_nothing(): void
    {
        $election = $this->closedElection();
        $election->update(['status' => 'active', 'end_time' => now()->addDay()]);
        [$winner] = $this->position($election, 'Secretary', [4, 1]);

        $this->release($election)->assertOk();

        $this->assertNull($this->access($winner));
        $this->assertNull($election->fresh()->access_handed_over_at);
    }

    public function test_the_hand_over_is_audited(): void
    {
        $election = $this->closedElection();
        [$winner] = $this->position($election, 'Secretary', [4, 1]);

        $this->release($election)->assertOk();

        $log = AuditLog::where('action', 'access_handed_over')->where('record_id', $election->id)->firstOrFail();
        $this->assertSame($this->admin->school_id, (int) $log->user_id);
        $this->assertSame($winner->school_id, $log->new_values['granted'][0]['school_id']);
    }

    public function test_voting_that_ends_with_results_showing_hands_over_on_the_scheduled_sync(): void
    {
        $election = $this->closedElection(true);
        $election->update(['status' => 'active', 'end_time' => now()->subMinute()]);
        [$winner] = $this->position($election, 'Secretary', [4, 1]);

        Election::synchronizeScheduledStatuses();

        $this->assertSame('SBO_OFFICER', $this->profile($winner)->role);
        $this->assertNotNull($election->fresh()->access_handed_over_at);
    }

    public function test_results_report_winners_and_the_handed_over_state(): void
    {
        $election = $this->closedElection();
        [$winner] = $this->position($election, 'Secretary', [4, 1]);
        $this->release($election)->assertOk();

        $row = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json('0');

        $this->assertFalse($row['tie']);
        $this->assertTrue($row['access_handed_over']);
        $this->assertCount(1, $row['winner_ids']);
        $this->assertSame($winner->first_name, explode(' ', $row['candidates'][0]['name'])[0]);
    }

    private function vote(Election $election, ElectionPosition $position, Candidate $candidate, string $hash): void
    {
        Vote::create(['election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id, 'voter_id' => $this->admin->school_id, 'vote_hash' => $hash]);
    }

    public function test_an_incumbent_head_who_loses_their_seat_but_wins_another_keeps_access_as_the_new_title(): void
    {
        $incumbent = $this->member('ADMIN', 'President');
        $election = $this->closedElection();
        [$president] = $this->position($election, 'President', [5]);
        $vice = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'Vice President']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $vice->id, 'user_id' => $incumbent->school_id]);
        $this->vote($election, $vice, $candidate, 'h-vp');

        $this->release($election)->assertOk();

        $profile = $this->profile($incumbent);
        $this->assertSame('active', $profile->account_status);
        $this->assertSame('SBO_OFFICER', $profile->role);
        $this->assertSame('Vice President', $profile->position_title);
        $this->assertSame('ADMIN', $this->profile($president)->role);
        $deactivated = AuditLog::where('action', 'access_handed_over')->first()->new_values['deactivated'];
        $this->assertNotContains($incumbent->school_id, $deactivated);
    }

    public function test_a_winner_deactivated_for_cause_is_not_reactivated_and_the_results_say_so(): void
    {
        $winner = $this->member('STUDENT');
        AccountProfile::where('user_school_id', $winner->school_id)->update(['account_status' => 'inactive']);
        $election = $this->closedElection();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'Secretary']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $winner->school_id]);
        $this->vote($election, $position, $candidate, 'h-sec');

        $this->release($election)->assertOk();

        $profile = $this->profile($winner);
        $this->assertSame('inactive', $profile->account_status);
        $this->assertSame('STUDENT', $profile->role);
        $this->assertDatabaseMissing('notifications', ['user_id' => $winner->school_id, 'title' => 'You now have access to '.$this->organization->name]);
        $audit = AuditLog::where('action', 'access_handed_over')->first()->new_values;
        $this->assertSame([], $audit['granted']);
        $this->assertSame($winner->school_id, $audit['skipped'][0]['school_id']);
        $row = $this->getJson('/api/elections/'.$election->id.'/results')->assertOk()->json('0');
        $this->assertSame([$candidate->id], $row['winner_ids']);
        $this->assertFalse($row['access_handed_over']);
    }

    public function test_a_winner_whose_own_account_is_deactivated_is_not_given_access(): void
    {
        $winner = $this->member('STUDENT');
        User::where('school_id', $winner->school_id)->update(['account_status' => 'inactive']);
        $election = $this->closedElection();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'Secretary']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $winner->school_id]);
        $this->vote($election, $position, $candidate, 'h-sec2');

        $this->release($election)->assertOk();

        $this->assertSame('STUDENT', $this->profile($winner)->role);
        $this->assertSame([], AuditLog::where('action', 'access_handed_over')->first()->new_values['granted']);
    }
}
