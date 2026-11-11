<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Event;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
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
                ->assertJsonPath('message', fn ($message) => str_contains($message, 'Deactivate the account instead'));
            $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
            $this->getJson('/api/system/users/'.$user->school_id)->assertOk()->assertJsonPath('linked_records.'.$kind, 1);
        }
        $this->assertDatabaseCount('transactions', 1);
        $this->assertDatabaseCount('invoices', 1);
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
}
