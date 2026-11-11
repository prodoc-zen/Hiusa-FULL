<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A candidate photo posted as `image` is stored, and one over the limit is refused in plain words instead of being dropped. */
class CandidatePhotoTest extends TestCase
{
    use RefreshDatabase;

    private Election $election;

    private ElectionPosition $position;

    private User $student;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $this->election = Election::factory()->create(['organization_id' => $organization->id, 'status' => 'upcoming', 'finalized_at' => null]);
        $this->position = ElectionPosition::create(['election_id' => $this->election->id, 'title' => 'President', 'max_winners' => 1]);
        $this->student = User::factory()->student()->create(['organization_id' => $organization->id]);
    }

    private function add(?UploadedFile $photo)
    {
        return $this->post("/api/elections/{$this->election->id}/candidates", array_filter([
            'user_id' => $this->student->school_id,
            'position_id' => $this->position->id,
            'image' => $photo,
        ]), ['Accept' => 'application/json']);
    }

    public function test_a_posted_photo_is_stored_and_its_url_returned(): void
    {
        $response = $this->add(UploadedFile::fake()->image('face.jpg')->size(1500))->assertCreated();

        $candidate = Candidate::findOrFail($response->json('id'));
        $this->assertNotNull($candidate->image_url);
        $this->assertSame($candidate->image_url, $response->json('image_url'));
        Storage::disk('public')->assertExists('candidates/'.basename($candidate->image_url));
    }

    public function test_a_photo_over_the_limit_is_refused_and_no_candidate_is_created(): void
    {
        $response = $this->add(UploadedFile::fake()->image('face.jpg')->size(3000))->assertUnprocessable();

        $this->assertSame('The candidate photo must be 2 MB or smaller.', $response->json('errors.image.0'));
        $this->assertDatabaseCount('candidates', 0);
    }
}
