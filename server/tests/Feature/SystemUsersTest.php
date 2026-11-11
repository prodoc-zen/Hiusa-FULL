<?php

namespace Tests\Feature;

use App\Http\Controllers\SystemUsersController;
use App\Mail\PasswordResetMail;
use App\Models\Attendance;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Event;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use ReflectionClassConstant;
use Tests\TestCase;

class SystemUsersTest extends TestCase
{
    use RefreshDatabase;

    public function test_sao_can_search_all_colleges_and_view_a_users_clearance(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $first = User::factory()->student()->create();
        $second = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        $periodId = DB::table('clearance_periods')->insertGetId([
            'academic_year' => '2026-2027', 'title' => 'First Semester Clearance', 'required_roles' => json_encode(['sao']),
            'created_by' => $sao->school_id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('clearance_signatures')->insert([
            'clearance_period_id' => $periodId, 'student_id' => $second->school_id,
            'organization_id' => $second->organization_id, 'required_role' => 'sao',
            'status' => 'held', 'remarks' => 'Resolve dues', 'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($sao);
        $this->getJson('/api/system/users?search='.$second->school_id)->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.school_id', $second->school_id)
            ->assertJsonMissingPath('data.0.password_hash');
        $this->getJson('/api/system/users/'.$second->school_id)->assertOk()
            ->assertJsonPath('clearances.0.title', 'First Semester Clearance')
            ->assertJsonPath('clearances.0.signatures.0.status', 'held')
            ->assertJsonPath('user.profiles.0.organization.id', $second->organization_id);
        $this->getJson('/api/system/users?role=STUDENT')->assertOk()->assertJsonPath('total', 2);
        $this->assertNotEquals($first->organization_id, $second->organization_id);
    }

    public function test_only_sao_can_delete_another_user_and_one_with_no_linked_records_is_removed(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $student = User::factory()->student()->create();
        Sanctum::actingAs($student);
        $this->getJson('/api/system/users')->assertForbidden();
        $this->deleteJson('/api/system/users/'.$sao->school_id, ['school_id' => $sao->school_id])->assertForbidden();

        Sanctum::actingAs($sao);
        $this->deleteJson('/api/system/users/'.$student->school_id, ['school_id' => 123])->assertUnprocessable();
        $this->deleteJson('/api/system/users/'.$sao->school_id, ['school_id' => $sao->school_id])->assertUnprocessable();
        $this->deleteJson('/api/system/users/'.$student->school_id, ['school_id' => $student->school_id])->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $student->school_id]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $student->school_id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'user_deleted', 'record_id' => $student->school_id]);
    }

    public function test_sao_gets_a_one_time_reset_link_for_a_student_and_an_officer_even_while_voting_is_open(): void
    {
        config(['mail.default' => 'log', 'app.frontend_url' => 'https://hiusa.example.test']);
        Mail::fake();
        $sao = User::factory()->superAdmin()->create();
        $student = User::factory()->student()->create(['email' => 'ana@example.test']);
        $officer = User::factory()->officer()->create(['organization_id' => $student->organization_id]);
        Election::factory()->create(['organization_id' => $student->organization_id, 'status' => 'active']);
        Sanctum::actingAs($sao);

        foreach ([$student, $officer] as $member) {
            $response = $this->postJson('/api/system/users/'.$member->school_id.'/password-reset')->assertOk();

            $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
            parse_str((string) parse_url($response->json('reset_link'), PHP_URL_QUERY), $query);
            $this->assertSame($member->email, $query['email']);
            $audit = AuditLog::where('action', 'user_password_reset_initiated')->where('record_id', $member->school_id)->firstOrFail();
            $this->assertSame($sao->school_id, (int) $audit->user_id);
            $this->assertStringNotContainsString($query['token'], json_encode(AuditLog::all()->toArray()));
        }
        Mail::assertNothingOutgoing();
    }

    public function test_with_mail_on_the_sao_reset_link_is_emailed_and_not_returned(): void
    {
        config(['mail.default' => 'smtp']);
        Mail::fake();
        $sao = User::factory()->superAdmin()->create();
        $student = User::factory()->student()->create();
        Sanctum::actingAs($sao);

        $response = $this->postJson('/api/system/users/'.$student->school_id.'/password-reset')->assertOk();

        $this->assertArrayNotHasKey('reset_link', $response->json());
        Mail::assertQueued(PasswordResetMail::class, fn ($mail) => $mail->hasTo($student->email));
    }

    public function test_only_the_sao_can_use_the_user_password_reset(): void
    {
        $admin = User::factory()->admin()->create();
        $student = User::factory()->student()->create();

        Sanctum::actingAs($student);
        $this->postJson('/api/system/users/'.$student->school_id.'/password-reset')->assertForbidden();
        Sanctum::actingAs($admin);
        $this->postJson('/api/system/users/'.$student->school_id.'/password-reset')->assertForbidden();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_the_sao_reset_is_refused_for_other_roles_and_inactive_accounts(): void
    {
        config(['mail.default' => 'log', 'app.frontend_url' => 'https://hiusa.example.test']);
        $sao = User::factory()->superAdmin()->create();
        $admin = User::factory()->admin()->create();
        $head = User::factory()->departmentHead()->create();
        $inactive = User::factory()->student()->create(['account_status' => 'inactive']);

        Sanctum::actingAs($sao);
        foreach ([$admin, $head, $sao, $inactive] as $refused) {
            $this->postJson('/api/system/users/'.$refused->school_id.'/password-reset')->assertUnprocessable();
        }
        $this->assertDatabaseCount('password_reset_tokens', 0);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'user_password_reset_initiated']);
    }

