<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AgencySummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_summary_matches_full_overview_totals_without_loading_organization_details(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $sao->id]));
        $college = College::create(['name' => 'Computing', 'is_active' => true]);
        foreach (['active', 'active', 'pending', 'returned', 'archived'] as $status) {
            Organization::factory()->create(['college_id' => $college->id, 'college' => $college->name, 'lifecycle_status' => $status]);
        }
        Organization::factory()->create(['organization_type' => 'COLLEGE', 'college_id' => $college->id]);
        DB::enableQueryLog();
        DB::flushQueryLog();
        $full = $this->getJson('/api/system/agency')->assertOk()->json('totals');
        $fullQueryCount = count(DB::getQueryLog());
        DB::flushQueryLog();
        $this->getJson('/api/system/agency?summary=1')->assertOk()
            ->assertExactJson(['totals' => $full]);
        $queries = collect(DB::getQueryLog())->pluck('query');
        DB::disableQueryLog();
        $this->assertLessThan($fullQueryCount, $queries->count());
        foreach (['approval_requests', 'organization_compliance_submissions', 'compliance_requirement_types'] as $table) {
            $this->assertFalse($queries->contains(fn ($sql) => str_contains($sql, '"'.$table.'"')), 'Summary queried '.$table);
        }
        $organizationQueries = $queries->filter(fn ($sql) => str_contains($sql, '"organizations"'));
        $this->assertCount(2, $organizationQueries); // The SAO profile and the grouped totals.
        $this->assertSame(2, $full['by_lifecycle_status']['active']);
        $this->assertSame(5, $full['organizations']);
    }

    public function test_summary_retains_authentication_role_boundaries_and_validates_its_query(): void
    {
        $this->getJson('/api/system/agency?summary=1')->assertUnauthorized();
        Sanctum::actingAs(User::factory()->admin()->create());
        $this->getJson('/api/system/agency?summary=1')->assertForbidden();
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => $sao->id]));
        $this->getJson('/api/system/agency?summary=wrong')->assertUnprocessable()->assertJsonValidationErrors('summary');
        $this->getJson('/api/system/agency?summary=0')->assertOk()->assertJsonStructure(['totals', 'colleges', 'unassigned_organizations']);
    }
}
