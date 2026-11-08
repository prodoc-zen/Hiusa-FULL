<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Election;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ElectionVotingWindowTimezoneTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
    }

    public function test_a_window_sent_as_utc_is_stored_as_manila_wall_clock_time(): void
    {
        Sanctum::actingAs($this->admin());

        // The booking client sends 09:00 to 17:00 on Jan 5 Manila as UTC instants.
        $response = $this->postJson('/api/elections', [
            'title' => 'Election of officers',
            'start_time' => '2027-01-05T01:00:00.000Z',
            'end_time' => '2027-01-05T09:00:00.000Z',
        ])->assertCreated();

        $row = DB::table('elections')->where('id', $response->json('id'))->first();
        $this->assertSame('2027-01-05 09:00:00', $row->start_time);
        $this->assertSame('2027-01-05 17:00:00', $row->end_time);
        $this->assertSame('2027-01-05T01:00:00.000000Z', $response->json('start_time'));
        $this->assertSame('2027-01-05T09:00:00.000000Z', $response->json('end_time'));
    }

    public function test_editing_the_window_keeps_manila_wall_clock_time(): void
    {
        Sanctum::actingAs($this->admin());
        $id = $this->postJson('/api/elections', [
            'title' => 'Election of officers',
            'start_time' => '2027-01-05T01:00:00.000Z',
            'end_time' => '2027-01-05T09:00:00.000Z',
        ])->assertCreated()->json('id');

        $this->putJson("/api/elections/{$id}", [
            'start_time' => '2027-01-06T02:00:00.000Z',
            'end_time' => '2027-01-06T10:00:00.000Z',
        ])->assertOk();

        $row = DB::table('elections')->where('id', $id)->first();
        $this->assertSame('2027-01-06 10:00:00', $row->start_time);
        $this->assertSame('2027-01-06 18:00:00', $row->end_time);
    }

    public function test_the_semester_check_uses_the_manila_calendar_day(): void
    {
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        Sanctum::actingAs($this->admin());
        $letter = fn () => UploadedFile::fake()->create('letter.pdf', 20, 'application/pdf');

        // 09:00 Manila on Jan 1 is still Dec 31 in UTC, but it is inside the semester.
        $this->post('/api/elections', [
            'title' => 'First day election',
            'start_time' => '2026-12-31T17:00:00.000Z',
            'end_time' => '2027-01-01T09:00:00.000Z',
            'informative_letter' => $letter(),
        ], ['Accept' => 'application/json'])->assertCreated();

        // The refusal names the semester dates.
        $this->post('/api/elections', [
            'title' => 'Too early election',
            'start_time' => '2026-12-30T01:00:00.000Z',
            'end_time' => '2026-12-30T09:00:00.000Z',
            'informative_letter' => $letter(),
        ], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.start_time.0', 'The voting period must fall within the semester you are working in (Jan 1, 2027 to May 31, 2027).');

        $this->assertSame(1, Election::count());
    }
}