    public function test_a_user_with_linked_records_cannot_be_deleted_and_nothing_is_erased(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $makers = [
            'transactions' => fn (User $user) => Transaction::factory()->create(['budget_id' => null, 'recorded_by' => $user->school_id, 'organization_id' => $user->organization_id]),
            'invoices' => fn (User $user) => DB::table('invoices')->insert([
                'organization_id' => $user->organization_id, 'reference' => 'INV-TEST-'.$user->school_id,
                'student_id' => $user->school_id, 'description' => 'Membership', 'amount_due' => 100,
                'created_at' => now(), 'updated_at' => now(),
            ]),
            'events' => fn (User $user) => Event::factory()->create(['created_by' => $user->school_id, 'organization_id' => $user->organization_id]),
            'orders' => fn (User $user) => Order::factory()->create(['student_id' => $user->school_id, 'processed_by' => null, 'approved_by' => null]),
            'attendance' => fn (User $user) => Attendance::factory()->create(['user_id' => $user->school_id, 'method' => 'manual']),
        ];
        Sanctum::actingAs($sao);

        foreach ($makers as $kind => $make) {
            $user = User::factory()->student()->create();
            $make($user);

            $this->deleteJson('/api/system/users/'.$user->school_id, ['school_id' => $user->school_id])
                ->assertStatus(409)
                ->assertJsonPath('message', fn ($message) => str_contains($message, 'Deactivate the account instead'))
                ->assertJsonPath('linked_records.'.$kind, 1)
                ->assertJsonMissingPath('linked_records.profiles');
            $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
            $this->getJson('/api/system/users/'.$user->school_id)->assertOk()->assertJsonPath('linked_records.'.$kind, 1);
        }
        $this->assertDatabaseCount('transactions', 1);
        $this->assertDatabaseCount('invoices', 1);
    }

