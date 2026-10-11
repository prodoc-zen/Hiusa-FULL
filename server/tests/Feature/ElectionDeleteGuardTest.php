<?php

namespace Tests\Feature;

use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** An election that is open or closed is kept: the Admin closes it instead of deleting it, also when it opens after the guard first read it. */
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

    public function test_an_election_that_opens_after_it_was_read_is_kept(): void
    {
        $election = $this->election('upcoming');
        $this->afterTheElectionIsRead(fn () => DB::table('elections')->where('id', $election->id)->update(['status' => 'active']));

        $this->deleteJson("/api/elections/{$election->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'An open election cannot be deleted. Close it instead to keep the results.');

        $this->assertModelExists($election);
    }

    public function test_an_election_deleted_after_it_was_read_answers_not_found(): void
    {
        $election = $this->election('upcoming');
        $this->afterTheElectionIsRead(fn () => DB::table('elections')->where('id', $election->id)->delete());

        $this->deleteJson("/api/elections/{$election->id}")->assertNotFound();
    }

    public function test_the_delete_locks_the_approval_rows_before_the_election_row_like_the_review_does(): void
    {
        $election = $this->election('upcoming');
        $touched = [];
        DB::listen(function ($query) use (&$touched) {
            $sql = str_replace(['"', '`'], '', $query->sql);
            if (str_starts_with($sql, 'select') && str_contains($sql, 'from approval_requests')) {
                $touched[] = 'approval_requests';
            } elseif (str_starts_with($sql, 'select * from elections where elections.id')) {
                $touched[] = 'elections';
            }
        });

        $this->deleteJson("/api/elections/{$election->id}")->assertOk();

        $this->assertSame(['approval_requests', 'elections'], array_slice(array_values(array_unique($touched)), 0, 2));
    }

    public function test_a_position_added_to_an_election_deleted_after_it_was_read_answers_not_found(): void
    {
        $election = $this->election('upcoming');
        $election->update(['finalized_at' => null]);
        $this->afterTheElectionIsRead(fn () => DB::table('elections')->where('id', $election->id)->delete());

        $this->postJson("/api/elections/{$election->id}/positions", ['title' => 'President'])->assertNotFound();

        $this->assertSame(0, DB::table('election_positions')->count());
    }

    public function test_a_candidate_added_to_an_election_deleted_after_the_checks_answers_not_found(): void
    {
        $election = $this->election('upcoming');
        $election->update(['finalized_at' => null]);
        $position = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $student = User::factory()->student()->create(['organization_id' => $this->admin->organization_id]);
        DB::listen(function ($query) use ($election) {
            if (str_contains(str_replace(['"', '`'], '', $query->sql), 'from candidates where election_id')) {
                DB::table('elections')->where('id', $election->id)->delete();
            }
        });

        $this->postJson("/api/elections/{$election->id}/candidates", ['user_id' => $student->school_id, 'position_id' => $position->id])->assertNotFound();

        $this->assertSame(0, DB::table('candidates')->count());
    }

    /** The request reads the election twice before its guard (the second read is the controller's), so the change lands after the second. */
    private function afterTheElectionIsRead(callable $interleave): void
    {
        $reads = 0;
        DB::listen(function ($query) use (&$reads, $interleave) {
            if (str_starts_with(str_replace(['"', '`'], '', $query->sql), 'select * from elections where organization_id') && ++$reads === 2) {
                $interleave();
            }
        });
    }
}
