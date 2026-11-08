<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An SBO officer builds the election ballot, so the member directory must hand them fellow officers as
 * well as students. It must never hand them ADMIN or higher, and without a role filter it stays students only.
 */
class OfficerUserDirectoryRolesTest extends TestCase
{
    use RefreshDatabase;

    private User $caller;

    private User $fellowOfficer;

    private User $student;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $organization = Organization::factory()->create(['lifecycle_status' => 'active', 'is_active' => true]);
        $this->caller = User::factory()->officer()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $this->fellowOfficer = User::factory()->officer()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $this->student = User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id, 'account_status' => 'active']);

        Sanctum::actingAs($this->caller);
    }

    private function ids(string $query): array
    {
        $ids = collect($this->getJson('/api/users'.$query)->assertOk()->json('data'))->pluck('school_id')->all();
        sort($ids);

        return $ids;
    }

    private function sorted(User ...$users): array
    {
        $ids = array_map(fn (User $user) => $user->school_id, $users);
        sort($ids);

        return $ids;
    }

    public function test_an_officer_asking_for_students_and_officers_receives_fellow_officers(): void
    {
        $query = '?'.http_build_query(['role' => json_encode(['STUDENT', 'SBO_OFFICER'])]);

        $this->assertSame(
            $this->sorted($this->caller, $this->fellowOfficer, $this->student),
            $this->ids($query),
        );
    }

    public function test_an_officer_asking_for_admins_receives_no_admins(): void
    {
        $this->assertSame([], $this->ids('?'.http_build_query(['role' => json_encode(['ADMIN'])])));
        $this->assertSame([], $this->ids('?role=ADMIN'));
    }

    public function test_an_officer_asking_for_a_mixed_list_never_receives_admins(): void
    {
        $query = '?'.http_build_query(['role' => json_encode(['SBO_OFFICER', 'ADMIN', 'SUPER_ADMIN'])]);

        $this->assertSame($this->sorted($this->caller, $this->fellowOfficer), $this->ids($query));
    }

    public function test_an_officer_with_no_role_filter_still_receives_students_only(): void
    {
        $this->assertSame($this->sorted($this->student), $this->ids(''));
    }
}
