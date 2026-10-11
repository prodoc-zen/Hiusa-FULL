<?php

namespace Tests\Feature;

use App\Models\Election;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** An election that is open or closed is kept: the Admin closes it instead of deleting it. */
class ElectionDeleteGuardTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->admin()->create(['organization_id' => Organization::factory()]);
        Sanctum::actingAs($this->admin);
    }

    private function election(string $status): Election
    {
        return Election::factory()->create([
            'organization_id' => $this->admin->organization_id,
            'status' => $status,
            'approved_at' => now(),
            'finalized_at' => now(),
        ]);
    }

    public function test_an_open_election_cannot_be_deleted_even_without_votes(): void
    {
        $election = $this->election('active');

        $this->deleteJson("/api/elections/{$election->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'An open election cannot be deleted. Close it instead to keep the results.');

        $this->assertModelExists($election);
    }

    public function test_a_closed_election_cannot_be_deleted(): void
    {
        $election = $this->election('closed');

        $this->deleteJson("/api/elections/{$election->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'Closed elections cannot be deleted.');

        $this->assertModelExists($election);
    }

    public function test_an_upcoming_election_without_votes_can_be_deleted(): void
    {
        $election = $this->election('upcoming');

        $this->deleteJson("/api/elections/{$election->id}")->assertOk();

        $this->assertModelMissing($election);
    }
}
