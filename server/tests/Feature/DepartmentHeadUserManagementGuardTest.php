<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DepartmentHeadUserManagementGuardTest extends TestCase
{
    use RefreshDatabase;

    private const MESSAGE = 'Department Head accounts are managed only by the SAO Director.';

    private User $admin;

    private User $head;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->head = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($this->admin);
    }

    public function test_an_admin_cannot_disable_a_department_head(): void
    {
        $this->postJson('/api/users/'.$this->head->school_id.'/disable')
            ->assertForbidden()
            ->assertJsonPath('message', self::MESSAGE);

        $this->assertSame('active', $this->head->fresh()->account_status);
    }

    public function test_an_admin_cannot_reactivate_a_department_head(): void
    {
        $this->head->forceFill(['account_status' => 'disabled'])->save();

        $this->postJson('/api/users/'.$this->head->school_id.'/reactivate')
            ->assertForbidden()
            ->assertJsonPath('message', self::MESSAGE);

        $this->assertSame('disabled', $this->head->fresh()->account_status);
    }

    public function test_an_admin_cannot_remove_a_department_head_profile(): void
    {
        $this->deleteJson('/api/users/'.$this->head->school_id)
            ->assertForbidden()
            ->assertJsonPath('message', self::MESSAGE);

        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $this->head->school_id, 'organization_id' => $this->head->organization_id]);
    }
}
