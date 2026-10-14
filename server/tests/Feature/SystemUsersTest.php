<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
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

    public function test_only_sao_can_delete_another_user_and_dependent_rows_cascade(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $student = User::factory()->student()->create();
        $transaction = Transaction::factory()->create([
            'budget_id' => null, 'recorded_by' => $student->school_id, 'organization_id' => $student->organization_id,
        ]);
        $invoiceId = DB::table('invoices')->insertGetId([
            'organization_id' => $student->organization_id, 'reference' => 'INV-TEST-1',
            'student_id' => $student->school_id, 'description' => 'Membership', 'amount_due' => 100,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('invoice_payments')->insert([
            'invoice_id' => $invoiceId, 'amount' => 100, 'recorded_by' => $student->school_id,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        Sanctum::actingAs($student);
        $this->getJson('/api/system/users')->assertForbidden();
        $this->deleteJson('/api/system/users/'.$sao->school_id, ['school_id' => $sao->school_id])->assertForbidden();

        Sanctum::actingAs($sao);
        $this->deleteJson('/api/system/users/'.$student->school_id, ['school_id' => 123])->assertUnprocessable();
        $this->deleteJson('/api/system/users/'.$sao->school_id, ['school_id' => $sao->school_id])->assertUnprocessable();
        $this->deleteJson('/api/system/users/'.$student->school_id, ['school_id' => $student->school_id])
            ->assertOk()->assertJsonPath('removed.transactions', 1);
        $this->assertDatabaseMissing('users', ['school_id' => $student->school_id]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $student->school_id]);
        $this->assertDatabaseMissing('transactions', ['id' => $transaction->id]);
        $this->assertDatabaseMissing('invoices', ['id' => $invoiceId]);
        $this->assertDatabaseMissing('invoice_payments', ['invoice_id' => $invoiceId]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'user_deleted', 'record_id' => $student->school_id]);
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
