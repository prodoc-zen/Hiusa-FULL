<?php

namespace Tests\Feature;

use App\Models\FinancialSemester;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BudgetSemesterTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_assign_and_read_a_budget_for_its_own_semester(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $semester = FinancialSemester::create([
            'organization_id' => $organization->id,
            'name' => 'First Semester',
            'starts_on' => '2026-08-01',
            'ends_on' => '2026-12-31',
        ]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Semester Allocation',
            'allocated_amount' => 1500,
            'warning_threshold' => 200,
            'financial_semester_id' => $semester->id,
        ])->assertCreated()->assertJsonPath('financial_semester.name', 'First Semester')->json('id');

        $this->getJson('/api/budgets')->assertOk()->assertJsonFragment([
            'id' => $budgetId,
            'financial_semester_id' => $semester->id,
        ]);
        $this->putJson('/api/budgets/'.$budgetId, ['financial_semester_id' => null])
            ->assertOk()->assertJsonPath('financial_semester_id', null);
    }

    public function test_budget_rejects_a_semester_from_another_organization(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $semester = FinancialSemester::create([
            'organization_id' => $otherOrganization->id,
            'name' => 'Other Semester',
            'starts_on' => '2026-08-01',
            'ends_on' => '2026-12-31',
        ]);

        Sanctum::actingAs($admin);
        $this->postJson('/api/budgets', [
            'title' => 'Invalid Allocation',
            'allocated_amount' => 1500,
            'warning_threshold' => 200,
            'financial_semester_id' => $semester->id,
        ])->assertStatus(422)->assertJsonValidationErrors('financial_semester_id');

        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Valid Allocation',
            'allocated_amount' => 1500,
            'warning_threshold' => 200,
        ])->assertCreated()->json('id');
        $this->putJson('/api/budgets/'.$budgetId, ['financial_semester_id' => $semester->id])
            ->assertStatus(422)->assertJsonValidationErrors('financial_semester_id');
        $this->assertDatabaseHas('budgets', ['id' => $budgetId, 'financial_semester_id' => null]);
    }

    public function test_student_cannot_create_budget_for_semester(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']));

        $this->postJson('/api/budgets', [
            'title' => 'Student Allocation',
            'allocated_amount' => 1500,
            'warning_threshold' => 200,
        ])->assertForbidden();
    }
}
