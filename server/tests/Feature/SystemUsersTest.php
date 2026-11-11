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
use Illuminate\Database\MySqlConnection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use LogicException;
use ReflectionClassConstant;
use ReflectionMethod;
use ReflectionProperty;
use Tests\TestCase;

class SystemUsersTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->forgetForeignKeyList();
    }

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
        $this->deleteJson('/api/system/users/'.$student->school_id, ['school_id' => $student->school_id])->assertOk()->assertJsonPath('removed.profiles', 1);
        $this->assertDatabaseMissing('users', ['school_id' => $student->school_id]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $student->school_id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'user_deleted', 'record_id' => $student->school_id]);
        // The audit row keeps plain counts, not the labelled shape the SAO page reads.
        $this->assertSame(1, AuditLog::where('action', 'user_deleted')->firstOrFail()->new_values['linked_records']['profiles']);
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
                ->assertJsonPath('linked_records.'.$kind.'.count', 1)
                ->assertJsonPath('linked_records.'.$kind.'.label', fn ($label) => is_string($label) && $label !== '' && ! str_contains($label, '_'))
                ->assertJsonMissingPath('linked_records.profiles');
            $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
            $this->getJson('/api/system/users/'.$user->school_id)->assertOk()->assertJsonPath('linked_records.'.$kind.'.count', 1)->assertJsonMissingPath('linked_records.profiles');
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

            $this->getJson('/api/system/users/'.$user->school_id)->assertOk()->assertJsonPath('linked_records.'.$kind.'.count', 1);
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

        $this->getJson('/api/system/users/'.$candidate->user_id)->assertOk()->assertJsonPath('linked_records.candidates.count', 1)->assertJsonPath('linked_records.votes.count', 0);
        $this->getJson('/api/system/users/'.$voter->school_id)->assertOk()->assertJsonPath('linked_records.votes.count', 1)->assertJsonPath('linked_records.candidates.count', 0);
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
        foreach (Schema::getTables(Schema::getCurrentSchemaName()) as $table) {
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

    private function labels(): array
    {
        return (new ReflectionClassConstant(SystemUsersController::class, 'LABELS'))->getValue();
    }

    private function countKeys(): array
    {
        return (new ReflectionClassConstant(SystemUsersController::class, 'COUNT_KEYS'))->getValue();
    }

    /** The controller holds the foreign key list in a static for the request; tests start each case without it. */
    private function forgetForeignKeyList(): void
    {
        (new ReflectionProperty(SystemUsersController::class, 'foreignKeysToUsers'))->setValue(null, null);
    }

    /** Every foreign key to users that the guard counts, which is every one that is not allowlisted. */
    private function countedReferences(): array
    {
        return array_values(array_diff(array_keys($this->foreignKeysToUsers()), $this->disposableReferences()));
    }

    public function test_every_disposable_reference_is_a_real_foreign_key_to_users(): void
    {
        $this->assertSame([], array_values(array_diff($this->disposableReferences(), array_keys($this->foreignKeysToUsers()))));
        $this->assertSame($this->disposableReferences(), array_values(array_unique($this->disposableReferences())));
    }

    public function test_the_disposable_allowlist_is_exactly_the_agreed_list(): void
    {
        $agreed = [
            'notifications.user_id',
            'announcement_views.user_id', 'announcement_reactions.user_id', 'announcement_recipients.user_id',
            'fingerprints.user_id',
            'account_profiles.user_school_id',
            'organization_applicant_grants.user_school_id', 'organization_applicant_grants.granted_by',
            'tasks.assigned_to', 'announcements.created_by',
            'ai_outputs.requested_by', 'ai_outputs.decided_by',
            // Moved to the deleting SAO by transferInstitutionalRecords() before the delete.
            'compliance_requirement_types.created_by', 'clearance_periods.created_by',
        ];
        $actual = $this->disposableReferences();
        sort($agreed);
        sort($actual);

        $this->assertSame($agreed, $actual);
    }

    public function test_a_delete_can_never_fail_with_a_foreign_key_error_because_the_guard_refuses_first(): void
    {
        // Every foreign key to users is one of two things. Allowlisted: the database itself lets the user go
        // (cascade or set null, never restrict or no action). Anything else is counted, and the guard answers 409
        // before a single row is deleted; the per-reference makers below prove that for each one.
        foreach ($this->foreignKeysToUsers() as $key => $onDelete) {
            if (in_array($key, $this->disposableReferences(), true)) {
                $this->assertContains($onDelete, ['cascade', 'set null'], "{$key} is allowlisted but the database would refuse the delete ({$onDelete}).");
            }
        }
        foreach (['task_progress_updates.updated_by', 'evaluation_windows.created_by', 'academic_years.created_by', 'academic_semesters.created_by', 'financial_report_deadlines.set_by', 'organization_application_review_files.uploaded_by', 'fingerprint_verifications.user_id', 'fingerprint_verifications.performed_by', 'task_recommendations.officer_id'] as $history) {
            $this->assertContains($history, $this->countedReferences(), "{$history} is a person's own work or history and must block deletion.");
        }
    }

    public function test_every_counted_foreign_key_has_a_plain_label_the_sao_can_read(): void
    {
        $counted = $this->countedReferences();
        $labels = $this->labels();

        $this->assertSame([], array_values(array_diff($counted, array_keys($labels))), 'A foreign key to users the guard counts has no entry in LABELS. Add what the person did, in plain words.');
        $this->assertSame([], array_values(array_diff(array_keys($labels), $counted)), 'LABELS names a reference that is not a counted foreign key to users.');
        foreach ($labels as $reference => $label) {
            $this->assertMatchesRegularExpression('/^[A-Za-z][A-Za-z \-]+$/', $label, "The label for {$reference} must be plain words, with no table or column names.");
        }
        $this->assertSame($labels, array_unique($labels), 'Two references share a label, so the SAO could not tell them apart.');
        $this->assertSame([], array_values(array_diff(array_keys($this->countKeys()), $counted)), 'COUNT_KEYS names a reference that is not a counted foreign key to users.');
    }

    public function test_the_foreign_key_list_is_read_once_across_the_drawer_and_the_delete(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $first = User::factory()->student()->create();
        $second = User::factory()->student()->create();
        $third = User::factory()->student()->create();
        Sanctum::actingAs($sao);
        $this->forgetForeignKeyList();

        $listings = [];
        $lookups = 0;
        DB::listen(function ($query) use (&$listings, &$lookups) {
            if (str_contains($query->sql, 'pragma_table_list')) {
                $listings[] = $query->sql;
            }
            if (str_contains($query->sql, 'pragma_foreign_key_list')) {
                $lookups++;
            }
        });

        $drawer = $this->getJson('/api/system/users/'.$first->school_id)->assertOk()->json('linked_records');
        $this->assertCount(1, $listings);
        $this->assertStringContainsString("tl.schema = 'main'", $listings[0], 'Only this database is listed, never every schema the login can see.');
        $this->assertGreaterThan(50, $lookups);
        $lookupsAfterOneCall = $lookups;

        $this->getJson('/api/system/users/'.$second->school_id)->assertOk();
        $this->deleteJson('/api/system/users/'.$third->school_id, ['school_id' => $third->school_id])->assertOk();

        $this->assertCount(1, $listings, 'The table listing must not run again for the second drawer or the delete.');
        $this->assertSame($lookupsAfterOneCall, $lookups, 'Foreign keys must not be looked up again for the second drawer or the delete.');
        $keys = array_map(fn ($reference) => $this->countKeys()[$reference] ?? str_replace('.', '_', $reference), $this->countedReferences());
        $this->assertEqualsCanonicalizing($keys, array_keys($drawer), 'The single read must find every foreign key the schema reports.');
    }

    public function test_the_mariadb_foreign_key_read_is_one_query_on_key_column_usage_for_this_schema(): void
    {
        // This only checks the SQL the MariaDB branch builds; the branch itself cannot run against sqlite.
        $connection = new MySqlConnection(fn () => throw new LogicException('This test never connects.'), 'hiusa');
        $query = (new ReflectionMethod(SystemUsersController::class, 'usersForeignKeyQuery'))->invoke(null, $connection, 'hiusa');

        $this->assertSame(
            'select `table_name` as `table_name`, `column_name` as `column_name` from `information_schema`.`key_column_usage` where `referenced_table_name` = ? and `table_schema` = ? order by `table_name` asc, `column_name` asc',
            $query->toSql()
        );
        $this->assertSame(['users', 'hiusa'], $query->getBindings());
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
        $academicYear = fn () => DB::table('academic_years')->insertGetId(['label' => 'AY '.uniqid(), 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'created_by' => $other->school_id, ...$stamps]);
        $task = fn () => Task::factory()->create(['created_by' => $other->school_id, 'assigned_to' => null]);
        $application = fn () => DB::table('organization_applications')->insertGetId(['college_id' => $college(), 'name' => 'Club '.uniqid(), 'acronym' => strtoupper(substr(uniqid(), -6)), 'school_id' => 999000, 'first_name' => 'Ada', 'last_name' => 'Cruz', 'email' => uniqid().'@example.test', 'position_title' => 'President', ...$stamps]);

        // Each maker inserts one row in a table and points only the named column at the user; $u(column) gives that id.
        $makers = [
            'academic_semesters' => fn ($u) => DB::table('academic_semesters')->insert(['academic_year_id' => $academicYear(), 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-15', 'created_by' => $u('created_by'), ...$stamps]),
            'academic_years' => fn ($u) => DB::table('academic_years')->insert(['label' => 'AY '.uniqid(), 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'created_by' => $u('created_by'), ...$stamps]),
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
            'evaluation_windows' => fn ($u) => DB::table('evaluation_windows')->insert(['title' => 'Midyear '.uniqid(), 'created_by' => $u('created_by'), ...$stamps]),
            'event_registrations' => fn ($u) => DB::table('event_registrations')->insert(['event_id' => $event(), 'organization_id' => $organization(), 'user_id' => $u('user_id'), 'registered_at' => now(), ...$stamps]),
            'event_requirement_files' => fn ($u) => DB::table('event_requirement_files')->insert(['event_id' => $event(), 'requirement_id' => DB::table('event_requirements')->insertGetId(['name' => 'Report', 'allowed_extensions' => json_encode(['pdf']), ...$stamps]), 'organization_id' => $organization(), 'path' => 'events/report.pdf', 'original_name' => 'report.pdf', 'uploaded_by' => $u('uploaded_by'), ...$stamps]),
            'events' => fn ($u) => Event::factory()->create(['created_by' => $u('created_by'), 'organization_id' => $organization()]),
            'financial_forecasts' => fn ($u) => DB::table('financial_forecasts')->insert(['forecast_period' => '2026-12', 'predicted_income' => 100, 'predicted_expense' => 50, 'generated_by' => $u('generated_by'), ...$stamps]),
            'financial_report_deadlines' => fn ($u) => DB::table('financial_report_deadlines')->insert(['deadline_at' => now()->addMonth(), 'set_by' => $u('set_by'), ...$stamps]),
            'financial_reports' => fn ($u) => DB::table('financial_reports')->insert(['report_type' => 'monthly', 'title' => 'December report', 'generated_by' => $u('generated_by'), 'department_head_approved_by' => $u('department_head_approved_by'), 'sao_approved_by' => $u('sao_approved_by')]),
            'fingerprint_verifications' => fn ($u) => DB::table('fingerprint_verifications')->insert(['organization_id' => $organization(), 'user_id' => $u('user_id'), 'performed_by' => $u('performed_by'), 'result' => 'match', 'verified_at' => now(), ...$stamps]),
            'fingerprints' => fn ($u) => DB::table('fingerprints')->insert(['organization_id' => $organization(), 'user_id' => $other->school_id, 'enrolled_by' => $u('enrolled_by'), 'template' => 'template', 'template_format' => 'ISO', 'enrolled_at' => now(), ...$stamps]),
            'grievances' => fn ($u) => DB::table('grievances')->insert(['organization_id' => $organization(), 'submitted_by' => $u('submitted_by'), 'title' => 'Broken fan', 'description' => 'The fan is broken.', ...$stamps]),
            'invoice_payments' => fn ($u) => DB::table('invoice_payments')->insert(['invoice_id' => $invoice(), 'amount' => 100, 'recorded_by' => $u('recorded_by'), ...$stamps]),
            'invoices' => fn ($u) => DB::table('invoices')->insert(['organization_id' => $organization(), 'reference' => 'INV-'.uniqid(), 'student_id' => $u('student_id'), 'description' => 'Dues', 'amount_due' => 100, ...$stamps]),
            'orders' => fn ($u) => Order::factory()->create(['student_id' => $u('student_id'), 'processed_by' => $u('processed_by'), 'approved_by' => $u('approved_by'), 'claim_verified_by' => $u('claim_verified_by')]),
            'organization_application_requirement_reviews' => fn ($u) => DB::table('organization_application_requirement_reviews')->insert(['organization_application_id' => $application(), 'requirement_type_id' => $requirementType(), 'stage' => 'sao', 'status' => 'pending', 'reviewed_by' => $u('reviewed_by'), ...$stamps]),
            'organization_application_review_files' => fn ($u) => DB::table('organization_application_review_files')->insert(['organization_application_id' => $application(), 'stage' => 'sao', 'uploaded_by' => $u('uploaded_by'), 'file_path' => 'reviews/letter.pdf', 'file_original_name' => 'letter.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1024, ...$stamps]),
            'organization_applications' => fn ($u) => DB::table('organization_applications')->insert(['college_id' => $college(), 'name' => 'Club '.uniqid(), 'acronym' => strtoupper(substr(uniqid(), -6)), 'school_id' => 999001, 'first_name' => 'Ada', 'last_name' => 'Cruz', 'email' => uniqid().'@example.test', 'position_title' => 'President', 'endorsed_by' => $u('endorsed_by'), 'reviewed_by' => $u('reviewed_by'), ...$stamps]),
            'organization_compliance_submissions' => fn ($u) => DB::table('organization_compliance_submissions')->insert(['organization_id' => $organization(), 'requirement_type_id' => $requirementType(), 'file_path' => 'compliance/charter.pdf', 'file_original_name' => 'charter.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1024, 'submitted_by' => $u('submitted_by'), 'reviewed_by' => $u('reviewed_by'), 'submitted_at' => now(), ...$stamps]),
            'remittances' => fn ($u) => DB::table('remittances')->insert(['collection_id' => $collection(), 'reference' => 'REM-'.uniqid(), 'amount' => 100, 'remitted_by' => $u('remitted_by'), 'verified_by' => $u('verified_by'), 'remitted_at' => now(), ...$stamps]),
            'task_progress_updates' => fn ($u) => DB::table('task_progress_updates')->insert(['task_id' => $task()->id, 'organization_id' => $organization(), 'updated_by' => $u('updated_by'), 'status' => 'in_progress', ...$stamps]),
            'task_recommendations' => fn ($u) => DB::table('task_recommendations')->insert(['task_id' => $task()->id, 'organization_id' => $organization(), 'officer_id' => $u('officer_id'), 'weights' => json_encode([]), 'eligibility_result' => 'eligible']),
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

            $records = $this->getJson('/api/system/users/'.$user->school_id)->assertOk()->json('linked_records');
            $linked = array_filter(array_map(fn ($record) => $record['count'], $records));
            $this->assertSame(1, array_sum($linked), "{$key} was not counted exactly once: ".json_encode($linked));
            $this->assertCount(1, $linked, "{$key} was counted under more than one key: ".json_encode($linked));
            $name = array_key_first($linked);
            $this->assertSame($this->labels()[$key], $records[$name]['label'], "{$key} did not carry its plain label.");
            // The guard answers, not the database: a foreign key error would come back as the protected-record 409 instead.
            $this->deleteJson('/api/system/users/'.$user->school_id, ['school_id' => $user->school_id])
                ->assertStatus(409)
                ->assertJsonPath('message', fn ($message) => str_contains($message, 'Deactivate the account instead'))
                ->assertJsonCount(1, 'linked_records')
                ->assertJsonPath('linked_records.'.$name, ['label' => $this->labels()[$key], 'count' => 1]);
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

    public function test_a_user_holding_a_row_for_every_allowlisted_reference_is_deleted_without_a_foreign_key_error(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $other = User::factory()->student()->create();
        $user = User::factory()->student()->create();
        $stamps = ['created_at' => now(), 'updated_at' => now()];
        $organization = fn () => Organization::factory()->create()->id;
        $college = fn () => DB::table('colleges')->insertGetId(['name' => 'College '.uniqid(), 'is_active' => true, ...$stamps]);
        $announcement = fn () => DB::table('announcements')->insertGetId(['title' => 'Notice '.uniqid(), 'body' => 'Body', 'created_by' => $other->school_id, ...$stamps]);

        // One row per allowlisted reference, all pointing at the same person, so one delete meets every rule at once.
        $makers = [
            'notifications.user_id' => fn ($id) => DB::table('notifications')->insert(['user_id' => $id, 'title' => 'Hello', 'message' => 'Hello', ...$stamps]),
            'announcement_views.user_id' => fn ($id) => DB::table('announcement_views')->insert(['announcement_id' => $announcement(), 'user_id' => $id]),
            'announcement_reactions.user_id' => fn ($id) => DB::table('announcement_reactions')->insert(['announcement_id' => $announcement(), 'user_id' => $id, ...$stamps]),
            'announcement_recipients.user_id' => fn ($id) => DB::table('announcement_recipients')->insert(['announcement_id' => $announcement(), 'user_id' => $id, 'organization_id' => $organization(), ...$stamps]),
            'fingerprints.user_id' => fn ($id) => DB::table('fingerprints')->insert(['organization_id' => $organization(), 'user_id' => $id, 'template' => 'template', 'template_format' => 'ISO', 'enrolled_at' => now(), ...$stamps]),
            'account_profiles.user_school_id' => fn ($id) => $this->assertDatabaseHas('account_profiles', ['user_school_id' => $id]),
            'organization_applicant_grants.user_school_id' => fn ($id) => DB::table('organization_applicant_grants')->insert(['college_id' => $college(), 'user_school_id' => $id, ...$stamps]),
            'organization_applicant_grants.granted_by' => fn ($id) => DB::table('organization_applicant_grants')->insert(['college_id' => $college(), 'user_school_id' => $other->school_id, 'granted_by' => $id, ...$stamps]),
            'tasks.assigned_to' => fn ($id) => Task::factory()->create(['created_by' => $other->school_id, 'assigned_to' => $id]),
            'announcements.created_by' => fn ($id) => DB::table('announcements')->insert(['title' => 'Own notice', 'body' => 'Body', 'created_by' => $id, ...$stamps]),
            'ai_outputs.requested_by' => fn ($id) => DB::table('ai_outputs')->insert(['feature_type' => 'task_recommendation', 'output_text' => 'Text', 'requested_by' => $id]),
            'ai_outputs.decided_by' => fn ($id) => DB::table('ai_outputs')->insert(['feature_type' => 'task_recommendation', 'output_text' => 'Text', 'decided_by' => $id]),
            'compliance_requirement_types.created_by' => fn ($id) => DB::table('compliance_requirement_types')->insert(['academic_year' => '2026-2027', 'name' => 'Charter', 'deadline_at' => now()->addMonth(), 'created_by' => $id, ...$stamps]),
            'clearance_periods.created_by' => fn ($id) => DB::table('clearance_periods')->insert(['academic_year' => '2026-2027', 'title' => 'Graduation Clearance', 'required_roles' => json_encode(['sao']), 'created_by' => $id, ...$stamps]),
        ];
        $this->assertSame([], array_values(array_diff($this->disposableReferences(), array_keys($makers))), 'An allowlisted reference has no row maker here.');
        $this->assertSame([], array_values(array_diff(array_keys($makers), $this->disposableReferences())), 'A row maker here is not allowlisted.');
        foreach ($makers as $make) {
            $make($user->school_id);
        }
        Sanctum::actingAs($sao);

        $drawer = $this->getJson('/api/system/users/'.$user->school_id)->assertOk()->json('linked_records');
        $this->assertSame(0, array_sum(array_column($drawer, 'count')), 'Allowlisted rows are not history and must not be counted.');
        $this->deleteJson('/api/system/users/'.$user->school_id, ['school_id' => $user->school_id])->assertOk();

        $this->assertDatabaseMissing('users', ['school_id' => $user->school_id]);
        foreach (['notifications' => 'user_id', 'announcement_views' => 'user_id', 'announcement_reactions' => 'user_id', 'announcement_recipients' => 'user_id', 'fingerprints' => 'user_id', 'account_profiles' => 'user_school_id', 'organization_applicant_grants' => 'user_school_id'] as $table => $column) {
            $this->assertDatabaseMissing($table, [$column => $user->school_id]);
        }
        $this->assertDatabaseHas('announcements', ['title' => 'Own notice', 'created_by' => null]);
        $this->assertDatabaseHas('compliance_requirement_types', ['name' => 'Charter', 'created_by' => $sao->school_id]);
        $this->assertDatabaseHas('clearance_periods', ['title' => 'Graduation Clearance', 'created_by' => $sao->school_id]);
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

        $this->deleteJson('/api/system/users/'.$active->school_id, ['school_id' => $active->school_id])->assertStatus(409)
            ->assertJsonPath('linked_records.audit_logs_user_id', ['label' => 'activity log entries', 'count' => 1]);
        $this->deleteJson('/api/system/users/'.$signedUp->school_id, ['school_id' => $signedUp->school_id])->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $signedUp->school_id]);
        $this->assertDatabaseHas('users', ['school_id' => $active->school_id]);
    }
}
