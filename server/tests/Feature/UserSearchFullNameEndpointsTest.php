<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserSearchFullNameEndpointsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private Organization $other;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create(['college' => 'College of Computer Studies']);
        $this->other = Organization::factory()->create(['college' => 'College of Business Education']);
    }

    private function person(string $first, string $last, string $role, ?Organization $organization = null): User
    {
        return User::factory()->create([
            'organization_id' => ($organization ?? $this->organization)->id,
            'role' => $role,
            'first_name' => $first,
            'last_name' => $last,
        ]);
    }

    private function names(array $rows, string $first = 'first_name', string $last = 'last_name'): array
    {
        return collect($rows)->map(fn ($row) => trim($row[$first].' '.$row[$last]))->sort()->values()->all();
    }

    private function director(): User
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();

        return User::factory()->superAdmin()->create(['organization_id' => $sao->id, 'first_name' => 'Quill', 'last_name' => 'Keeper']);
    }

    public function test_sao_users_finds_a_full_name_in_either_order_without_mixing_two_people(): void
    {
        $this->person('Juan', 'Dela Cruz', 'STUDENT');
        $this->person('Juana', 'Santos', 'STUDENT', $this->other);
        Sanctum::actingAs($this->director());

        $found = fn (string $search) => $this->names($this->getJson('/api/system/users?'.http_build_query(['search' => $search]))->assertOk()->json('data'));

        $this->assertSame(['Juan Dela Cruz'], $found('Juan Dela Cruz'));
        $this->assertSame(['Juan Dela Cruz'], $found('Dela Cruz, Juan'));
        $this->assertSame([], $found('Juan Santos'));
    }

    public function test_sao_administrators_find_a_full_name_and_stay_within_the_organization_filter(): void
    {
        $this->person('Juan', 'Dela Cruz', 'ADMIN');
        $this->person('Juan', 'Dela Cruz', 'ADMIN', $this->other);
        $this->person('Juan', 'Dela Cruz', 'STUDENT');
        Sanctum::actingAs($this->director());

        $found = fn (array $query) => $this->getJson('/api/system/admins?'.http_build_query($query))->assertOk()->json('data');

        $this->assertSame(['Juan Dela Cruz', 'Juan Dela Cruz'], $this->names($found(['search' => 'Juan Dela Cruz'])));
        $this->assertSame(['Juan Dela Cruz', 'Juan Dela Cruz'], $this->names($found(['search' => 'Dela Cruz, Juan'])));
        $this->assertSame(['Juan Dela Cruz'], $this->names($found(['search' => 'Juan Dela Cruz', 'organization_id' => $this->organization->id])));
        $this->assertSame([], $found(['search' => 'Juan Santos']));
    }

    public function test_the_successor_picker_finds_a_full_name_among_the_organizations_active_members_only(): void
    {
        $this->person('Juan', 'Dela Cruz', 'STUDENT');
        $this->person('Juan', 'Dela Cruz', 'STUDENT', $this->other);
        User::factory()->student()->create(['organization_id' => $this->organization->id, 'account_status' => 'inactive', 'first_name' => 'Juan', 'last_name' => 'Dela Cruz']);
        Sanctum::actingAs($this->director());

        $found = fn (string $search) => $this->getJson('/api/system/organizations/'.$this->organization->id.'/members?'.http_build_query(['search' => $search]))->assertOk()->json();

        $this->assertSame(['Juan Dela Cruz'], $this->names($found('Juan Dela Cruz')));
        $this->assertSame(['Juan Dela Cruz'], $this->names($found('Dela Cruz, Juan')));
        $this->assertSame([], $found('Juan Santos'));
    }

    public function test_the_attendance_log_finds_a_full_name_within_its_own_event_and_a_student_still_sees_only_their_own(): void
    {
        $admin = $this->person('Quill', 'Keeper', 'ADMIN');
        $juan = $this->person('Juan', 'Dela Cruz', 'STUDENT');
        $other = $this->person('Juana', 'Santos', 'STUDENT');
        $event = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $admin->id, 'status' => 'approved']);
        $elsewhere = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $admin->id, 'status' => 'approved']);
        foreach ([$juan, $other] as $user) {
            Attendance::factory()->create(['event_id' => $event->id, 'user_id' => $user->school_id, 'method' => 'manual', 'status' => 'present', 'check_in_time' => now()]);
        }
        Attendance::factory()->create(['event_id' => $elsewhere->id, 'user_id' => $juan->school_id, 'method' => 'manual', 'status' => 'present', 'check_in_time' => now()]);

        $found = fn (Event $event, string $search) => collect($this->getJson("/api/events/{$event->id}/attendance?".http_build_query(['search' => $search]))->assertOk()->json('records'))
            ->map(fn ($record) => $record['user_id'] ?? $record['user']['school_id'])->all();

        Sanctum::actingAs($admin);
        $this->assertSame([$juan->school_id], $found($event, 'Juan Dela Cruz'));
        $this->assertSame([$juan->school_id], $found($event, 'Dela Cruz, Juan'));
        $this->assertSame([], $found($event, 'Juan Santos'));

        Sanctum::actingAs($other);
        $this->assertSame([], $found($event, 'Juan Dela Cruz'));
        $this->assertSame([$other->school_id], $found($event, 'Juana Santos'));
    }

    public function test_the_profile_member_list_and_candidate_picker_accept_a_surname_first_search_with_a_comma(): void
    {
        $admin = $this->person('Quill', 'Keeper', 'ADMIN');
        $this->person('Juan', 'Dela Cruz', 'STUDENT');
        $this->person('Juana', 'Santos', 'STUDENT');
        $child = Organization::factory()->create(['college' => 'College of Computer Studies', 'parent_organization_id' => $this->organization->id]);
        $outsider = $this->person('Juan', 'Dela Cruz', 'STUDENT', $this->other);
        $candidate = $this->person('Pedro', 'Dela Cruz', 'STUDENT', $child);
        Sanctum::actingAs($admin);

        $members = fn (string $search) => $this->names($this->getJson('/api/account-profiles?'.http_build_query(['search' => $search]))->assertOk()->json('data'));
        $this->assertSame(['Juan Dela Cruz'], $members('Juan Dela Cruz'));
        $this->assertSame(['Juan Dela Cruz'], $members('Dela Cruz, Juan'));
        $this->assertSame([], $members('Santos, Pedro'));

        $candidates = fn (string $search) => collect($this->getJson('/api/account-profiles/candidates?'.http_build_query(['organization_id' => $this->organization->id, 'search' => $search]))->assertOk()->json('data'))->pluck('school_id')->all();
        $this->assertSame([$candidate->school_id], $candidates('Dela Cruz, Pedro'));
        $this->assertNotContains($outsider->school_id, $candidates('Dela Cruz, Juan'));
    }
}
