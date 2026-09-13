<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class OrganizationLeadershipLoginTest extends TestCase
{
    use RefreshDatabase;

    public function test_sao_and_each_seeded_organization_leadership_admin_can_select_their_own_login_area(): void
    {
        $this->seed();
        $sao = Organization::where('acronym', 'SAO')->firstOrFail();
        $psits = Organization::where('acronym', 'PSITS-CCS')->firstOrFail();

        $this->getJson('/api/organizations?for_login=1')
            ->assertOk()
            ->assertJsonFragment(['id' => $sao->id, 'organization_type' => 'SYSTEM_ADMINISTRATION'])
            ->assertJsonFragment(['id' => $psits->id, 'acronym' => 'PSITS-CCS']);

        $this->postJson('/api/login', ['organization_id' => $sao->id, 'school_id' => 990001, 'password' => 'Admin@123456'])
            ->assertOk()
            ->assertJsonPath('user.role', 'SUPER_ADMIN');

        foreach ([990002 => 'Adviser', 990003 => 'President', 990004 => 'Vice President – Internal', 990005 => 'Secretary'] as $schoolId => $position) {
            $leader = User::where('organization_id', $psits->id)->where('school_id', $schoolId)->firstOrFail();
            $this->assertSame('ADMIN', $leader->role);
            $this->assertSame($position, $leader->position_title);
            $this->assertTrue(Hash::check('Admin@123456', $leader->password_hash), "Seeded {$position} password is not configured.");
            $this->postJson('/api/login', ['organization_id' => $psits->id, 'school_id' => $leader->school_id, 'password' => 'Admin@123456'])
                ->assertOk()
                ->assertJsonPath('user.role', 'ADMIN');
        }

        foreach ([900001 => 'President', 900002 => 'Vice President – Internal', 900003 => 'Secretary'] as $schoolId => $position) {
            $leader = User::where('organization_id', $psits->id)->where('school_id', $schoolId)->firstOrFail();
            $this->assertSame('ADMIN', $leader->role);
            $this->assertSame($position, $leader->position_title);
            $this->postJson('/api/login', ['organization_id' => $psits->id, 'school_id' => $leader->school_id, 'password' => 'Demo@12345'])
                ->assertOk()
                ->assertJsonPath('user.role', 'ADMIN');
        }
    }
}
