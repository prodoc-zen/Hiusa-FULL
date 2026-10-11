<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A Department Head can withdraw a registration at any moment, so a decision that bound the row a
 * moment earlier may find it gone when it takes the lock. That is a clean conflict, never a server error.
 */
class OrganizationLifecycleRaceTest extends TestCase
{
    use RefreshDatabase;

    private User $director;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]);
        $this->organization = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id]);
        Sanctum::actingAs($this->director);
    }

    /** Deletes the organization right after route binding has read it and before the locked read. */
    private function withdrawAfterBinding(): void
    {
        $id = $this->organization->id;
        $fired = false;
        DB::listen(function ($query) use (&$fired, $id) {
            if (! $fired && str_contains($query->sql, 'from "organizations"') && str_contains($query->sql, 'limit 1')) {
                $fired = true;
                DB::table('organizations')->where('id', $id)->delete();
            }
        });
    }

    public function test_a_review_of_a_registration_withdrawn_after_binding_is_a_conflict(): void
    {
        $this->organization->update(['lifecycle_status' => 'pending', 'is_active' => false, 'submitted_at' => now()]);
        $submittedAt = $this->organization->fresh()->submitted_at->toISOString();
        $this->withdrawAfterBinding();

        $this->patchJson("/api/system/organizations/{$this->organization->id}/review", ['decision' => 'approve', 'submitted_at' => $submittedAt])
            ->assertStatus(409);
    }

    public function test_resubmitting_a_returned_registration_withdrawn_after_it_was_read_is_a_conflict(): void
    {
        $this->organization->update(['lifecycle_status' => 'returned', 'is_active' => false]);
        $head = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => $this->organization->college, 'college_id' => $this->organization->college_id, 'organization_type' => 'COLLEGE'])->id]);
        Sanctum::actingAs($head);
        $id = $this->organization->id;
        $fired = false;
        DB::listen(function ($query) use (&$fired, $id) {
            if (! $fired && str_starts_with($query->sql, 'select * from "organizations" where "organization_type"') && str_contains($query->sql, 'limit 1')) {
                $fired = true;
                DB::table('organizations')->where('id', $id)->delete();
            }
        });

        $this->putJson("/api/college/organizations/{$id}", ['name' => 'Renamed'])->assertStatus(409);
        $this->assertTrue($fired, 'the withdraw did not interleave');
    }

    public function test_archiving_an_organization_removed_after_binding_is_a_conflict(): void
    {
        $this->organization->update(['lifecycle_status' => 'active']);
        $this->withdrawAfterBinding();

        $this->postJson("/api/system/organizations/{$this->organization->id}/archive")->assertStatus(409);
    }

    public function test_restoring_an_organization_removed_after_binding_is_a_conflict(): void
    {
        $this->organization->update(['lifecycle_status' => 'archived', 'is_active' => false]);
        $this->withdrawAfterBinding();

        $this->postJson("/api/system/organizations/{$this->organization->id}/restore")->assertStatus(409);
    }
}
