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

    public function test_sbo_officer_can_manage_students_in_their_organization(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'SBO_OFFICER',
            'account_status' => 'active',
        ]);
        Sanctum::actingAs($officer);

        $created = $this->postJson('/api/users', $this->payload(77000001, 'STUDENT'))
            ->assertCreated()
            ->assertJsonPath('role', 'STUDENT')
            ->assertJsonPath('organization_id', $organization->id);

        $schoolId = $created->json('school_id');
        $this->putJson("/api/users/{$schoolId}", ['first_name' => 'Updated'])
            ->assertOk()
            ->assertJsonPath('first_name', 'Updated');

        $this->postJson("/api/users/{$schoolId}/disable")->assertOk();
        $this->postJson("/api/users/{$schoolId}/reactivate")
            ->assertOk()
            ->assertJsonPath('account_status', 'active');

        $this->postJson("/api/users/{$schoolId}/fingerprint", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('samples');

        $this->deleteJson("/api/users/{$schoolId}")->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $schoolId]);
    }

    public function test_sbo_officer_cannot_create_promote_or_modify_non_student_accounts(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $actor = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $otherOfficer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']);
        $foreignStudent = User::factory()->create(['organization_id' => $otherOrganization->id, 'role' => 'STUDENT']);
        Sanctum::actingAs($actor);

        $this->postJson('/api/users', $this->payload(77000002, 'SBO_OFFICER'))
            ->assertForbidden()
            ->assertJsonPath('message', 'SBO Officers can create Student accounts only.');

        $this->putJson("/api/users/{$student->school_id}", ['role' => 'SBO_OFFICER'])
            ->assertForbidden()
            ->assertJsonPath('message', 'SBO Officers cannot assign or promote users to another role.');

        foreach ([$otherOfficer, $admin] as $protectedUser) {
            $this->putJson("/api/users/{$protectedUser->school_id}", ['first_name' => 'Changed'])
                ->assertForbidden()
                ->assertJsonPath('message', 'SBO Officers can manage Student accounts only.');
            $this->postJson("/api/users/{$protectedUser->school_id}/disable")->assertForbidden();
            $this->postJson("/api/users/{$protectedUser->school_id}/reactivate")->assertForbidden();
            $this->deleteJson("/api/users/{$protectedUser->school_id}")->assertForbidden();
            $this->postJson("/api/users/{$protectedUser->school_id}/fingerprint", [])
                ->assertForbidden()
                ->assertJsonPath('message', 'SBO Officers can manage Student fingerprints only.');
        }

        $this->putJson("/api/users/{$foreignStudent->school_id}", ['first_name' => 'Leaked'])
            ->assertNotFound();
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
