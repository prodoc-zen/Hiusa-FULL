<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Collection;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Remittance;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/** The semester picks finished finance rows only; whatever still waits on someone stays visible while the next semester is active. */
class FinanceWorkQueuesIgnoreSemesterTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $org;

    private User $admin;

    private User $dean;

    private User $sao;

    protected function setUp(): void
    {
        parent::setUp();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-01-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-01-01', 'ends_on' => '2026-05-31', 'status' => 'completed']);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2026-08-01', 'ends_on' => '2027-01-31', 'status' => 'active']);

        $college = $this->makeCollege('CIT');
        $this->dean = $this->makeCollegeHead($college);
        $this->sao = User::factory()->superAdmin()->create();
        $this->org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active']);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->org->id]);
    }

    private function report(string $title, string $status): FinancialReport
    {
        return FinancialReport::create([
            'organization_id' => $this->org->id,
            'report_type' => 'custom',
            'title' => $title,
            'period_start' => '2026-02-01',
            'period_end' => '2026-02-28',
            'generated_at' => '2026-03-01 08:00:00',
            'submission_status' => $status,
            'submitted_at' => $status === 'draft' ? null : '2026-03-02 08:00:00',
            'department_head_approved_at' => in_array($status, ['pending_sao', 'approved'], true) ? '2026-03-03 08:00:00' : null,
        ]);
    }

    private function collection(string $reference, string $status, float $remitted): Collection
    {
        $collection = Collection::create([
            'organization_id' => $this->org->id,
            'reference' => $reference,
            'amount_collected' => 300,
            'source' => 'Event fee',
            'status' => $status,
            'collected_by' => $this->admin->school_id,
            'collected_at' => '2026-02-21 09:00:00',
        ]);
        if ($remitted > 0) {
            Remittance::create([
                'collection_id' => $collection->id,
                'reference' => 'REM-'.$reference,
                'amount' => $remitted,
                'remitted_by' => $this->admin->school_id,
                'remitted_at' => '2026-02-25 09:00:00',
                'status' => 'recorded',
            ]);
        }

        return $collection;
    }

    private function read(User $user, string $url)
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);

        return $this->getJson($url)->assertOk();
    }

    private function titles(User $user, string $url = '/api/financial-reports'): array
    {
        return collect($this->read($user, $url)->json('data'))->pluck('title')->sort()->values()->all();
    }

    public function test_reports_waiting_on_someone_stay_visible_from_a_completed_semester_and_finished_ones_are_filtered(): void
    {
        foreach (['Draft' => 'draft', 'Rejected' => 'rejected', 'Pending Dean' => 'pending_department_head', 'Pending SAO' => 'pending_sao', 'Approved' => 'approved'] as $title => $status) {
            $this->report($title, $status);
        }

        $this->assertSame(['Draft', 'Pending Dean', 'Pending SAO', 'Rejected'], $this->titles($this->admin));
        $this->assertSame(['Pending Dean', 'Pending SAO', 'Rejected'], $this->titles($this->dean));
        $this->assertSame(['Pending SAO'], $this->titles($this->sao));
    }

    public function test_a_status_filter_for_approved_still_follows_the_semester(): void
    {
        $this->report('Approved', 'approved');
        $this->report('Pending SAO', 'pending_sao');

        $this->assertSame([], $this->titles($this->admin, '/api/financial-reports?status=approved'));
        $this->assertSame(['Pending SAO'], $this->titles($this->admin, '/api/financial-reports?status=pending_sao'));
    }

    public function test_pending_and_unremitted_collections_stay_visible_from_a_completed_semester_and_settled_ones_are_filtered(): void
    {
        $this->collection('COL-PENDING', 'pending', 0);
        $this->collection('COL-UNREMITTED', 'verified', 0);
        $this->collection('COL-PARTIAL', 'verified', 100);
        $this->collection('COL-SETTLED', 'verified', 300);

        foreach ([$this->admin, $this->dean] as $user) {
            $references = collect($this->read($user, '/api/collections')->json())->pluck('reference')->sort()->values()->all();
            $this->assertSame(['COL-PARTIAL', 'COL-PENDING', 'COL-UNREMITTED'], $references, $user->role);
        }
    }
}
