<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use App\Services\Compliance\AccreditationStatusService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicYearTest extends TestCase
{
    use RefreshDatabase;

    private User $director;

    protected function setUp(): void
    {
        parent::setUp();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        Sanctum::actingAs($this->director);
    }

    private function create(string $label, string $start, string $end)
    {
        return $this->postJson('/api/system/academic-years', ['label' => $label, 'starts_on' => $start, 'ends_on' => $end]);
    }

    public function test_the_first_year_becomes_current_and_switching_keeps_exactly_one_current(): void
    {
        $first = $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertCreated()->assertJsonPath('is_current', true)->json('id');
        $second = $this->create('2027-2028', '2027-08-01', '2028-05-31')->assertCreated()->assertJsonPath('is_current', false)->json('id');

        $this->patchJson("/api/system/academic-years/{$second}/current")->assertOk()->assertJsonPath('is_current', true);

        $this->assertSame(['2027-2028'], AcademicYear::where('is_current', true)->pluck('label')->all());
        $this->assertFalse(AcademicYear::find($first)->is_current);
        $this->assertTrue(AuditLog::where('action', 'academic_year_made_current')->exists());
    }

    public function test_accreditation_follows_the_current_year_instead_of_the_newest_requirement_set(): void
    {
        DB::table('compliance_requirement_types')->insert([
            ['academic_year' => '2027-2028', 'name' => 'Constitution', 'deadline_at' => now()->addYear(), 'is_active' => true, 'created_by' => $this->director->school_id, 'created_at' => now(), 'updated_at' => now()],
        ]);
        $service = app(AccreditationStatusService::class);
        $this->assertSame('2027-2028', $service->currentAcademicYear(), 'Before any calendar exists, the newest requirement set stands in.');

        $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertCreated();

        $this->assertSame('2026-2027', $service->currentAcademicYear());
    }

    public function test_labels_and_dates_are_validated(): void
    {
        $this->create('2026-2028', '2026-08-01', '2027-05-31')->assertUnprocessable()->assertJsonValidationErrors('label');
        $this->create('26-27', '2026-08-01', '2027-05-31')->assertUnprocessable()->assertJsonValidationErrors('label');
        $this->create('2026-2027', '2027-05-31', '2026-08-01')->assertUnprocessable()->assertJsonValidationErrors('ends_on');
        $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertCreated();
        $this->create('2027-2028', '2027-05-01', '2028-05-31')->assertUnprocessable()->assertJsonPath('errors.starts_on.0', 'These dates overlap 2026-2027.');
        $this->create('2026-2027', '2030-08-01', '2031-05-31')->assertUnprocessable()->assertJsonValidationErrors('label');
    }

    public function test_a_year_in_use_or_current_cannot_be_removed_or_renamed(): void
    {
        $current = $this->create('2026-2027', '2026-08-01', '2027-05-31')->json('id');
        $past = $this->create('2025-2026', '2025-08-01', '2026-05-31')->json('id');
        $unused = $this->create('2028-2029', '2028-08-01', '2029-05-31')->json('id');
        DB::table('compliance_requirement_types')->insert(['academic_year' => '2025-2026', 'name' => 'Officers list', 'deadline_at' => now(), 'is_active' => true, 'created_by' => $this->director->school_id, 'created_at' => now(), 'updated_at' => now()]);

        $this->deleteJson("/api/system/academic-years/{$current}")->assertStatus(409);
        $this->deleteJson("/api/system/academic-years/{$past}")->assertStatus(409);
        $this->putJson("/api/system/academic-years/{$past}", ['label' => '2024-2025', 'starts_on' => '2024-08-01', 'ends_on' => '2025-05-31'])->assertUnprocessable();
        $this->putJson("/api/system/academic-years/{$past}", ['label' => '2025-2026', 'starts_on' => '2025-07-15', 'ends_on' => '2026-05-31'])->assertOk()->assertJsonPath('starts_on', '2025-07-15');
        $this->deleteJson("/api/system/academic-years/{$unused}")->assertOk();
        $this->assertSame(2, AcademicYear::count());
    }

    public function test_only_the_sao_manages_the_calendar(): void
    {
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));

        $this->getJson('/api/system/academic-years')->assertForbidden();
        $this->create('2026-2027', '2026-08-01', '2027-05-31')->assertForbidden();
    }
}
