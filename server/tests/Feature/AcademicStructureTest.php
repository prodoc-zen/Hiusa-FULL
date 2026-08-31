<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicStructureTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_configures_program_sections_and_department_is_derived_when_creating_users(): void
    {
        $organization = Organization::factory()->create(['college' => 'College of Computer Studies']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/academic-structure/programs', [
            'name' => 'BS Information Technology',
            'sections' => ['1' => 2, '2' => 1, '3' => 0, '4' => 0],
        ])->assertCreated()
            ->assertJsonPath('name', 'BS Information Technology')
            ->assertJsonCount(7, 'sections')
            ->assertJsonFragment(['name' => '4 - Non Block']);

        $this->getJson('/api/academic-structure')
            ->assertOk()
            ->assertJsonPath('department', 'College of Computer Studies')
            ->assertJsonPath('programs.0.sections.0.name', '1 - Non Block');

        $this->postJson('/api/users', [
            'school_id' => 87654321,
            'first_name' => 'Academic',
            'last_name' => 'Student',
            'email' => 'academic.student@example.test',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => 'STUDENT',
            'contact_number' => '+63 912 345 6789',
            'department' => 'Attempted override',
            'program' => 'BS Information Technology',
            'year_level' => '1st Year',
            'section' => '1-B',
        ])->assertCreated()
            ->assertJsonPath('department', 'College of Computer Studies')
            ->assertJsonPath('contact_number', '+63 912 345 6789');

        $this->getJson('/api/users?program=BS%20Information%20Technology&year_level=1st%20Year&section=1-B')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.school_id', 87654321);
    }

    public function test_admin_can_update_and_delete_programs_without_orphaning_user_profiles(): void
    {
        $organization = Organization::factory()->create(['college' => 'College of Computer Studies']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);

        $programId = $this->postJson('/api/academic-structure/programs', [
            'name' => 'BSIT',
            'sections' => ['1' => 2, '2' => 0, '3' => 0, '4' => 0],
        ])->assertCreated()->json('id');

        $student = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'program' => 'BSIT',
            'year_level' => '1st Year',
            'section' => '1-B',
        ]);

        $this->putJson("/api/academic-structure/programs/{$programId}", [
            'name' => 'BS Information Technology',
            'sections' => ['1' => 2, '2' => 1, '3' => 0, '4' => 0],
        ])->assertOk()
            ->assertJsonPath('name', 'BS Information Technology')
            ->assertJsonFragment(['name' => '2 - Non Block'])
            ->assertJsonFragment(['name' => '2-A']);

        $this->assertDatabaseHas('users', [
            'school_id' => $student->school_id,
            'program' => 'BS Information Technology',
            'section' => '1-B',
        ]);

        $this->putJson("/api/academic-structure/programs/{$programId}", [
            'name' => 'BS Information Technology',
            'sections' => ['1' => 1, '2' => 1, '3' => 0, '4' => 0],
        ])->assertUnprocessable()->assertJsonValidationErrors('sections.1');

        $this->deleteJson("/api/academic-structure/programs/{$programId}")->assertConflict();

        $unassignedId = $this->postJson('/api/academic-structure/programs', [
            'name' => 'BS Computer Science',
            'sections' => ['1' => 0, '2' => 0, '3' => 0, '4' => 0],
        ])->assertCreated()->assertJsonCount(4, 'sections')->json('id');

        $this->deleteJson("/api/academic-structure/programs/{$unassignedId}")->assertOk();
        $this->assertDatabaseMissing('academic_programs', ['id' => $unassignedId]);
        $this->assertDatabaseHas('audit_logs', ['module' => 'academic_structure', 'action' => 'deleted', 'record_id' => $unassignedId]);
    }

    public function test_academic_setup_is_admin_only_and_sections_cannot_cross_program_or_organization_boundaries(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($student);
        $this->getJson('/api/academic-structure')->assertForbidden();

        Sanctum::actingAs($admin);
        $programId = $this->postJson('/api/academic-structure/programs', [
            'name' => 'BS Computer Science',
            'sections' => ['1' => 1, '2' => 0, '3' => 0, '4' => 0],
        ])->assertCreated()->json('id');

        $otherOrganization = Organization::factory()->create();
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $otherOrganization->id]);
        Sanctum::actingAs($otherAdmin);
        $this->putJson("/api/academic-structure/programs/{$programId}", [
            'name' => 'Cross Organization Edit',
            'sections' => ['1' => 1, '2' => 0, '3' => 0, '4' => 0],
        ])->assertNotFound();
        $this->deleteJson("/api/academic-structure/programs/{$programId}")->assertNotFound();

        Sanctum::actingAs($admin);

        $this->postJson('/api/users', [
            'school_id' => 87654322,
            'first_name' => 'Invalid', 'last_name' => 'Section', 'email' => 'invalid.section@example.test',
            'password' => 'password123', 'password_confirmation' => 'password123', 'role' => 'STUDENT',
            'program' => 'BS Computer Science', 'year_level' => '2nd Year', 'section' => '1-A',
        ])->assertUnprocessable()->assertJsonValidationErrors('section');

        $this->postJson('/api/users', [
            'school_id' => 87654323,
            'first_name' => 'Missing', 'last_name' => 'Year', 'email' => 'missing.year@example.test',
            'password' => 'password123', 'password_confirmation' => 'password123', 'role' => 'STUDENT',
            'program' => 'BS Computer Science', 'section' => '1-A',
        ])->assertUnprocessable()->assertJsonValidationErrors('year_level');

        $this->postJson('/api/academic-structure/programs', [
            'name' => 'Invalid Year Program',
            'sections' => ['1' => 0, '2' => 0, '3' => 0, '4' => 0, '5' => 1],
        ])->assertUnprocessable()->assertJsonValidationErrors('sections');
    }

    public function test_student_contact_number_is_created_updated_and_user_deletion_is_audited(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);

        $studentId = 87654350;
        $this->postJson('/api/users', [
            'school_id' => $studentId,
            'first_name' => 'Contact',
            'last_name' => 'Student',
            'email' => 'contact.student@example.test',
            'contact_number' => '+63 917 123 4567',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => 'STUDENT',
        ])->assertCreated()->assertJsonPath('contact_number', '+63 917 123 4567');

        $this->putJson("/api/users/{$studentId}", [
            'contact_number' => '0918-765-4321',
        ])->assertOk()->assertJsonPath('contact_number', '0918-765-4321');

        $this->deleteJson("/api/users/{$studentId}")->assertOk();
        $this->assertDatabaseMissing('users', ['school_id' => $studentId]);
        $this->assertDatabaseHas('audit_logs', [
            'module' => 'users',
            'action' => 'deleted',
            'record_id' => $studentId,
        ]);
    }
}
