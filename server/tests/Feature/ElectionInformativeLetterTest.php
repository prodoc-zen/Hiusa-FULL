<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Election;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ElectionInformativeLetterTest extends TestCase
{
    use RefreshDatabase;

    public function test_election_requires_a_pdf_and_keeps_it_private_to_the_organization(): void
    {
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $foreignAdmin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $student = User::factory()->student()->create(['organization_id' => $admin->organization_id]);
        $payload = ['title' => 'Student election', 'start_time' => '2026-10-15 09:00:00', 'end_time' => '2026-10-15 17:00:00', 'positions' => [['title' => 'President', 'max_winners' => 1]]];

        Sanctum::actingAs($admin);
        $this->postJson('/api/elections', $payload)->assertUnprocessable()->assertJsonValidationErrors('informative_letter');
        $this->post('/api/elections', $payload + ['informative_letter' => UploadedFile::fake()->image('letter.png')], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('informative_letter');
        $response = $this->post('/api/elections', $payload + ['informative_letter' => UploadedFile::fake()->create('letter.pdf', 20, 'application/pdf')], ['Accept' => 'application/json'])->assertCreated();
        $id = $response->json('id');
        $election = Election::findOrFail($id);
        $this->assertSame($semester->id, $election->academic_semester_id);
        $this->assertTrue($response->json('has_informative_letter'));
        $this->assertArrayNotHasKey('informative_letter_path', $response->json());
        Storage::disk('local')->assertExists($election->informative_letter_path);
        $this->get("/api/elections/{$id}/informative-letter")->assertOk();

        Sanctum::actingAs($student);
        $this->get("/api/elections/{$id}/informative-letter")->assertForbidden();
        Sanctum::actingAs($foreignAdmin);
        $this->get("/api/elections/{$id}/informative-letter")->assertNotFound();
    }

    public function test_completed_semester_elections_remain_visible_but_cannot_be_changed(): void
    {
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($admin);
        $payload = ['title' => 'First semester election', 'start_time' => '2026-10-15 09:00:00', 'end_time' => '2026-10-15 17:00:00', 'positions' => [['title' => 'President', 'max_winners' => 1]]];
        $this->post('/api/elections', $payload + ['informative_letter' => UploadedFile::fake()->create('letter.pdf', 20, 'application/pdf')], ['Accept' => 'application/json'])->assertCreated();
        $id = Election::firstOrFail()->id;
        $this->post('/api/elections', ['title' => 'Outside term', 'start_time' => '2027-02-15 09:00:00', 'end_time' => '2027-02-15 17:00:00', 'informative_letter' => UploadedFile::fake()->create('letter.pdf', 20, 'application/pdf')], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('start_time');

        $first->update(['status' => 'completed']);
        $second->update(['status' => 'active']);
        $this->getJson('/api/elections')->assertOk()->assertExactJson([]);
        $this->getJson('/api/elections?academic_semester_id='.$first->id)->assertOk()->assertJsonFragment(['title' => 'First semester election']);
        $this->putJson("/api/elections/{$id}", ['title' => 'Changed'])->assertStatus(409);
        $this->postJson("/api/elections/{$id}/positions", ['title' => 'Treasurer', 'max_winners' => 1])->assertStatus(409);
        $this->postJson("/api/elections/{$id}/vote", ['votes' => []])->assertStatus(409);
        $this->deleteJson("/api/elections/{$id}")->assertStatus(409);
        $second->update(['status' => 'completed']);
        $this->postJson('/api/elections', $payload)->assertStatus(409);
    }
}
