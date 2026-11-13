<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Election;
use App\Models\Notification;
use App\Models\OfficerAppointment;
use App\Models\OfficerHandover;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * Officer Transition read models (directory and history) and the handover workflow: the outgoing administration
 * prepares six items, the incoming one acknowledges receipt, and nobody outside the organization's scope reads any of it.
 */
class OfficerTransitionRecordsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private College $college;

    private Organization $organization;

    private Organization $sibling;

    private Organization $foreign;

    private Election $election;

    private User $admin;

    private User $outgoing;

    private User $incoming;

    private User $upcoming;

    private User $student;

    private User $head;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
        config(['performance.api_cache.enabled' => false]);
        $this->college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($this->college);
        $this->sibling = $this->makeCollegeStudentOrganization($this->college);
        $this->foreign = $this->makeCollegeStudentOrganization($this->makeCollege('CBA'));
        $this->head = $this->makeCollegeHead($this->college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->outgoing = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $this->incoming = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $this->upcoming = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->election = $this->closedElection($this->organization);
    }

    private function closedElection(Organization $organization, array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $organization->id,
            'status' => 'closed',
            'start_time' => now()->subDays(20),
            'end_time' => now()->subDays(19),
            ...$overrides,
        ]);
    }

    private function appointment(User $user, array $overrides = [], ?Election $election = null): OfficerAppointment
    {
        $election ??= $this->election;

        return OfficerAppointment::factory()->create([
            'organization_id' => $election->organization_id,
            'election_id' => $election->id,
            'user_school_id' => $user->school_id,
            ...$overrides,
        ]);
    }

    private function handoverRow(string $category = 'finance', array $overrides = [], ?Election $election = null): OfficerHandover
    {
        $election ??= $this->election;
        OfficerHandover::ensureFor($election);

        $row = OfficerHandover::where('election_id', $election->id)->where('category', $category)->sole();
        $row->update($overrides);

        return $row->fresh();
    }

    private function file(string $name = 'ledger.pdf', int $kilobytes = 20): UploadedFile
    {
        return UploadedFile::fake()->create($name, $kilobytes, 'application/pdf');
    }

    // Scope

    public function test_an_admin_and_an_officer_see_only_their_own_organizations_officers(): void
    {
        $mine = $this->appointment($this->incoming, ['status' => 'active']);
        $this->appointment(User::factory()->officer()->create(['organization_id' => $this->sibling->id]), [], $this->closedElection($this->sibling));

        foreach ([$this->admin, $this->outgoing] as $caller) {
            Sanctum::actingAs($caller);
            $ids = collect($this->getJson('/api/officer-transition/officers')->assertOk()->json('data'))->pluck('id');
            $this->assertSame([$mine->id], $ids->all());
        }
    }

    public function test_a_department_head_sees_the_college_and_may_narrow_it(): void
    {
        $inCollege = $this->appointment($this->incoming);
        $sibling = $this->appointment(User::factory()->officer()->create(['organization_id' => $this->sibling->id]), [], $this->closedElection($this->sibling));
        $this->appointment(User::factory()->officer()->create(['organization_id' => $this->foreign->id]), [], $this->closedElection($this->foreign));
        Sanctum::actingAs($this->head);

        $all = collect($this->getJson('/api/officer-transition/officers')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing([$inCollege->id, $sibling->id], $all);

        $narrow = collect($this->getJson('/api/officer-transition/officers?organization_id='.$this->sibling->id)->assertOk()->json('data'))->pluck('id')->all();
        $this->assertSame([$sibling->id], $narrow);
    }

    public function test_an_organization_outside_the_callers_scope_is_not_found(): void
    {
        $this->appointment(User::factory()->officer()->create(['organization_id' => $this->foreign->id]), [], $this->closedElection($this->foreign));

        Sanctum::actingAs($this->head);
        $this->getJson('/api/officer-transition/officers?organization_id='.$this->foreign->id)->assertNotFound();

        Sanctum::actingAs($this->admin);
        $this->getJson('/api/officer-transition/officers?organization_id='.$this->sibling->id)->assertNotFound();
        $this->getJson('/api/officer-transition/handover?organization_id='.$this->sibling->id)->assertNotFound();
        $this->getJson('/api/officer-transition/renewal?organization_id='.$this->sibling->id)->assertNotFound();
    }

    public function test_a_super_admin_reads_any_organization(): void
    {
        $abroad = $this->appointment(User::factory()->officer()->create(['organization_id' => $this->foreign->id]), [], $this->closedElection($this->foreign));
        $this->appointment($this->incoming);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $this->organization->id]));

        $this->assertCount(2, $this->getJson('/api/officer-transition/officers')->assertOk()->json('data'));
        $narrow = $this->getJson('/api/officer-transition/officers?organization_id='.$this->foreign->id)->assertOk()->json('data');
        $this->assertSame([$abroad->id], array_column($narrow, 'id'));
    }

    public function test_a_student_reads_nothing(): void
    {
        Sanctum::actingAs($this->student);

        $this->getJson('/api/officer-transition/officers')->assertForbidden();
        $this->getJson('/api/officer-transition/handover')->assertForbidden();
    }

    // Directory and history

    public function test_the_directory_rows_carry_the_officer_and_the_term(): void
    {
        $this->appointment($this->incoming, [
            'position_title' => 'Treasurer',
            'is_executive' => true,
            'role' => 'SBO_OFFICER',
            'academic_year' => '2026-2027',
            'term_starts_on' => '2026-12-01',
            'term_ends_on' => '2027-06-30',
            'status' => 'upcoming',
            'flag' => 'missing_deadline',
        ]);
        Sanctum::actingAs($this->admin);

        $row = $this->getJson('/api/officer-transition/officers')->assertOk()->json('data.0');

        $this->assertSame($this->incoming->school_id, $row['school_id']);
        $this->assertSame($this->incoming->first_name.' '.$this->incoming->last_name, $row['name']);
        $this->assertSame('Treasurer', $row['position_title']);
        $this->assertTrue($row['is_executive']);
        $this->assertSame('SBO_OFFICER', $row['role']);
        $this->assertSame('2026-2027', $row['academic_year']);
        $this->assertSame('2026-12-01', $row['term_starts_on']);
        $this->assertSame('2027-06-30', $row['term_ends_on']);
        $this->assertSame('upcoming', $row['status']);
        $this->assertSame('incoming', $row['kind']);
        $this->assertSame('missing_deadline', $row['flag']);
        $this->assertSame($this->election->id, $row['election']['id']);
        $this->assertSame($this->election->title, $row['election']['title']);
        $this->assertSame($this->organization->name, $row['organization']);
    }

    public function test_the_directory_filters_by_year_position_and_status_with_former_meaning_ended(): void
    {
        $old = $this->appointment(User::factory()->officer()->create(['organization_id' => $this->organization->id]), ['position_title' => 'Auditor', 'academic_year' => '2025-2026', 'status' => 'ended', 'kind' => 'outgoing']);
        $treasurer = $this->appointment($this->incoming, ['position_title' => 'Treasurer', 'academic_year' => '2026-2027', 'status' => 'active']);
        $secretary = $this->appointment($this->upcoming, ['position_title' => 'Secretary', 'academic_year' => '2026-2027', 'status' => 'upcoming']);
        Sanctum::actingAs($this->admin);

        $ids = fn (string $query) => collect($this->getJson('/api/officer-transition/officers?'.$query)->assertOk()->json('data'))->pluck('id')->all();

        $this->assertSame([$old->id], $ids('academic_year=2025-2026'));
        $this->assertSame([$old->id], $ids('status=former'));
        $this->assertSame([$treasurer->id], $ids('status=active'));
        $this->assertSame([$secretary->id], $ids('status=upcoming'));
        $this->assertSame([$treasurer->id], $ids('position=reasur'));
        $this->assertEqualsCanonicalizing([$treasurer->id, $secretary->id], $ids('academic_year=2026-2027'));
    }

    public function test_the_directory_lists_newest_first_and_pages_by_twenty(): void
    {
        foreach (range(1, 22) as $i) {
            $this->appointment(User::factory()->student()->create(['organization_id' => $this->organization->id]));
        }
        Sanctum::actingAs($this->admin);

        $page = $this->getJson('/api/officer-transition/officers')->assertOk()->json();

        $this->assertCount(20, $page['data']);
        $this->assertSame(22, $page['total']);
        $this->assertGreaterThan($page['data'][1]['id'], $page['data'][0]['id']);
    }

    public function test_an_unknown_status_is_refused(): void
    {
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/officer-transition/officers?status=sideways')->assertUnprocessable();
    }

    // Handover list

    public function test_the_handover_list_is_the_latest_election_that_has_items(): void
    {
        $older = $this->closedElection($this->organization, ['end_time' => now()->subDays(400), 'start_time' => now()->subDays(401)]);
        OfficerHandover::ensureFor($older);
        OfficerHandover::ensureFor($this->election);
        $this->closedElection($this->organization);
        $this->appointment($this->incoming, ['status' => 'active']);
        $this->handoverRow('finance', ['status' => 'prepared', 'remarks' => 'Ledger attached.', 'prepared_by' => $this->outgoing->school_id, 'prepared_at' => now(), 'attachment_path' => 'officer-handovers/1/x.pdf', 'attachment_name' => 'ledger.pdf']);
        Sanctum::actingAs($this->incoming);

        $body = $this->getJson('/api/officer-transition/handover')->assertOk()->json();

        $this->assertSame($this->election->id, $body['election']['id']);
        $this->assertSame('incoming', $body['my_side']);
        $this->assertCount(6, $body['items']);
        $this->assertEqualsCanonicalizing(array_keys(OfficerHandover::CATEGORIES), array_column($body['items'], 'category'));
        $finance = collect($body['items'])->firstWhere('category', 'finance');
        $this->assertNotEmpty($finance['label']);
        $this->assertSame('/dashboard/finance', $finance['reference_url']);
        $this->assertSame('Ledger attached.', $finance['remarks']);
        $this->assertSame('prepared', $finance['status']);
        $this->assertSame($this->outgoing->first_name.' '.$this->outgoing->last_name, $finance['prepared_by']);
        $this->assertSame('/officer-transition/handover/'.$finance['id'].'/attachment', $finance['open_url']);
        $this->assertSame('ledger.pdf', $finance['attachment_name']);
        $this->assertArrayNotHasKey('attachment_path', $finance);
        $this->assertNull(collect($body['items'])->firstWhere('category', 'events')['open_url']);
    }

    public function test_a_caller_with_no_side_has_none_and_an_empty_list_when_nothing_exists(): void
    {
        Sanctum::actingAs($this->admin);

        $body = $this->getJson('/api/officer-transition/handover')->assertOk()->json();

        $this->assertNull($body['election']);
        $this->assertNull($body['my_side']);
        $this->assertSame([], $body['items']);
    }

    // Prepare

    public function test_an_outgoing_officer_prepares_an_item_and_the_incoming_officers_are_told(): void
    {
        $this->appointment($this->outgoing, ['kind' => 'outgoing', 'status' => 'active']);
        $this->appointment($this->incoming, ['status' => 'upcoming']);
        $this->appointment($this->upcoming, ['status' => 'upcoming']);
        $row = $this->handoverRow('finance');
        Sanctum::actingAs($this->outgoing);

        $this->post('/api/officer-transition/handover/'.$row->id, [
            '_method' => 'PUT',
            'remarks' => 'Cash on hand is in the vault.',
            'reference_url' => '/dashboard/finance/transactions',
            'attachment' => $this->file('cash.pdf'),
        ], ['Accept' => 'application/json'])->assertOk();

        $row = $row->fresh();
        $this->assertSame('prepared', $row->status);
        $this->assertSame('Cash on hand is in the vault.', $row->remarks);
        $this->assertSame('/dashboard/finance/transactions', $row->reference_url);
        $this->assertSame($this->outgoing->school_id, $row->prepared_by);
        $this->assertNotNull($row->prepared_at);
        $this->assertSame('cash.pdf', $row->attachment_name);
        $this->assertStringStartsWith('officer-handovers/'.$this->organization->id.'/', $row->attachment_path);
        Storage::disk('local')->assertExists($row->attachment_path);
        Storage::disk('public')->assertMissing($row->attachment_path);

        $audit = AuditLog::where('module', 'records')->where('action', 'handover_prepared')->sole();
        $this->assertSame($this->outgoing->school_id, $audit->user_id);
        $this->assertSame($this->organization->id, $audit->organization_id);
        $this->assertSame($this->election->id, $audit->new_values['election_id']);
        $this->assertSame('finance', $audit->new_values['category']);

        $told = Notification::where('title', 'like', 'Handover prepared%')->pluck('user_id')->all();
        $this->assertEqualsCanonicalizing([$this->incoming->school_id, $this->upcoming->school_id], $told);
    }

    public function test_an_admin_who_is_not_an_incoming_appointee_may_prepare(): void
    {
        $this->appointment($this->incoming, ['status' => 'upcoming']);
        $row = $this->handoverRow('tasks');
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/officer-transition/handover/'.$row->id, ['remarks' => 'All tasks are listed.'])->assertOk();

        $this->assertSame('prepared', $row->fresh()->status);
        $this->assertSame($this->admin->school_id, $row->fresh()->prepared_by);
    }

    public function test_an_incoming_appointee_cannot_prepare_even_as_an_admin(): void
    {
        $president = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->appointment($president, ['role' => 'ADMIN', 'status' => 'active']);
        $row = $this->handoverRow('events');

        foreach ([$president, $this->incoming] as $caller) {
            if ($caller === $this->incoming) {
                $this->appointment($this->incoming, ['status' => 'active']);
            }
            Sanctum::actingAs($caller);
            $this->putJson('/api/officer-transition/handover/'.$row->id, ['remarks' => 'Mine now.'])->assertForbidden();
        }

        $this->assertSame('pending', $row->fresh()->status);
    }

    public function test_a_student_and_an_officer_with_no_side_cannot_prepare(): void
    {
        $row = $this->handoverRow('events');

        Sanctum::actingAs($this->student);
        $this->putJson('/api/officer-transition/handover/'.$row->id, ['remarks' => 'x'])->assertForbidden();

        Sanctum::actingAs($this->outgoing);
        $this->putJson('/api/officer-transition/handover/'.$row->id, ['remarks' => 'x'])->assertForbidden();

        $this->assertSame('pending', $row->fresh()->status);
    }

    public function test_an_outgoing_officer_of_another_organization_cannot_prepare(): void
    {
        $other = User::factory()->officer()->create(['organization_id' => $this->sibling->id]);
        $this->appointment($other, ['kind' => 'outgoing', 'status' => 'active'], $this->closedElection($this->sibling));
        $row = $this->handoverRow('events');
        Sanctum::actingAs($other);

        $this->putJson('/api/officer-transition/handover/'.$row->id, ['remarks' => 'x'])->assertNotFound();
    }

    public function test_preparing_is_under_review_when_an_incoming_officer_is_already_active(): void
    {
        $this->appointment($this->outgoing, ['kind' => 'outgoing', 'status' => 'active']);
        $this->appointment($this->incoming, ['status' => 'active']);
        $row = $this->handoverRow('compliance');
        Sanctum::actingAs($this->outgoing);

        $this->putJson('/api/officer-transition/handover/'.$row->id, ['remarks' => 'Renewal binder is with the adviser.'])->assertOk();

        $this->assertSame('under_review', $row->fresh()->status);
    }

    public function test_a_prepared_item_may_be_prepared_again_until_it_is_acknowledged(): void
    {
        $this->appointment($this->outgoing, ['kind' => 'outgoing', 'status' => 'active']);
        $row = $this->handoverRow('organization', ['status' => 'prepared', 'remarks' => 'First note', 'prepared_by' => $this->outgoing->school_id, 'prepared_at' => now()]);
        Sanctum::actingAs($this->outgoing);

        $this->putJson('/api/officer-transition/handover/'.$row->id, ['remarks' => 'Second note'])->assertOk();

        $this->assertSame('Second note', $row->fresh()->remarks);
    }

    public function test_an_acknowledged_item_is_read_only(): void
    {
        $this->appointment($this->outgoing, ['kind' => 'outgoing', 'status' => 'active']);
        $row = $this->handoverRow('finance', ['status' => 'acknowledged', 'remarks' => 'Done', 'acknowledged_by' => $this->incoming->school_id, 'acknowledged_at' => now()]);
        Sanctum::actingAs($this->outgoing);

        $this->putJson('/api/officer-transition/handover/'.$row->id, ['remarks' => 'Changed my mind'])->assertStatus(409);

        $this->assertSame('Done', $row->fresh()->remarks);
    }

    public function test_the_preparation_input_is_checked(): void
    {
        $this->appointment($this->outgoing, ['kind' => 'outgoing', 'status' => 'active']);
        $row = $this->handoverRow('finance');
        Sanctum::actingAs($this->outgoing);
        $url = '/api/officer-transition/handover/'.$row->id;

        $this->putJson($url, ['remarks' => str_repeat('a', 2001)])->assertUnprocessable()->assertJsonValidationErrors('remarks');
        $this->putJson($url, ['reference_url' => 'https://example.com/finance'])->assertUnprocessable()->assertJsonValidationErrors('reference_url');
        $this->putJson($url, ['reference_url' => '/admin/secret'])->assertUnprocessable()->assertJsonValidationErrors('reference_url');
        $this->post($url, ['_method' => 'PUT', 'attachment' => UploadedFile::fake()->create('run.exe', 10, 'application/octet-stream')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('attachment');
        $this->post($url, ['_method' => 'PUT', 'attachment' => $this->file('big.pdf', 10241)], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('attachment');
        $this->post($url, ['_method' => 'PUT', 'attachment' => $this->file('edge.pdf', 10240)], ['Accept' => 'application/json'])->assertOk();

        $this->assertSame('prepared', $row->fresh()->status);
    }

    public function test_a_new_attachment_replaces_the_old_file(): void
    {
        $this->appointment($this->outgoing, ['kind' => 'outgoing', 'status' => 'active']);
        $row = $this->handoverRow('finance');
        Sanctum::actingAs($this->outgoing);
        $url = '/api/officer-transition/handover/'.$row->id;

        $this->post($url, ['_method' => 'PUT', 'attachment' => $this->file('one.pdf')], ['Accept' => 'application/json'])->assertOk();
        $first = $row->fresh()->attachment_path;
        $this->post($url, ['_method' => 'PUT', 'attachment' => $this->file('two.pdf')], ['Accept' => 'application/json'])->assertOk();

        Storage::disk('local')->assertMissing($first);
        Storage::disk('local')->assertExists($row->fresh()->attachment_path);
    }

    // Acknowledge

    public function test_an_active_incoming_appointee_acknowledges_receipt_and_the_preparer_is_told(): void
    {
        $this->appointment($this->incoming, ['status' => 'active']);
        $row = $this->handoverRow('finance', ['status' => 'prepared', 'prepared_by' => $this->outgoing->school_id, 'prepared_at' => now()]);
        Sanctum::actingAs($this->incoming);

        $response = $this->postJson('/api/officer-transition/handover/'.$row->id.'/acknowledge')->assertOk();

        $this->assertStringContainsString('receipt only', $response->json('message'));
        $row = $row->fresh();
        $this->assertSame('acknowledged', $row->status);
        $this->assertSame($this->incoming->school_id, $row->acknowledged_by);
        $this->assertNotNull($row->acknowledged_at);

        $audit = AuditLog::where('module', 'records')->where('action', 'handover_acknowledged')->sole();
        $this->assertSame($this->incoming->school_id, $audit->user_id);
        $this->assertSame('finance', $audit->new_values['category']);

        $note = Notification::where('user_id', $this->outgoing->school_id)->where('title', 'like', 'Handover acknowledged%')->sole();
        $this->assertSame('election', $note->reference_type);
        $this->assertSame($this->election->id, (int) $note->reference_id);
    }

    public function test_an_under_review_item_can_be_acknowledged(): void
    {
        $this->appointment($this->incoming, ['status' => 'active']);
        $row = $this->handoverRow('tasks', ['status' => 'under_review', 'prepared_by' => $this->outgoing->school_id, 'prepared_at' => now()]);
        Sanctum::actingAs($this->incoming);

        $this->postJson('/api/officer-transition/handover/'.$row->id.'/acknowledge')->assertOk();

        $this->assertSame('acknowledged', $row->fresh()->status);
    }

    public function test_an_upcoming_incoming_appointee_cannot_acknowledge(): void
    {
        $this->appointment($this->incoming, ['status' => 'upcoming']);
        $row = $this->handoverRow('finance', ['status' => 'prepared', 'prepared_by' => $this->outgoing->school_id, 'prepared_at' => now()]);
        Sanctum::actingAs($this->incoming);

        $this->postJson('/api/officer-transition/handover/'.$row->id.'/acknowledge')->assertForbidden();

        $this->assertSame('prepared', $row->fresh()->status);
    }

    public function test_an_outgoing_officer_and_an_unrelated_admin_cannot_acknowledge(): void
    {
        $this->appointment($this->outgoing, ['kind' => 'outgoing', 'status' => 'active']);
        $row = $this->handoverRow('finance', ['status' => 'prepared', 'prepared_by' => $this->outgoing->school_id, 'prepared_at' => now()]);

        foreach ([$this->outgoing, $this->admin] as $caller) {
            Sanctum::actingAs($caller);
            $this->postJson('/api/officer-transition/handover/'.$row->id.'/acknowledge')->assertForbidden();
        }

        $this->assertSame('prepared', $row->fresh()->status);
    }

    public function test_only_a_prepared_item_can_be_acknowledged_and_only_once(): void
    {
        $this->appointment($this->incoming, ['status' => 'active']);
        $pending = $this->handoverRow('finance');
        $done = $this->handoverRow('events', ['status' => 'acknowledged', 'acknowledged_by' => $this->incoming->school_id, 'acknowledged_at' => now()]);
        Sanctum::actingAs($this->incoming);

        $this->postJson('/api/officer-transition/handover/'.$pending->id.'/acknowledge')->assertStatus(409);
        $this->postJson('/api/officer-transition/handover/'.$done->id.'/acknowledge')->assertStatus(409);

        $this->assertSame('pending', $pending->fresh()->status);
    }

    // Attachment

    public function test_the_attachment_streams_inline_and_never_from_the_public_disk(): void
    {
        $this->appointment($this->outgoing, ['kind' => 'outgoing', 'status' => 'active']);
        $row = $this->handoverRow('finance');
        Sanctum::actingAs($this->outgoing);
        $this->post('/api/officer-transition/handover/'.$row->id, ['_method' => 'PUT', 'attachment' => $this->file('ledger.pdf')], ['Accept' => 'application/json'])->assertOk();
        $path = $row->fresh()->attachment_path;

        foreach ([$this->outgoing, $this->admin, $this->head] as $reader) {
            Sanctum::actingAs($reader);
            $response = $this->get('/api/officer-transition/handover/'.$row->id.'/attachment')->assertOk();
            $this->assertStringContainsString('inline', $response->headers->get('Content-Disposition'));
            $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
            $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        }

        Storage::disk('public')->assertMissing($path);
        Sanctum::actingAs($this->student);
        $this->get('/api/officer-transition/handover/'.$row->id.'/attachment')->assertForbidden();
    }

    public function test_the_attachment_is_hidden_from_other_organizations_and_when_missing(): void
    {
        $row = $this->handoverRow('finance');
        Sanctum::actingAs($this->admin);
        $this->get('/api/officer-transition/handover/'.$row->id.'/attachment')->assertNotFound();

        $foreignHead = $this->makeCollegeHead(College::find($this->foreign->college_id));
        $withFile = $this->handoverRow('events', ['attachment_path' => 'officer-handovers/1/a.pdf', 'attachment_name' => 'a.pdf']);
        Storage::disk('local')->put('officer-handovers/1/a.pdf', 'x');
        Sanctum::actingAs($foreignHead);
        $this->get('/api/officer-transition/handover/'.$withFile->id.'/attachment')->assertNotFound();
    }
}