    public function test_records_that_would_cascade_or_be_refused_by_the_database_are_counted_and_block_deletion(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $other = User::factory()->student()->create();
        $stamps = ['created_at' => now(), 'updated_at' => now()];
        $makers = [
            'tasks' => fn (User $user) => Task::factory()->create(['created_by' => $user->school_id, 'assigned_to' => null]),
            'approval_requests' => fn (User $user) => DB::table('approval_requests')->insert([
                'organization_id' => $user->organization_id, 'entity_type' => 'event', 'entity_id' => 1,
                'requested_by' => $user->school_id, 'required_role' => 'ADMIN', 'status' => 'pending',
            ]),
            'grievances' => fn (User $user) => DB::table('grievances')->insert([
                'organization_id' => $user->organization_id, 'submitted_by' => $user->school_id,
                'title' => 'Broken fan', 'description' => 'The fan in the hall is broken.', ...$stamps,
            ]),
            'venue_bookings' => fn (User $user) => DB::table('venue_bookings')->insert([
                'venue_id' => DB::table('venues')->insertGetId(['name' => 'Gym', 'location' => 'Main building', ...$stamps]),
                'organization_id' => $user->organization_id, 'start_time' => now()->addDay(), 'end_time' => now()->addDay()->addHours(2),
                'requested_by' => $user->school_id, ...$stamps,
            ]),
            'organization_compliance_submissions' => fn (User $user) => DB::table('organization_compliance_submissions')->insert([
                'organization_id' => $user->organization_id,
                'requirement_type_id' => DB::table('compliance_requirement_types')->insertGetId([
                    'academic_year' => '2026-2027', 'name' => 'Organization charter', 'deadline_at' => now()->addMonth(),
                    'created_by' => $sao->school_id, ...$stamps,
                ]),
                'file_path' => 'compliance/charter.pdf', 'file_original_name' => 'charter.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1024,
                'submitted_by' => $user->school_id, 'submitted_at' => now(), ...$stamps,
            ]),
            'event_registrations' => fn (User $user) => DB::table('event_registrations')->insert([
                'event_id' => Event::factory()->create(['created_by' => $other->school_id, 'organization_id' => $user->organization_id])->id,
                'organization_id' => $user->organization_id, 'user_id' => $user->school_id, 'registered_at' => now(), ...$stamps,
            ]),
            'evaluation_responses' => fn (User $user) => DB::table('evaluation_responses')->insert([
                'evaluation_window_id' => DB::table('evaluation_windows')->insertGetId(['title' => 'Midyear evaluation', ...$stamps]),
                'organization_id' => $user->organization_id, 'user_id' => $user->school_id, 'respondent_type' => 'member',
                'answers' => json_encode([]), ...$stamps,
            ]),
            'remittances' => fn (User $user) => DB::table('remittances')->insert([
                'collection_id' => DB::table('collections')->insertGetId([
                    'organization_id' => $user->organization_id, 'reference' => 'COL-'.$user->school_id, 'amount_collected' => 100,
                    'source' => 'Membership fee', 'collected_by' => $other->school_id, 'collected_at' => now(), ...$stamps,
                ]),
                'reference' => 'REM-'.$user->school_id, 'amount' => 100, 'remitted_by' => $user->school_id, 'remitted_at' => now(), ...$stamps,
            ]),
            'invoice_payments' => fn (User $user) => DB::table('invoice_payments')->insert([
                'invoice_id' => DB::table('invoices')->insertGetId([
                    'organization_id' => $user->organization_id, 'reference' => 'INV-'.$user->school_id,
                    'student_id' => $other->school_id, 'description' => 'Membership', 'amount_due' => 100, ...$stamps,
                ]),
                'amount' => 100, 'recorded_by' => $user->school_id, ...$stamps,
            ]),
            'cash_advance_repayments' => fn (User $user) => DB::table('cash_advance_repayments')->insert([
                'cash_advance_id' => DB::table('cash_advances')->insertGetId([
                    'organization_id' => $user->organization_id, 'reference' => 'CA-'.$user->school_id, 'borrower_id' => $other->school_id,
                    'amount' => 100, 'purpose' => 'Event supplies', ...$stamps,
                ]),
                'amount' => 50, 'recorded_by' => $user->school_id, 'repaid_at' => now(), ...$stamps,
            ]),
        ];
        Sanctum::actingAs($sao);

        foreach ($makers as $kind => $make) {
            $user = User::factory()->student()->create();
            $make($user);

            $this->getJson('/api/system/users/'.$user->school_id)->assertOk()->assertJsonPath('linked_records.'.$kind, 1);
            $this->deleteJson('/api/system/users/'.$user->school_id, ['school_id' => $user->school_id])
                ->assertStatus(409)
                ->assertJsonPath('message', fn ($message) => str_contains($message, 'Deactivate the account instead'));
            $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
            $this->assertDatabaseCount($kind, 1);
        }
    }

    public function test_a_user_who_ran_in_an_election_cannot_be_deleted_and_the_counts_are_shown(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $organization = Organization::factory()->create();
        $election = Election::factory()->create(['organization_id' => $organization->id, 'status' => 'closed']);
        $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
        $candidate = Candidate::factory()->create(['election_id' => $election->id, 'position_id' => $position->id]);
        $voter = User::factory()->student()->create();
        Vote::factory()->create(['election_id' => $election->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id, 'voter_id' => $voter->school_id]);
        Sanctum::actingAs($sao);

        $this->getJson('/api/system/users/'.$candidate->user_id)->assertOk()->assertJsonPath('linked_records.candidates', 1)->assertJsonPath('linked_records.votes', 0);
        $this->getJson('/api/system/users/'.$voter->school_id)->assertOk()->assertJsonPath('linked_records.votes', 1)->assertJsonPath('linked_records.candidates', 0);
        $this->deleteJson('/api/system/users/'.$candidate->user_id, ['school_id' => $candidate->user_id])->assertStatus(409);
        $this->deleteJson('/api/system/users/'.$voter->school_id, ['school_id' => $voter->school_id])->assertStatus(409);

        $this->assertDatabaseHas('users', ['school_id' => $candidate->user_id]);
        $this->assertDatabaseHas('users', ['school_id' => $voter->school_id]);
        $this->assertDatabaseHas('candidates', ['id' => $candidate->id]);
        $this->assertDatabaseCount('votes', 1);
    }

