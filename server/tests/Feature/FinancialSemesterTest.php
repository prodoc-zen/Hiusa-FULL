<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinancialSemesterTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_creates_semester_ending_today_and_uses_it_for_report(): void
    {
        $admin = User::factory()->admin()->create();
        Sanctum::actingAs($admin);

        $semester = $this->postJson('/api/financial-semesters', [
            'name' => 'Semester 2026-2027',
            'starts_on' => today()->subMonths(2)->toDateString(),
        ])->assertCreated()->assertJsonPath('ends_on', today()->toDateString());

        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester',
            'financial_semester_id' => $semester->json('id'),
            'signatories' => ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'],
        ])->assertCreated()
            ->assertJsonPath('report.financial_semester_id', $semester->json('id'))
            ->assertJsonPath('report.title', 'Financial Report - Semester 2026-2027');
    }

    public function test_semester_access_is_scoped_and_non_admins_cannot_create(): void
    {
        $admin = User::factory()->admin()->create();
        $other = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($other);
        $semester = $this->postJson('/api/financial-semesters', [
            'name' => 'Other semester', 'starts_on' => today()->subDay()->toDateString(),
        ])->assertCreated();

        Sanctum::actingAs($admin);
        $this->getJson('/api/financial-semesters')->assertOk()->assertJsonCount(0);
        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'semester', 'financial_semester_id' => $semester->json('id'),
            'signatories' => ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'],
        ])->assertUnprocessable();

        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $admin->organization_id]));
        $this->postJson('/api/financial-semesters', ['name' => 'Denied', 'starts_on' => today()->toDateString()])->assertForbidden();
    }
}
