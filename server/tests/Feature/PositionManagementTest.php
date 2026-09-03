<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use Database\Seeders\SboPositionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PositionManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_standard_position_catalog_uses_distinct_vice_presidents_and_required_roles(): void
    {
        $organization = Organization::factory()->create();
        $this->seed(SboPositionSeeder::class);

        $titles = SboPosition::where('organization_id', $organization->id)->where('role', 'SBO_OFFICER')->pluck('title');
        $this->assertContains('Vice President – Internal', $titles);
        $this->assertContains('Vice President – External', $titles);
        $this->assertContains('Assistant Secretary', $titles);
        $this->assertContains('Treasurer', $titles);
        $this->assertContains('Auditor', $titles);
        $this->assertContains('Public Information Officer', $titles);
        $this->assertContains('Representative', $titles);
        $this->assertNotContains('Vice President', $titles);
    }

    public function test_admin_manages_role_aware_positions_with_complete_crud(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $otherAdmin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN', 'position_title' => 'President']);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'President']);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'President', 'is_active' => true]);

        Sanctum::actingAs($admin);
        $positionId = $this->postJson('/api/sbo-positions', [
            'role' => 'ADMIN',
            'title' => 'President',
            'description' => 'Leads the administration.',
            'is_active' => true,
        ])->assertCreated()->assertJsonPath('role', 'ADMIN')->json('id');

        $this->getJson('/api/sbo-positions?role=ADMIN')
            ->assertOk()->assertJsonCount(1)->assertJsonPath('0.title', 'President');

        $this->putJson("/api/sbo-positions/{$positionId}", [
            'role' => 'ADMIN',
            'title' => 'Organization President',
            'description' => 'Updated responsibilities.',
            'is_active' => true,
        ])->assertOk()->assertJsonPath('title', 'Organization President');
        $this->assertSame('Organization President', $otherAdmin->fresh()->position_title);
        $this->assertSame('President', $officer->fresh()->position_title);

        $this->deleteJson("/api/sbo-positions/{$positionId}")->assertOk();
        $this->assertNull($otherAdmin->fresh()->position_title);
        $this->assertSame('President', $officer->fresh()->position_title);
        $this->assertDatabaseMissing('sbo_positions', ['id' => $positionId]);
        $this->assertDatabaseHas('audit_logs', ['module' => 'positions', 'action' => 'deleted', 'record_id' => $positionId]);
    }

    public function test_user_positions_are_validated_by_role_and_organization(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'ADMIN', 'title' => 'Secretary', 'is_active' => true]);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);

        Sanctum::actingAs($admin);
        $adminId = $this->postJson('/api/users', $this->userPayload(71000001, 'ADMIN', 'Secretary'))
            ->assertCreated()->assertJsonPath('position_title', 'Secretary')->json('school_id');

        $this->putJson("/api/users/{$adminId}", ['position_title' => 'Treasurer'])
            ->assertUnprocessable()->assertJsonValidationErrors('position_title');

        $this->postJson('/api/users', $this->userPayload(71000002, 'STUDENT', 'Secretary'))
            ->assertUnprocessable()->assertJsonValidationErrors('position_title');

        $this->postJson('/api/users', $this->userPayload(71000003, 'SBO_OFFICER', 'Treasurer'))
            ->assertCreated()->assertJsonPath('position_title', 'Treasurer');
    }

    public function test_position_writes_are_admin_only_and_tenant_scoped(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $foreignPosition = SboPosition::create(['organization_id' => $otherOrganization->id, 'role' => 'ADMIN', 'title' => 'President']);

        Sanctum::actingAs($officer);
        $this->postJson('/api/sbo-positions', ['role' => 'ADMIN', 'title' => 'Secretary'])->assertForbidden();
        $this->deleteJson("/api/sbo-positions/{$foreignPosition->id}")->assertForbidden();

        Sanctum::actingAs($admin);
        $this->putJson("/api/sbo-positions/{$foreignPosition->id}", ['title' => 'Changed'])->assertNotFound();
        $this->deleteJson("/api/sbo-positions/{$foreignPosition->id}")->assertNotFound();
    }

    private function userPayload(int $schoolId, string $role, ?string $position): array
    {
        return [
            'school_id' => $schoolId,
            'first_name' => 'Test',
            'last_name' => (string) $schoolId,
            'email' => "user{$schoolId}@example.test",
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => $role,
            'position_title' => $position,
        ];
    }
}