    public function test_another_sao_can_be_deleted_while_the_actor_remains_active(): void
    {
        $actor = User::factory()->superAdmin()->create();
        $other = User::factory()->superAdmin()->create(['account_status' => 'inactive']);
        $requirementId = DB::table('compliance_requirement_types')->insertGetId([
            'academic_year' => '2026-2027', 'name' => 'Organization charter', 'deadline_at' => now()->addMonth(),
            'created_by' => $other->school_id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $periodId = DB::table('clearance_periods')->insertGetId([
            'academic_year' => '2026-2027', 'title' => 'Graduation Clearance', 'required_roles' => json_encode(['sao']),
            'created_by' => $other->school_id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        Sanctum::actingAs($actor);
        $this->deleteJson('/api/system/users/'.$other->school_id, ['school_id' => $other->school_id])->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $other->school_id]);
        $this->assertDatabaseHas('users', ['school_id' => $actor->school_id]);
        $this->assertDatabaseHas('compliance_requirement_types', ['id' => $requirementId, 'created_by' => $actor->school_id]);
        $this->assertDatabaseHas('clearance_periods', ['id' => $periodId, 'created_by' => $actor->school_id]);
    }

    /** Every table.column that holds a foreign key to users, read from the live schema. */
    private function foreignKeysToUsers(): array
    {
        $keys = [];
        foreach (Schema::getTables() as $table) {
            foreach (Schema::getForeignKeys($table['name']) as $foreignKey) {
                if ($foreignKey['foreign_table'] !== 'users') {
                    continue;
                }
                $this->assertSame(['school_id'], $foreignKey['foreign_columns']);
                foreach ($foreignKey['columns'] as $column) {
                    $keys[$table['name'].'.'.$column] = $foreignKey['on_delete'];
                }
            }
        }
        ksort($keys);

        return $keys;
    }

    private function disposableReferences(): array
    {
        return (new ReflectionClassConstant(SystemUsersController::class, 'DISPOSABLE_REFERENCES'))->getValue();
    }

    public function test_every_disposable_reference_is_a_real_foreign_key_to_users(): void
    {
        $this->assertSame([], array_values(array_diff($this->disposableReferences(), array_keys($this->foreignKeysToUsers()))));
        $this->assertSame($this->disposableReferences(), array_values(array_unique($this->disposableReferences())));
    }

    public function test_the_schema_reports_foreign_keys_with_the_shape_the_guard_reads(): void
    {
        $foreignKey = collect(Schema::getForeignKeys('transactions'))->firstWhere('columns', ['payer_id']);

        $this->assertSame('users', $foreignKey['foreign_table']);
        $this->assertSame(['school_id'], $foreignKey['foreign_columns']);
        $this->assertSame('set null', $foreignKey['on_delete']);
    }

    public function test_any_other_foreign_key_to_users_is_counted_and_blocks_deletion(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $other = User::factory()->student()->create();
        $stamps = ['created_at' => now(), 'updated_at' => now()];
        $organization = fn () => Organization::factory()->create()->id;
        $event = fn () => Event::factory()->create(['created_by' => $other->school_id, 'organization_id' => $organization()])->id;
        $period = fn () => DB::table('clearance_periods')->insertGetId(['academic_year' => '2026-2027', 'title' => 'Clearance '.uniqid(), 'required_roles' => json_encode(['sao']), 'created_by' => $other->school_id, ...$stamps]);
        $requirementType = fn () => DB::table('compliance_requirement_types')->insertGetId(['academic_year' => '2026-2027', 'name' => 'Requirement '.uniqid(), 'deadline_at' => now()->addMonth(), 'created_by' => $other->school_id, ...$stamps]);
        $college = fn () => DB::table('colleges')->insertGetId(['name' => 'College '.uniqid(), 'is_active' => true, ...$stamps]);
        $collection = fn () => DB::table('collections')->insertGetId(['organization_id' => $organization(), 'reference' => 'COL-'.uniqid(), 'amount_collected' => 100, 'source' => 'Fee', 'collected_by' => $other->school_id, 'collected_at' => now(), ...$stamps]);
        $cashAdvance = fn () => DB::table('cash_advances')->insertGetId(['organization_id' => $organization(), 'reference' => 'CA-'.uniqid(), 'borrower_id' => $other->school_id, 'amount' => 100, 'purpose' => 'Supplies', ...$stamps]);
        $invoice = fn () => DB::table('invoices')->insertGetId(['organization_id' => $organization(), 'reference' => 'INV-'.uniqid(), 'student_id' => $other->school_id, 'description' => 'Dues', 'amount_due' => 100, ...$stamps]);
        $application = fn () => DB::table('organization_applications')->insertGetId(['college_id' => $college(), 'name' => 'Club '.uniqid(), 'acronym' => strtoupper(substr(uniqid(), -6)), 'school_id' => 999000, 'first_name' => 'Ada', 'last_name' => 'Cruz', 'email' => uniqid().'@example.test', 'position_title' => 'President', ...$stamps]);

        // Each maker inserts one row in a table and points only the named column at the user; $u(column) gives that id.
        $makers = [
            'announcements' => fn ($u) => DB::table('announcements')->insert(['title' => 'Notice', 'body' => 'Body', 'created_by' => $other->school_id, 'reviewed_by' => $u('reviewed_by'), ...$stamps]),
            'approval_requests' => fn ($u) => DB::table('approval_requests')->insert(['organization_id' => $organization(), 'entity_type' => 'event', 'entity_id' => 1, 'requested_by' => $u('requested_by'), 'reviewed_by' => $u('reviewed_by'), 'assigned_approver' => $u('assigned_approver'), 'required_role' => 'ADMIN', 'status' => 'pending']),
            'attendance' => fn ($u) => Attendance::factory()->create(['event_id' => $event(), 'user_id' => $u('user_id'), 'recorded_by' => $u('recorded_by'), 'method' => 'manual']),
            'audit_logs' => fn ($u) => DB::table('audit_logs')->insert(['user_id' => $u('user_id'), 'module' => 'tasks', 'action' => 'task_created', 'created_at' => now()]),
            'budgets' => fn ($u) => Budget::factory()->create(['department_head_approved_by' => $u('department_head_approved_by')]),
            'candidates' => fn ($u) => Candidate::factory()->create(['user_id' => $u('user_id')]),
            'cash_advance_repayments' => fn ($u) => DB::table('cash_advance_repayments')->insert(['cash_advance_id' => $cashAdvance(), 'amount' => 50, 'recorded_by' => $u('recorded_by'), 'repaid_at' => now(), ...$stamps]),
            'cash_advances' => fn ($u) => DB::table('cash_advances')->insert(['organization_id' => $organization(), 'reference' => 'CA-'.uniqid(), 'borrower_id' => $u('borrower_id'), 'approved_by' => $u('approved_by'), 'released_by' => $u('released_by'), 'amount' => 100, 'purpose' => 'Supplies', ...$stamps]),
            'clearance_signatures' => fn ($u) => DB::table('clearance_signatures')->insert(['clearance_period_id' => $period(), 'student_id' => $u('student_id'), 'signed_by' => $u('signed_by'), 'organization_id' => $organization(), 'required_role' => 'sao', ...$stamps]),
            'collections' => fn ($u) => DB::table('collections')->insert(['organization_id' => $organization(), 'reference' => 'COL-'.uniqid(), 'amount_collected' => 100, 'source' => 'Fee', 'collected_by' => $u('collected_by'), 'verified_by' => $u('verified_by'), 'collected_at' => now(), ...$stamps]),
            'department_head_invitations' => fn ($u) => DB::table('department_head_invitations')->insert(['college_id' => $college(), 'token_hash' => hash('sha256', uniqid()), 'invited_by' => $u('invited_by'), 'expires_at' => now()->addDay(), ...$stamps]),
            'evaluation_responses' => fn ($u) => DB::table('evaluation_responses')->insert(['evaluation_window_id' => DB::table('evaluation_windows')->insertGetId(['title' => 'Midyear', ...$stamps]), 'organization_id' => $organization(), 'user_id' => $u('user_id'), 'respondent_type' => 'member', 'answers' => json_encode([]), ...$stamps]),
            'event_registrations' => fn ($u) => DB::table('event_registrations')->insert(['event_id' => $event(), 'organization_id' => $organization(), 'user_id' => $u('user_id'), 'registered_at' => now(), ...$stamps]),
            'event_requirement_files' => fn ($u) => DB::table('event_requirement_files')->insert(['event_id' => $event(), 'requirement_id' => DB::table('event_requirements')->insertGetId(['name' => 'Report', 'allowed_extensions' => json_encode(['pdf']), ...$stamps]), 'organization_id' => $organization(), 'path' => 'events/report.pdf', 'original_name' => 'report.pdf', 'uploaded_by' => $u('uploaded_by'), ...$stamps]),
            'events' => fn ($u) => Event::factory()->create(['created_by' => $u('created_by'), 'organization_id' => $organization()]),
            'financial_forecasts' => fn ($u) => DB::table('financial_forecasts')->insert(['forecast_period' => '2026-12', 'predicted_income' => 100, 'predicted_expense' => 50, 'generated_by' => $u('generated_by'), ...$stamps]),
            'financial_reports' => fn ($u) => DB::table('financial_reports')->insert(['report_type' => 'monthly', 'title' => 'December report', 'generated_by' => $u('generated_by'), 'department_head_approved_by' => $u('department_head_approved_by'), 'sao_approved_by' => $u('sao_approved_by')]),
            'fingerprints' => fn ($u) => DB::table('fingerprints')->insert(['organization_id' => $organization(), 'user_id' => $other->school_id, 'enrolled_by' => $u('enrolled_by'), 'template' => 'template', 'template_format' => 'ISO', 'enrolled_at' => now(), ...$stamps]),
            'grievances' => fn ($u) => DB::table('grievances')->insert(['organization_id' => $organization(), 'submitted_by' => $u('submitted_by'), 'title' => 'Broken fan', 'description' => 'The fan is broken.', ...$stamps]),
            'invoice_payments' => fn ($u) => DB::table('invoice_payments')->insert(['invoice_id' => $invoice(), 'amount' => 100, 'recorded_by' => $u('recorded_by'), ...$stamps]),
            'invoices' => fn ($u) => DB::table('invoices')->insert(['organization_id' => $organization(), 'reference' => 'INV-'.uniqid(), 'student_id' => $u('student_id'), 'description' => 'Dues', 'amount_due' => 100, ...$stamps]),
            'orders' => fn ($u) => Order::factory()->create(['student_id' => $u('student_id'), 'processed_by' => $u('processed_by'), 'approved_by' => $u('approved_by'), 'claim_verified_by' => $u('claim_verified_by')]),
            'organization_application_requirement_reviews' => fn ($u) => DB::table('organization_application_requirement_reviews')->insert(['organization_application_id' => $application(), 'requirement_type_id' => $requirementType(), 'stage' => 'sao', 'status' => 'pending', 'reviewed_by' => $u('reviewed_by'), ...$stamps]),
            'organization_applications' => fn ($u) => DB::table('organization_applications')->insert(['college_id' => $college(), 'name' => 'Club '.uniqid(), 'acronym' => strtoupper(substr(uniqid(), -6)), 'school_id' => 999001, 'first_name' => 'Ada', 'last_name' => 'Cruz', 'email' => uniqid().'@example.test', 'position_title' => 'President', 'endorsed_by' => $u('endorsed_by'), 'reviewed_by' => $u('reviewed_by'), ...$stamps]),
            'organization_compliance_submissions' => fn ($u) => DB::table('organization_compliance_submissions')->insert(['organization_id' => $organization(), 'requirement_type_id' => $requirementType(), 'file_path' => 'compliance/charter.pdf', 'file_original_name' => 'charter.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1024, 'submitted_by' => $u('submitted_by'), 'reviewed_by' => $u('reviewed_by'), 'submitted_at' => now(), ...$stamps]),
            'remittances' => fn ($u) => DB::table('remittances')->insert(['collection_id' => $collection(), 'reference' => 'REM-'.uniqid(), 'amount' => 100, 'remitted_by' => $u('remitted_by'), 'verified_by' => $u('verified_by'), 'remitted_at' => now(), ...$stamps]),
            'tasks' => fn ($u) => Task::factory()->create(['created_by' => $u('created_by'), 'assigned_to' => null]),
            'transactions' => fn ($u) => Transaction::factory()->create(['budget_id' => null, 'organization_id' => $organization(), 'recorded_by' => $u('recorded_by'), 'payer_id' => $u('payer_id')]),
            'venue_bookings' => fn ($u) => DB::table('venue_bookings')->insert(['venue_id' => DB::table('venues')->insertGetId(['name' => 'Gym '.uniqid(), 'location' => 'Main building', ...$stamps]), 'organization_id' => $organization(), 'start_time' => now()->addDay(), 'end_time' => now()->addDay()->addHours(2), 'requested_by' => $u('requested_by'), 'reviewed_by' => $u('reviewed_by'), ...$stamps]),
            'votes' => fn ($u) => Vote::factory()->create(['voter_id' => $u('voter_id')]),
        ];
        // Tables that cannot be seeded here, with the reason. Keep this short; an entry must still be a real foreign key.
        $skipped = [];

        $this->assertSame([], array_values(array_diff($skipped, array_keys($this->foreignKeysToUsers()))));
        Sanctum::actingAs($sao);

        $checked = [];
        foreach (array_keys($this->foreignKeysToUsers()) as $key) {
            if (in_array($key, $this->disposableReferences(), true) || in_array($key, $skipped, true)) {
                continue;
            }
            [$table, $column] = explode('.', $key);
            $this->assertArrayHasKey($table, $makers, "A new foreign key to users, {$key}, has no row maker in this test and is not allowlisted. Add one, or allowlist it if its rows are disposable.");

            $user = User::factory()->student()->create();
            $makers[$table](fn (string $name) => $name === $column ? $user->school_id : $other->school_id);

            $counts = $this->getJson('/api/system/users/'.$user->school_id)->assertOk()->json('linked_records');
            $linked = array_filter(Arr::except($counts, ['profiles']));
            $this->assertSame(1, array_sum($linked), "{$key} was not counted exactly once: ".json_encode($linked));
            $this->assertCount(1, $linked, "{$key} was counted under more than one key: ".json_encode($linked));
            $this->deleteJson('/api/system/users/'.$user->school_id, ['school_id' => $user->school_id])->assertStatus(409);
            $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
            $checked[] = $key;
        }

        foreach (['transactions.payer_id', 'clearance_signatures.signed_by', 'orders.approved_by', 'financial_reports.sao_approved_by', 'approval_requests.reviewed_by', 'audit_logs.user_id'] as $required) {
            $this->assertContains($required, $checked);
        }
    }

    public function test_a_disposable_reference_alone_does_not_block_deletion_and_is_cleared_with_the_user(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $user = User::factory()->student()->create();
        DB::table('notifications')->insert(['user_id' => $user->school_id, 'title' => 'Hello', 'message' => 'Hello', 'created_at' => now(), 'updated_at' => now()]);
        Task::factory()->create(['created_by' => $sao->school_id, 'assigned_to' => $user->school_id]);
        Sanctum::actingAs($sao);

        $this->deleteJson('/api/system/users/'.$user->school_id, ['school_id' => $user->school_id])->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $user->school_id]);
        $this->assertDatabaseMissing('notifications', ['user_id' => $user->school_id]);
        $this->assertDatabaseHas('tasks', ['created_by' => $sao->school_id, 'assigned_to' => null]);
    }

    public function test_an_account_that_only_signed_itself_up_can_be_deleted_but_other_activity_blocks_it(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $signedUp = User::factory()->student()->create();
        $active = User::factory()->student()->create();
        foreach ([$signedUp, $active] as $user) {
            AuditLog::create(['organization_id' => $user->organization_id, 'user_id' => $user->school_id, 'module' => 'users', 'action' => 'student_signed_up', 'record_type' => User::class, 'record_id' => $user->school_id, 'created_at' => now()]);
        }
        AuditLog::create(['organization_id' => $active->organization_id, 'user_id' => $active->school_id, 'module' => 'users', 'action' => 'photo_updated', 'record_type' => User::class, 'record_id' => $active->school_id, 'created_at' => now()]);
        Sanctum::actingAs($sao);

        $this->deleteJson('/api/system/users/'.$active->school_id, ['school_id' => $active->school_id])->assertStatus(409);
        $this->deleteJson('/api/system/users/'.$signedUp->school_id, ['school_id' => $signedUp->school_id])->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $signedUp->school_id]);
        $this->assertDatabaseHas('users', ['school_id' => $active->school_id]);
    }
}
