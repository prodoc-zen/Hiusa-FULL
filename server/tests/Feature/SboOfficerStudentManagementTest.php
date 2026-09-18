<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SboOfficerStudentManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_sbo_officer_can_view_students_and_manage_their_biometrics_without_managing_accounts(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'SBO_OFFICER',
            'account_status' => 'active',
        ]);
        Sanctum::actingAs($officer);

        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        User::factory()->admin()->create(['organization_id' => $organization->id]);

        $this->getJson('/api/users')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.school_id', $student->school_id);

        $this->postJson('/api/users', $this->payload(77000001, 'STUDENT'))->assertForbidden();
        $this->putJson("/api/users/{$student->school_id}", ['first_name' => 'Updated'])->assertForbidden();
        $this->postJson("/api/users/{$student->school_id}/disable")->assertForbidden();
        $this->postJson("/api/users/{$student->school_id}/reactivate")->assertForbidden();
        $this->deleteJson("/api/users/{$student->school_id}")->assertForbidden();

        $this->postJson("/api/users/{$student->school_id}/fingerprint", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('samples');
    }

    public function test_sbo_officer_directory_never_exposes_non_student_accounts(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $actor = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $otherOfficer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']);
        $foreignStudent = User::factory()->create(['organization_id' => $otherOrganization->id, 'role' => 'STUDENT']);
        Sanctum::actingAs($actor);

        $this->getJson('/api/users?role=ADMIN')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/users?role=SBO_OFFICER')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/users?role=STUDENT')->assertOk()->assertJsonCount(1, 'data');

        foreach ([$otherOfficer, $admin] as $protectedUser) {
            $this->postJson("/api/users/{$protectedUser->school_id}/fingerprint", [])
                ->assertForbidden()
                ->assertJsonPath('message', 'SBO Officers can manage Student fingerprints only.');
        }

        $this->postJson("/api/users/{$foreignStudent->school_id}/fingerprint", [])->assertNotFound();
        $this->assertDatabaseHas('users', ['school_id' => $student->school_id, 'role' => 'STUDENT']);
        $this->assertDatabaseHas('users', ['school_id' => $otherOfficer->school_id, 'first_name' => $otherOfficer->first_name]);
    }

    private function payload(int $schoolId, string $role): array
    {
        return [
            'school_id' => $schoolId,
            'first_name' => 'Managed',
            'last_name' => 'User',
            'email' => "managed{$schoolId}@example.test",
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => $role,
        ];
    }
}
