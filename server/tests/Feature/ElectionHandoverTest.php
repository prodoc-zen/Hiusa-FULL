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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
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

    private function signIn(User $user)
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/login', ['school_id' => $user->school_id, 'password' => 'password']);
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

    public function test_other_positions_become_officers_even_when_the_organization_lists_them_as_admin(): void
    {
        SboPosition::create(['organization_id' => $this->organization->id, 'role' => 'ADMIN', 'title' => 'Chairperson']);
        $election = $this->closedElection();
        [$chair] = $this->position($election, 'chairperson', [3]);
        [$secretary] = $this->position($election, 'Secretary', [4, 1]);

        $this->release($election)->assertOk();

        $this->assertSame('SBO_OFFICER', $this->profile($chair)->role);
        $this->assertSame('SBO_OFFICER', $this->profile($secretary)->role);
        $this->assertSame('Secretary', $this->profile($secretary)->position_title);
    }

    public function test_the_president_and_every_vice_president_become_admins(): void
    {
        $election = $this->closedElection();
        [$vp] = $this->position($election, 'Vice President', [3]);
        [$vpFinance] = $this->position($election, 'Vice President for Finance', [3]);
        [$vpInternal] = $this->position($election, 'Vice President – Internal', [3]);
        [$vpExternal] = $this->position($election, ' vice-president   EXTERNAL ', [3]);
        [$president] = $this->position($election, '  PRESIDENT ', [3]);

        $this->release($election)->assertOk();

        foreach ([$vp, $vpFinance, $vpInternal, $vpExternal, $president] as $winner) {
            $this->assertSame('ADMIN', $this->profile($winner)->role);
        }
        $this->assertSame('Vice President – Internal', $this->profile($vpInternal)->position_title);
    }

    public function test_only_a_title_that_is_a_vice_president_seat_becomes_admin(): void
    {
        $election = $this->closedElection();
        [$aide] = $this->position($election, 'Vice Presidential Aide', [3]);
        [$assistant] = $this->position($election, "Vice President's Assistant", [3]);
        [$hyphen] = $this->position($election, 'Vice-President', [3]);
        [$academic] = $this->position($election, 'Vice President for Academic Affairs', [3]);

        $this->release($election)->assertOk();

        $this->assertSame('SBO_OFFICER', $this->profile($aide)->role);
        $this->assertSame('SBO_OFFICER', $this->profile($assistant)->role);
        $this->assertSame('ADMIN', $this->profile($hyphen)->role);
        $this->assertSame('ADMIN', $this->profile($academic)->role);
    }

    public function test_a_seat_spelled_with_a_dash_demotes_the_incumbent_spelled_with_a_space(): void
    {
        $incumbent = $this->member('ADMIN', 'Vice President');
        $election = $this->closedElection();
        [$winner] = $this->position($election, 'Vice-President', [4, 1]);

        $this->release($election)->assertOk();

        $this->assertSame(['STUDENT', 'active', null], $this->held($incumbent));
        $this->assertSame('ADMIN', $this->profile($winner)->role);
    }

    public function test_the_standard_titles_listed_under_both_roles_still_split_admin_from_officer(): void
    {
        $titles = ['President', 'Vice President – Internal', 'Vice President – External', 'Secretary', 'Assistant Secretary', 'Treasurer', 'Auditor', 'Public Information Officer', 'Representative', 'Business Manager'];
        foreach ($titles as $title) {
            foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
                SboPosition::create(['organization_id' => $this->organization->id, 'role' => $role, 'title' => $title]);
            }
        }
        $election = $this->closedElection();
        $winners = [];
        foreach ($titles as $title) {
            [$winners[$title]] = $this->position($election, $title, [3]);
        }

        $this->release($election)->assertOk();

        foreach ($titles as $title) {
            $expected = ($title === 'President' || str_starts_with($title, 'Vice President')) ? 'ADMIN' : 'SBO_OFFICER';
            $this->assertSame($expected, $this->profile($winners[$title])->role, $title);
            $this->assertSame($title, $this->profile($winners[$title])->position_title);
        }
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

    public function test_an_outgoing_officer_stays_in_the_organization_as_a_plain_student(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        AccountProfile::where('user_school_id', $outgoing->school_id)->update(['modules' => ['events']]);
        $election = $this->closedElection();
        $this->position($election, 'Secretary', [6, 1]);

        $this->release($election)->assertOk();

        $profile = $this->profile($outgoing);
        $this->assertSame('STUDENT', $profile->role);
        $this->assertNull($profile->position_title);
        $this->assertNull($profile->modules);
        $this->assertSame('active', $profile->account_status);
        $this->assertSame($this->organization->id, $profile->organization_id);
        // The account row of a member whose home is this organization carries the title too; it must not show it again.
        $this->assertDatabaseHas('users', ['school_id' => $outgoing->school_id, 'position_title' => null]);
        $this->assertNull($outgoing->fresh()->position_title);

        Sanctum::actingAs($outgoing);
        $this->getJson('/api/elections')->assertOk();
    }

    public function test_an_outgoing_officer_stays_on_the_voter_roll_for_the_next_election(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->closedElection();
        $this->position($election, 'Secretary', [6, 1]);

        $this->release($election)->assertOk();

        $this->assertTrue(AccountProfile::votingMembers()->where('organization_id', $this->organization->id)->where('user_school_id', $outgoing->school_id)->exists());
    }

    public function test_a_winner_signs_in_as_the_role_the_hand_over_gave_them(): void
    {
        $election = $this->closedElection();
        [$president] = $this->position($election, 'President', [5, 2]);
        [$secretary] = $this->position($election, 'Secretary', [4, 1]);

        $this->release($election)->assertOk();

        $token = $this->signIn($president)->assertOk()
            ->assertJsonPath('user.role', 'ADMIN')
            ->assertJsonPath('user.position_title', 'President')
            ->assertJsonPath('user.organization_id', $this->organization->id)
            ->json('access_token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/user')->assertOk()->assertJsonPath('role', 'ADMIN');
        $this->withToken($token)->getJson('/api/account-profiles')->assertOk();

        $token = $this->signIn($secretary)->assertOk()
            ->assertJsonPath('user.role', 'SBO_OFFICER')
            ->assertJsonPath('user.position_title', 'Secretary')
            ->json('access_token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/user')->assertOk()->assertJsonPath('role', 'SBO_OFFICER');
        $this->withToken($token)->getJson('/api/users')->assertOk();
    }

    public function test_a_winner_whose_account_lives_elsewhere_can_switch_to_the_new_profile(): void
    {
        $home = Organization::factory()->create();
        $winner = User::factory()->student()->create(['organization_id' => $home->id]);
        $election = $this->closedElection();
        $position = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'President']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'user_id' => $winner->school_id]);
        Vote::create(['election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id, 'voter_id' => $this->admin->school_id, 'vote_hash' => 'h4']);

        $this->release($election)->assertOk();

        $token = $this->signIn($winner)->assertOk()
            ->assertJsonPath('user.role', 'STUDENT')
            ->assertJsonPath('user.organization_id', $home->id)
            ->json('access_token');
        $this->app['auth']->forgetGuards();
        $profile = collect($this->withToken($token)->getJson('/api/user/profiles')->assertOk()->json('profiles'))->firstWhere('organization_id', $this->organization->id);

        $this->assertSame('ADMIN', $profile['role']);
        $this->withToken($token)->postJson('/api/user/profiles/'.$profile['id'].'/switch')
            ->assertOk()->assertJsonPath('user.role', 'ADMIN')->assertJsonPath('user.organization_id', $this->organization->id);
        $this->withToken($token)->getJson('/api/account-profiles')->assertOk();
    }

    public function test_a_replaced_officer_still_signs_in_as_a_student_of_the_organization(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->closedElection();
        $this->position($election, 'Secretary', [6, 1]);

        $this->release($election)->assertOk();

        $this->signIn($outgoing)->assertOk()
            ->assertJsonPath('user.role', 'STUDENT')
            ->assertJsonPath('user.organization_id', $this->organization->id);
    }

    public function test_a_replaced_officer_keeps_every_profile_they_had(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $other = Organization::factory()->create();
        AccountProfile::create(['user_school_id' => $outgoing->school_id, 'organization_id' => $other->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $election = $this->closedElection();
        $this->position($election, 'Secretary', [6, 1]);

        $this->release($election)->assertOk();

        $token = $this->signIn($outgoing)->assertOk()->json('access_token');
        $this->app['auth']->forgetGuards();
        $profiles = collect($this->withToken($token)->getJson('/api/user/profiles')->assertOk()->json('profiles'));
        $here = $profiles->firstWhere('organization_id', $this->organization->id);

        $this->assertCount(2, $profiles);
        $this->assertSame('STUDENT', $here['role']);
    }

    public function test_a_profile_switched_off_for_another_reason_does_not_claim_a_hand_over(): void
    {
        $member = $this->member('SBO_OFFICER', 'Secretary');
        $this->profile($member)->update(['account_status' => 'disabled']);

        $this->signIn($member)->assertForbidden()->assertJsonPath('message', 'This account profile is unavailable.');

        Sanctum::actingAs($member);
        $this->getJson('/api/elections')->assertForbidden()->assertJson(['message' => 'This account profile is unavailable.', 'error_code' => 'PROFILE_UNAVAILABLE']);
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

    public function test_outgoing_holders_of_the_same_position_become_students_and_other_admins_are_left(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $deansAdmin = $this->member('ADMIN', 'Org Head');
        $otherOfficer = $this->member('SBO_OFFICER', 'Treasurer');
        $election = $this->closedElection();
        [$winner] = $this->position($election, 'secretary', [6, 1]);

        $this->release($election)->assertOk();

        $this->assertSame(['STUDENT', 'active', null], $this->held($outgoing));
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
        $this->assertSame('ADMIN', $profile->role);
        $this->assertSame('Vice President', $profile->position_title);
        $this->assertSame('ADMIN', $this->profile($president)->role);
        $demoted = AuditLog::where('action', 'access_handed_over')->first()->new_values['demoted'];
        $this->assertNotContains($incumbent->school_id, $demoted);
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

    /** Hands the organization to the winner of a seat: their profile moves, and their account row keeps the role it had. */
    private function elected(string $title): User
    {
        $election = $this->closedElection();
        [$winner] = $this->position($election, $title, [5, 2]);

        $this->release($election)->assertOk();

        return $winner;
    }

    /** Another Admin of the organization, signed in. */
    private function colleague(): User
    {
        $colleague = $this->member('ADMIN', 'Org Head');
        Sanctum::actingAs($colleague);

        return $colleague;
    }

    private function accountRowRole(User $user): string
    {
        return (string) DB::table('users')->where('school_id', $user->school_id)->value('role');
    }

    private function resetTokens(User $user): int
    {
        return DB::table('password_reset_tokens')->where('email', $user->email)->count();
    }

    /** @return array{0: string, 1: string, 2: ?string} */
    private function held(User $user): array
    {
        $profile = $this->profile($user)->fresh();

        return [$profile->role, $profile->account_status, $profile->position_title];
    }

    public function test_an_admin_cannot_start_a_password_reset_for_a_member_just_elected_president(): void
    {
        Mail::fake();
        $president = $this->elected('President');
        $this->assertSame('STUDENT', $this->accountRowRole($president));
        $this->assertSame('ADMIN', $this->profile($president)->role);
        $this->colleague();

        $this->postJson('/api/users/'.$president->school_id.'/password-reset')
            ->assertStatus(409)
            ->assertJsonPath('message', 'Ask the SAO to reset this password.');
        $this->assertSame(0, $this->resetTokens($president));
    }

    public function test_an_active_profile_with_elevated_access_here_makes_the_reset_the_saos_whatever_the_account_row_says(): void
    {
        Mail::fake();
        $this->colleague();

        foreach (['ADMIN', 'DEPARTMENT_HEAD', 'SUPER_ADMIN'] as $role) {
            $member = User::factory()->student()->create(['organization_id' => $this->organization->id]);
            $this->profile($member)->update(['role' => $role]);

            $this->postJson('/api/users/'.$member->school_id.'/password-reset')->assertStatus(409);
            $this->assertSame(0, $this->resetTokens($member), $role);
        }
    }

    public function test_a_member_elected_an_officer_can_still_have_their_password_reset_by_the_admin(): void
    {
        Mail::fake();
        $secretary = $this->elected('Secretary');
        $this->colleague();

        $this->postJson('/api/users/'.$secretary->school_id.'/password-reset')->assertOk();
        $this->assertSame(1, $this->resetTokens($secretary));
    }

    public function test_an_outgoing_president_who_wins_secretary_can_have_their_password_reset_by_the_admin(): void
    {
        Mail::fake();
        $incumbent = $this->member('ADMIN', 'President');
        $election = $this->closedElection();
        $this->position($election, 'President', [5]);
        $secretary = ElectionPosition::factory()->create(['election_id' => $election->id, 'title' => 'Secretary']);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $secretary->id, 'user_id' => $incumbent->school_id]);
        $this->vote($election, $secretary, $candidate, 'h-sec-reset');

        $this->release($election)->assertOk();

        $this->assertSame('ADMIN', $this->accountRowRole($incumbent));
        $this->assertSame(['SBO_OFFICER', 'active', 'Secretary'], $this->held($incumbent));
        $this->colleague();

        $this->postJson('/api/users/'.$incumbent->school_id.'/password-reset')->assertOk();
        $this->assertSame(1, $this->resetTokens($incumbent));
        $this->assertDatabaseCount('password_reset_tokens', 1);
    }

    public function test_an_officer_the_hand_over_replaced_is_an_active_student_who_can_have_a_password_reset(): void
    {
        Mail::fake();
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->closedElection();
        $this->position($election, 'Secretary', [6, 1]);
        $this->release($election)->assertOk();
        $this->colleague();

        $this->postJson('/api/users/'.$outgoing->school_id.'/password-reset')->assertOk();
        $this->assertSame(1, $this->resetTokens($outgoing));
        $this->assertSame(['STUDENT', 'active', null], $this->held($outgoing));
    }

    public function test_the_hand_over_audit_lists_who_was_stepped_down_to_student(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->closedElection();
        $this->position($election, 'Secretary', [6, 1]);

        $this->release($election)->assertOk();

        $values = AuditLog::where('action', 'access_handed_over')->where('record_id', $election->id)->firstOrFail()->new_values;
        $this->assertSame([$outgoing->school_id], $values['demoted']);
        $this->assertArrayNotHasKey('deactivated', $values);
    }

    public function test_editing_a_member_elected_president_answers_with_the_role_they_hold(): void
    {
        $president = $this->elected('President');
        $this->colleague();

        $this->putJson('/api/users/'.$president->school_id, ['first_name' => 'Renamed'])
            ->assertOk()
            ->assertJsonPath('first_name', 'Renamed')
            ->assertJsonPath('role', 'ADMIN')
            ->assertJsonPath('position_title', 'President');

        $audit = AuditLog::where('module', 'users')->where('action', 'updated')->firstOrFail();
        $this->assertSame('ADMIN', $audit->old_values['role']);
        $this->assertSame('ADMIN', $audit->new_values['role']);
        $this->assertSame('President', $audit->new_values['position_title']);
    }

    public function test_an_ordinary_edit_never_writes_the_stale_account_role_over_a_hand_over_profile(): void
    {
        SboPosition::create(['organization_id' => $this->organization->id, 'role' => 'ADMIN', 'title' => 'Chairperson']);
        SboPosition::create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer']);
        $secretary = $this->elected('Secretary');
        $president = $this->elected('President');
        $this->colleague();

        $this->putJson('/api/users/'.$president->school_id, ['first_name' => 'Renamed'])->assertOk();
        $this->putJson('/api/users/'.$secretary->school_id, ['first_name' => 'Renamed'])->assertOk();
        $this->assertSame(['ADMIN', 'active', 'President'], $this->held($president));
        $this->assertSame(['SBO_OFFICER', 'active', 'Secretary'], $this->held($secretary));

        $this->putJson('/api/users/'.$president->school_id, ['position_title' => 'Chairperson'])->assertOk();
        $this->putJson('/api/users/'.$secretary->school_id, ['position_title' => 'Treasurer'])->assertOk();
        $this->assertSame(['ADMIN', 'active', 'Chairperson'], $this->held($president));
        $this->assertSame(['SBO_OFFICER', 'active', 'Treasurer'], $this->held($secretary));
    }

    public function test_disabling_an_officer_the_hand_over_made_keeps_their_role_for_when_they_are_reactivated(): void
    {
        $secretary = $this->elected('Secretary');
        $this->colleague();

        $this->postJson('/api/users/'.$secretary->school_id.'/disable')->assertOk();
        $this->assertSame(['SBO_OFFICER', 'disabled', 'Secretary'], $this->held($secretary));

        $this->postJson('/api/users/'.$secretary->school_id.'/reactivate')->assertOk();
        $this->assertSame(['SBO_OFFICER', 'active', 'Secretary'], $this->held($secretary));
    }

    public function test_a_role_change_reaches_the_profile_when_the_account_row_already_holds_that_role(): void
    {
        $secretary = $this->elected('Secretary');
        $this->assertSame('STUDENT', $this->accountRowRole($secretary));
        $this->colleague();

        $this->putJson('/api/users/'.$secretary->school_id, ['role' => 'STUDENT'])
            ->assertOk()
            ->assertJsonPath('role', 'STUDENT');

        $this->assertSame(['STUDENT', 'active', null], $this->held($secretary));
    }

    public function test_an_admin_cannot_disable_or_delete_the_member_just_elected_president(): void
    {
        $president = $this->elected('President');
        $this->colleague();

        $this->postJson('/api/users/'.$president->school_id.'/disable')->assertForbidden();
        $this->deleteJson('/api/users/'.$president->school_id)->assertForbidden();

        $this->assertSame(['ADMIN', 'active', 'President'], $this->held($president));
    }

    public function test_removing_an_officer_the_hand_over_made_audits_the_role_they_held(): void
    {
        $secretary = $this->elected('Secretary');
        AccountProfile::create(['user_school_id' => $secretary->school_id, 'organization_id' => Organization::factory()->create()->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $this->colleague();

        $this->deleteJson('/api/users/'.$secretary->school_id)->assertOk();

        $this->assertNull($this->profile($secretary));
        $audit = AuditLog::where('module', 'users')->where('action', 'deleted')->firstOrFail();
        $this->assertSame('SBO_OFFICER', $audit->old_values['role']);
        $this->assertSame('Secretary', $audit->old_values['position_title']);
    }

    public function test_the_last_admin_check_counts_active_admin_profiles_not_account_rows(): void
    {
        $chair = $this->elected('Vice President');
        $this->assertSame('STUDENT', $this->accountRowRole($chair));
        $dormant = $this->member('ADMIN', 'Treasurer');
        User::where('school_id', $dormant->school_id)->update(['account_status' => 'inactive']);
        $this->profile($dormant)->update(['account_status' => 'inactive']);
        Sanctum::actingAs($this->admin);

        // The president and the chairperson are both active administrators, though only one account row says ADMIN.
        $this->putJson('/api/users/'.$dormant->school_id, ['account_status' => 'inactive'])->assertOk();

        $this->profile($chair)->update(['account_status' => 'inactive']);

        $this->putJson('/api/users/'.$dormant->school_id, ['account_status' => 'inactive'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Cannot deactivate the last active admin account.');
    }

    public function test_a_replaced_officer_switched_off_later_is_told_the_plain_unavailable_message(): void
    {
        $outgoing = $this->member('SBO_OFFICER', 'Secretary');
        $election = $this->closedElection();
        $this->position($election, 'Secretary', [6, 1]);
        $this->release($election)->assertOk();

        $this->profile($outgoing)->update(['account_status' => 'inactive']);

        $this->signIn($outgoing)->assertForbidden()->assertJsonPath('message', 'This account profile is unavailable.');
    }
}
