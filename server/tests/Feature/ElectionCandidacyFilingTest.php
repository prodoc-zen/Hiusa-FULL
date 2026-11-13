<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\Partylist;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * Filing a candidacy in a filing election, alone or as the representative of a party list: who may run, for which
 * position, with which documents, and where the private documents live.
 */
class ElectionCandidacyFilingTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $student;

    private Election $election;

    private ElectionPosition $president;

    private ElectionPosition $senator;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);
        Storage::fake('public');
        Storage::fake('local');

        $college = $this->makeCollege('CBE');
        $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'year_level' => '2nd Year']);
        $this->election = Election::factory()->create([
            'organization_id' => $this->organization->id,
            'title' => 'Student council election',
            'status' => 'upcoming',
            'phase' => 'filing',
            'approved_at' => now()->subDay(),
            'filing_starts_at' => now()->subDay(),
            'filing_ends_at' => now()->addDay(),
            'screening_starts_at' => now()->addDay(),
            'screening_ends_at' => now()->addDays(2),
            'campaign_starts_at' => now()->addDays(2),
            'campaign_ends_at' => now()->addDays(3),
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(4),
            'results_publish_at' => now()->addDays(5),
            'rules' => 'Be fair.',
            'rules_version' => 1,
        ]);
        $this->president = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1, 'is_executive' => true]);
        $this->senator = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'Senator', 'max_winners' => 2]);
    }

    private function member(array $attributes = [], string $role = 'student'): User
    {
        return User::factory()->{$role}()->create(['organization_id' => $this->organization->id, 'year_level' => '2nd Year', ...$attributes]);
    }

    private function documents(): array
    {
        return [
            'photo' => UploadedFile::fake()->image('photo.jpg'),
            'coc' => UploadedFile::fake()->create('coc.pdf', 100, 'application/pdf'),
            'credentials' => UploadedFile::fake()->create('credentials.pdf', 100, 'application/pdf'),
        ];
    }

    private function file(?User $as = null, array $overrides = [], ?ElectionPosition $position = null)
    {
        Sanctum::actingAs($as ?? $this->student);

        return $this->postJson("/api/elections/{$this->election->id}/applications", [
            'position_id' => ($position ?? $this->senator)->id,
            'platform' => 'Open budgets.',
            'rules_accepted' => true,
            ...$overrides,
        ]);
    }

    public function test_a_member_files_a_draft_that_keeps_the_rules_version_they_accepted(): void
    {
        $this->file()->assertCreated()
            ->assertJsonPath('status', 'draft')
            ->assertJsonPath('position_title', 'Senator')
            ->assertJsonPath('rules_version', 1);

        $this->assertDatabaseHas('election_applications', [
            'election_id' => $this->election->id,
            'user_school_id' => $this->student->school_id,
            'submitted_by' => $this->student->school_id,
            'status' => 'draft',
            'submitted_at' => null,
        ]);
        $this->assertNotNull(ElectionApplication::first()->rules_accepted_at);
        $this->assertSame(0, Notification::where('notification_type', 'election')->count());
    }

    public function test_filing_is_refused_outside_the_filing_phase(): void
    {
        foreach (['scheduled', 'screening', 'campaign', 'voting'] as $phase) {
            $this->election->update(['phase' => $phase]);

            $this->file()->assertStatus(409);
        }

        $this->assertSame(0, ElectionApplication::count());
    }

    public function test_filing_is_refused_for_a_halted_or_unapproved_election_and_for_a_legacy_one(): void
    {
        $this->election->update(['suspended_at' => now()]);
        $this->file()->assertStatus(409);

        $this->election->update(['suspended_at' => null, 'approved_at' => null]);
        $this->file()->assertStatus(409);

        $this->election->update(['approved_at' => now(), 'filing_starts_at' => null]);
        $this->file()->assertNotFound();
    }

    public function test_the_rules_must_be_accepted_first(): void
    {
        $this->file(null, ['rules_accepted' => false])->assertUnprocessable();
        $this->file(null, ['rules_accepted' => null])->assertUnprocessable();

        $this->assertSame(0, ElectionApplication::count());
    }

    public function test_a_fourth_year_student_cannot_run_for_an_executive_position_but_may_for_another(): void
    {
        $senior = $this->member(['year_level' => '4th Year']);

        $this->file($senior, [], $this->president)
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Fourth year students cannot run for an executive position.');
        $this->file($senior, [], $this->senator)->assertCreated();
    }

    public function test_a_position_may_be_limited_to_year_levels(): void
    {
        $this->senator->update(['eligible_year_levels' => [2, 3]]);

        $this->file($this->member(['year_level' => '1st Year']))->assertUnprocessable();
        $this->file($this->member(['year_level' => '3rd Year']))->assertCreated();
    }

    public function test_a_student_with_no_year_level_on_record_may_file_and_the_admin_sees_the_flag(): void
    {
        $unknown = $this->member(['year_level' => null]);
        $this->senator->update(['eligible_year_levels' => [2]]);

        $this->file($unknown)->assertCreated()->assertJsonPath('year_level_missing', true);

        Sanctum::actingAs($this->admin);
        $this->getJson("/api/elections/{$this->election->id}/applications")
            ->assertOk()
            ->assertJsonPath('applications.0.year_level_missing', true);
    }

    public function test_a_position_must_belong_to_the_election_and_be_active(): void
    {
        $this->senator->update(['is_active' => false]);
        $this->file()->assertUnprocessable();

        $other = ElectionPosition::create(['election_id' => Election::factory()->create(['organization_id' => $this->organization->id])->id, 'title' => 'Mayor', 'max_winners' => 1]);
        $this->file(null, [], $other)->assertUnprocessable();
    }

    public function test_one_application_per_student_a_rejected_one_refuses_and_a_withdrawn_one_is_filed_again(): void
    {
        $this->file()->assertCreated();
        $this->file(null, [], $this->president)->assertUnprocessable();
        $this->assertSame(1, ElectionApplication::count());

        ElectionApplication::first()->update(['status' => 'rejected']);
        $this->file()->assertUnprocessable()->assertJsonPath('message', 'Your application was rejected and cannot be filed again.');

        ElectionApplication::first()->update(['status' => 'withdrawn']);
        $this->file(null, [], $this->president)->assertCreated()->assertJsonPath('status', 'draft')->assertJsonPath('position_id', $this->president->id);
        $this->assertSame(1, ElectionApplication::count());
    }

    public function test_only_a_voting_member_of_the_organization_who_is_not_the_adviser_may_run(): void
    {
        $outsider = User::factory()->student()->create(['organization_id' => $this->makeCollegeStudentOrganization($this->makeCollege('CAS'))->id]);
        $this->file($outsider)->assertNotFound();

        $adviser = User::factory()->adviser()->create(['organization_id' => $this->organization->id]);
        // The adviser is off the voter roll, so the election is not theirs to see.
        $this->file($adviser)->assertNotFound();

        $this->assertSame(0, ElectionApplication::count());
    }

    public function test_a_submitted_application_needs_all_three_documents(): void
    {
        $this->file(null, ['submit' => true, 'photo' => UploadedFile::fake()->image('p.jpg')])->assertUnprocessable();
        $this->assertSame(0, ElectionApplication::count());
    }

    public function test_the_private_documents_are_kept_off_the_public_disk_and_the_photo_on_it(): void
    {
        $response = $this->file(null, $this->documents())->assertCreated();
        $application = ElectionApplication::first();

        $this->assertStringStartsWith("election-applications/{$this->organization->id}/{$this->election->id}/", $application->coc_path);
        Storage::disk('local')->assertExists($application->coc_path);
        Storage::disk('local')->assertExists($application->credentials_path);
        Storage::disk('public')->assertMissing($application->coc_path);
        Storage::disk('public')->assertMissing($application->credentials_path);
        $this->assertStringStartsWith('/storage/candidates/', $application->photo_url);
        Storage::disk('public')->assertExists(str_replace('/storage/', '', $application->photo_url));
        $this->assertArrayNotHasKey('coc_path', $response->json());
        $this->assertArrayNotHasKey('credentials_path', $response->json());
    }

    public function test_a_document_of_the_wrong_kind_or_size_is_refused(): void
    {
        $this->file(null, ['photo' => UploadedFile::fake()->create('photo.pdf', 100, 'application/pdf')])->assertUnprocessable();
        $this->file(null, ['photo' => UploadedFile::fake()->image('big.jpg')->size(3000)])->assertUnprocessable();
        $this->file(null, ['coc' => UploadedFile::fake()->create('coc.exe', 10, 'application/octet-stream')])->assertUnprocessable();
        $this->file(null, ['credentials' => UploadedFile::fake()->create('c.pdf', 11000, 'application/pdf')])->assertUnprocessable();
    }

    public function test_the_documents_open_for_the_applicant_and_the_admin_only(): void
    {
        $this->file(null, $this->documents())->assertCreated();
        $application = ElectionApplication::first();
        $url = "/api/elections/{$this->election->id}/applications/{$application->id}/files/coc";

        Sanctum::actingAs($this->student);
        $own = $this->get($url)->assertOk();
        $this->assertStringContainsString('no-store', $own->headers->get('Cache-Control'));
        $this->assertStringContainsString('inline', $own->headers->get('Content-Disposition'));
        $this->get("/api/elections/{$this->election->id}/applications/{$application->id}/files/credentials")->assertOk();

        Sanctum::actingAs($this->member());
        $this->get($url)->assertForbidden();

        Sanctum::actingAs($this->member([], 'officer'));
        $this->get($url)->assertForbidden();

        Sanctum::actingAs($this->admin);
        $this->get($url)->assertOk();
        $this->get("/api/elections/{$this->election->id}/applications/{$application->id}/files/other")->assertNotFound();

        $other = User::factory()->admin()->create(['organization_id' => $this->makeCollegeStudentOrganization($this->makeCollege('CAS'))->id]);
        Sanctum::actingAs($other);
        $this->get($url)->assertNotFound();
    }

    public function test_a_draft_is_submitted_and_the_admins_are_told_once(): void
    {
        $this->file()->assertCreated();
        $application = ElectionApplication::first();

        $this->postJson("/api/elections/{$this->election->id}/applications/{$application->id}/submit")
            ->assertUnprocessable();
        $this->assertSame('draft', $application->fresh()->status);

        $this->postJson("/api/elections/{$this->election->id}/applications/{$application->id}", $this->documents())->assertOk();
        $this->postJson("/api/elections/{$this->election->id}/applications/{$application->id}/submit")
            ->assertOk()->assertJsonPath('status', 'pending_review');

        $this->assertNotNull($application->fresh()->submitted_at);
        $this->assertSame(1, Notification::where('user_id', $this->admin->school_id)->where('notification_type', 'election')->where('reference_id', $this->election->id)->count());
        $this->assertSame(0, Notification::where('user_id', $this->student->school_id)->count());
        $this->assertDatabaseHas('audit_logs', ['module' => 'elections', 'action' => 'application_submitted', 'record_id' => $this->election->id, 'user_id' => $this->student->school_id]);
    }

    public function test_filing_with_submit_sends_it_to_screening_at_once(): void
    {
        $this->file(null, [...$this->documents(), 'submit' => true])->assertCreated()->assertJsonPath('status', 'pending_review');
    }

    public function test_a_draft_may_change_position_platform_and_files_during_filing_and_a_pending_one_may_not(): void
    {
        $this->file(null, $this->documents())->assertCreated();
        $application = ElectionApplication::first();
        $oldCoc = $application->coc_path;
        $url = "/api/elections/{$this->election->id}/applications/{$application->id}";

        $this->postJson($url, ['position_id' => $this->president->id, 'platform' => 'New plan.', 'coc' => UploadedFile::fake()->create('new.pdf', 50, 'application/pdf')])
            ->assertOk()->assertJsonPath('position_id', $this->president->id)->assertJsonPath('platform', 'New plan.');
        $this->assertNotSame($oldCoc, $application->fresh()->coc_path);
        Storage::disk('local')->assertMissing($oldCoc);

        $this->postJson("{$url}/submit")->assertOk();
        $this->postJson($url, ['platform' => 'Late change.'])->assertStatus(409);
        $this->assertSame('New plan.', $application->fresh()->platform);

        Sanctum::actingAs($this->member());
        $this->postJson($url, ['platform' => 'Not mine.'])->assertForbidden();
    }

    public function test_the_applicant_withdraws_and_the_official_row_goes_with_it(): void
    {
        $this->file(null, [...$this->documents(), 'submit' => true])->assertCreated();
        $application = ElectionApplication::first();
        $candidate = Candidate::create(['election_id' => $this->election->id, 'user_id' => $this->student->school_id, 'position_id' => $this->senator->id]);
        $application->update(['status' => 'approved', 'candidate_id' => $candidate->id]);

        $this->postJson("/api/elections/{$this->election->id}/applications/{$application->id}/withdraw")
            ->assertOk()->assertJsonPath('status', 'withdrawn');

        $this->assertNull($application->fresh()->candidate_id);
        $this->assertDatabaseMissing('candidates', ['id' => $candidate->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'application_withdrawn', 'record_id' => $this->election->id]);
    }

    public function test_a_candidacy_cannot_be_withdrawn_once_voting_opened_or_by_someone_else(): void
    {
        $this->file()->assertCreated();
        $application = ElectionApplication::first();
        $url = "/api/elections/{$this->election->id}/applications/{$application->id}/withdraw";

        Sanctum::actingAs($this->member());
        $this->postJson($url)->assertForbidden();

        Sanctum::actingAs($this->student);
        $this->election->update(['phase' => 'voting']);
        $this->postJson($url)->assertStatus(409);
        $this->assertSame('draft', $application->fresh()->status);
    }

    public function test_mine_returns_the_callers_own_application_and_none_for_a_stranger(): void
    {
        $this->file()->assertCreated();

        $this->getJson("/api/elections/{$this->election->id}/applications/mine")
            ->assertOk()
            ->assertJsonPath('application.status', 'draft')
            ->assertJsonPath('slate', null);

        Sanctum::actingAs($this->member());
        $this->getJson("/api/elections/{$this->election->id}/applications/mine")
            ->assertOk()->assertJsonPath('application', null);
    }

    private function slate(?User $as = null, array $overrides = [])
    {
        Sanctum::actingAs($as ?? $this->student);

        return $this->postJson("/api/elections/{$this->election->id}/slates", [
            'name' => 'Tuloy',
            'motto' => 'Forward together',
            'color' => '#1D4ED8',
            'rules_accepted' => true,
            ...$overrides,
        ]);
    }

    private function addMember(Partylist $slate, User $member, ElectionPosition $position, array $files = [], ?User $as = null)
    {
        Sanctum::actingAs($as ?? $this->student);

        return $this->postJson("/api/elections/{$this->election->id}/slates/{$slate->id}/members", [
            'user_id' => $member->school_id,
            'position_id' => $position->id,
            'platform' => 'For all.',
            ...$files,
        ]);
    }

    public function test_a_representative_creates_a_party_list_for_the_election(): void
    {
        $this->slate()->assertCreated()->assertJsonPath('name', 'Tuloy')->assertJsonPath('motto', 'Forward together')->assertJsonPath('color', '#1D4ED8');

        $this->assertDatabaseHas('partylists', [
            'name' => 'Tuloy',
            'organization_id' => $this->organization->id,
            'election_id' => $this->election->id,
            'representative_school_id' => $this->student->school_id,
        ]);
    }

    public function test_a_party_list_needs_a_motto_a_valid_color_a_free_name_and_one_per_representative(): void
    {
        $this->slate(null, ['motto' => ''])->assertUnprocessable();
        $this->slate(null, ['color' => 'blue'])->assertUnprocessable();
        $this->slate(null, ['rules_accepted' => false])->assertUnprocessable();
        $this->slate()->assertCreated();
        $this->slate(null, ['name' => 'Another'])->assertUnprocessable();
        $this->slate($this->member(), ['name' => 'Tuloy'])->assertUnprocessable();
        $this->assertSame(1, Partylist::count());
    }

    public function test_a_party_list_opens_only_in_the_filing_phase(): void
    {
        $this->election->update(['phase' => 'screening']);

        $this->slate()->assertStatus(409);
        $this->assertSame(0, Partylist::count());
    }

    public function test_a_party_list_banner_is_stored_and_the_representative_edits_the_list(): void
    {
        $response = $this->slate(null, ['banner' => UploadedFile::fake()->image('banner.png')])->assertCreated();
        $banner = $response->json('banner_url');
        $this->assertStringStartsWith('/uploads/partylists/', $banner);
        $this->assertFileExists(public_path(ltrim($banner, '/')));
        $slate = Partylist::first();

        $this->postJson("/api/elections/{$this->election->id}/slates/{$slate->id}", ['motto' => 'Onward', 'color' => '#FF0000'])
            ->assertOk()->assertJsonPath('motto', 'Onward')->assertJsonPath('name', 'Tuloy');

        Sanctum::actingAs($this->member());
        $this->postJson("/api/elections/{$this->election->id}/slates/{$slate->id}", ['motto' => 'Mine'])->assertForbidden();

        @unlink(public_path(ltrim($banner, '/')));
    }

    public function test_a_representative_lists_members_by_position_and_the_member_is_told(): void
    {
        $this->slate()->assertCreated();
        $slate = Partylist::first();
        $member = $this->member();

        $this->addMember($slate, $member, $this->senator, $this->documents())->assertCreated()
            ->assertJsonPath('status', 'draft')
            ->assertJsonPath('partylist_id', $slate->id)
            ->assertJsonPath('submitted_by', $this->student->school_id);

        $this->assertDatabaseHas('notifications', [
            'user_id' => $member->school_id,
            'message' => 'You were listed as a candidate for Senator under Tuloy.',
        ]);
        $this->assertNotNull(ElectionApplication::where('user_school_id', $member->school_id)->value('rules_accepted_at'));
    }

    public function test_a_slate_may_leave_a_seat_vacant_and_fill_a_position_up_to_its_seats_only(): void
    {
        $this->slate()->assertCreated();
        $slate = Partylist::first();

        $this->addMember($slate, $this->member(), $this->senator)->assertCreated();
        $this->addMember($slate, $this->member(), $this->senator)->assertCreated();
        $this->addMember($slate, $this->member(), $this->senator)->assertUnprocessable();

        $this->assertSame(2, ElectionApplication::where('partylist_id', $slate->id)->count());
        $this->assertSame(0, ElectionApplication::where('position_id', $this->president->id)->count());
    }

    public function test_a_member_who_already_filed_elsewhere_or_cannot_run_is_refused(): void
    {
        $this->slate()->assertCreated();
        $slate = Partylist::first();
        $filed = $this->member();
        $this->file($filed)->assertCreated();

        $this->addMember($slate, $filed, $this->senator)->assertUnprocessable();
        $this->addMember($slate, User::factory()->adviser()->create(['organization_id' => $this->organization->id]), $this->senator)->assertUnprocessable();
        $this->addMember($slate, $this->member(['year_level' => '4th Year']), $this->president)->assertUnprocessable();
        $this->addMember($slate, User::factory()->student()->create(['organization_id' => $this->makeCollegeStudentOrganization($this->makeCollege('CAS'))->id]), $this->senator)->assertUnprocessable();
        $this->addMember($slate, $this->member(), $this->senator, [], $this->member())->assertForbidden();

        $this->assertSame(1, ElectionApplication::count());
    }

    public function test_the_representative_sees_every_member_and_their_status(): void
    {
        $this->slate()->assertCreated();
        $slate = Partylist::first();
        $first = $this->member();
        $second = $this->member();
        $this->addMember($slate, $first, $this->senator, $this->documents())->assertCreated();
        $this->addMember($slate, $second, $this->president)->assertCreated();
        ElectionApplication::where('user_school_id', $second->school_id)->update(['status' => 'for_revision', 'review_notes' => 'Blurry scan.']);

        Sanctum::actingAs($this->student);
        $response = $this->getJson("/api/elections/{$this->election->id}/applications/mine")->assertOk();

        $this->assertNull($response->json('application'));
        $this->assertSame($slate->id, $response->json('slate.id'));
        $members = collect($response->json('slate.members'))->keyBy('user_id');
        $this->assertSame('draft', $members[$first->school_id]['status']);
        $this->assertSame('for_revision', $members[$second->school_id]['status']);
        $this->assertSame('Blurry scan.', $members[$second->school_id]['review_notes']);

        Sanctum::actingAs($first);
        $mine = $this->getJson("/api/elections/{$this->election->id}/applications/mine")->assertOk();
        $this->assertSame('Tuloy', $mine->json('application.partylist_name'));
        $this->assertNull($mine->json('slate'));
    }

    public function test_slate_submit_sends_complete_members_and_names_the_incomplete_ones(): void
    {
        $this->slate()->assertCreated();
        $slate = Partylist::first();
        $complete = $this->member(['first_name' => 'Ana', 'last_name' => 'Cruz']);
        $incomplete = $this->member(['first_name' => 'Ben', 'last_name' => 'Reyes']);
        $this->addMember($slate, $complete, $this->senator, $this->documents())->assertCreated();
        $this->addMember($slate, $incomplete, $this->senator, ['photo' => UploadedFile::fake()->image('p.jpg')])->assertCreated();

        Sanctum::actingAs($this->student);
        $this->postJson("/api/elections/{$this->election->id}/slates/{$slate->id}/submit")
            ->assertUnprocessable()
            ->assertJsonPath('incomplete.0', 'Ben Reyes');

        $this->assertSame('pending_review', ElectionApplication::where('user_school_id', $complete->school_id)->value('status'));
        $this->assertSame('draft', ElectionApplication::where('user_school_id', $incomplete->school_id)->value('status'));
        $this->assertSame(1, Notification::where('user_id', $this->admin->school_id)->where('title', 'Candidacy application received')->count());

        $this->addMember($slate, $incomplete, $this->senator)->assertUnprocessable();
        ElectionApplication::where('user_school_id', $incomplete->school_id)->update(['status' => 'withdrawn']);
        $this->postJson("/api/elections/{$this->election->id}/slates/{$slate->id}/submit")->assertUnprocessable();
    }

    public function test_slate_submit_succeeds_when_every_member_is_complete(): void
    {
        $this->slate()->assertCreated();
        $slate = Partylist::first();
        $this->addMember($slate, $this->member(), $this->senator, $this->documents())->assertCreated();

        Sanctum::actingAs($this->student);
        $this->postJson("/api/elections/{$this->election->id}/slates/{$slate->id}/submit")->assertOk();

        $this->assertSame(1, ElectionApplication::where('status', 'pending_review')->count());
        $this->assertSame(1, AuditLog::where('action', 'application_submitted')->count());
    }

    public function test_a_slate_with_no_members_cannot_be_submitted(): void
    {
        $this->slate()->assertCreated();
        $slate = Partylist::first();

        $this->postJson("/api/elections/{$this->election->id}/slates/{$slate->id}/submit")->assertUnprocessable();
    }

    public function test_the_representative_may_withdraw_a_member_the_member_never_filed(): void
    {
        $this->slate()->assertCreated();
        $slate = Partylist::first();
        $member = $this->member();
        $this->addMember($slate, $member, $this->senator)->assertCreated();
        $application = ElectionApplication::where('user_school_id', $member->school_id)->first();

        Sanctum::actingAs($this->student);
        $this->postJson("/api/elections/{$this->election->id}/applications/{$application->id}/withdraw")->assertOk();
        $this->assertSame('withdrawn', $application->fresh()->status);
    }

    public function test_a_browser_form_that_spells_the_update_as_put_reaches_the_update(): void
    {
        // The client sends a multipart POST with _method=PUT, as it does for every other upload that edits a row.
        Request::enableHttpMethodParameterOverride();
        $this->file()->assertCreated();
        $application = ElectionApplication::first();
        $representative = $this->member();
        $this->slate($representative)->assertCreated();
        $slate = Partylist::first();

        Sanctum::actingAs($this->student);
        $this->post("/api/elections/{$this->election->id}/applications/{$application->id}", ['_method' => 'PUT', 'platform' => 'Sent as a form.'], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('platform', 'Sent as a form.');

        Sanctum::actingAs($representative);
        $this->post("/api/elections/{$this->election->id}/slates/{$slate->id}", ['_method' => 'PUT', 'motto' => 'Spelled as PUT'], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('motto', 'Spelled as PUT');
    }

    public function test_an_officer_with_a_voting_profile_may_file_like_any_member(): void
    {
        $officer = $this->member([], 'officer');

        $this->file($officer)->assertCreated();
    }

    public function test_a_college_member_with_a_student_profile_in_the_organization_may_file_from_their_own_account(): void
    {
        $home = Organization::where('organization_type', 'COLLEGE')->first();
        $member = User::factory()->student()->create(['organization_id' => $home->id, 'year_level' => '3rd Year']);
        AccountProfile::create(['user_school_id' => $member->school_id, 'organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $this->file($member)->assertCreated();
    }

    public function test_the_applications_list_is_for_the_admin_and_the_officer_only(): void
    {
        Sanctum::actingAs($this->student);
        $this->getJson("/api/elections/{$this->election->id}/applications")->assertForbidden();
    }
}
