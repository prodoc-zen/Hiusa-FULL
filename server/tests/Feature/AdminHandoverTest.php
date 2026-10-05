<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminHandoverTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $director;

    private User $outgoing;

    protected function setUp(): void
    {
        parent::setUp();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $this->organization = Organization::factory()->create(['name' => 'Computer Science Society']);
        $this->outgoing = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'position_title' => 'President']);
        $this->outgoing->createToken('session');
    }

    public function test_an_existing_member_takes_over_and_the_outgoing_admin_is_deactivated_not_deleted(): void
    {
        $student = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/admins/{$this->outgoing->school_id}/handover", ['mode' => 'existing', 'successor_school_id' => $student->school_id])
            ->assertOk()
            ->assertJsonPath('successor.role', 'ADMIN')
            ->assertJsonPath('successor.position_title', 'President')
            ->assertJsonPath('outgoing.account_status', 'inactive');

        $this->assertSame('ADMIN', $student->fresh()->role);
        $this->assertSame('ADMIN', $student->accountProfiles()->where('organization_id', $this->organization->id)->value('role'));
        $outgoing = $this->outgoing->fresh();
        $this->assertNotNull($outgoing, 'The outgoing account is kept so its history stays attributed.');
        $this->assertNull($outgoing->position_title);
        $this->assertSame(0, $outgoing->tokens()->count());
        $this->assertSame(2, Notification::whereIn('user_id', [$student->school_id, $outgoing->school_id])->count());
        $audit = AuditLog::where('action', 'administrator_handover')->sole();
        $this->assertSame($this->outgoing->school_id, $audit->new_values['outgoing_administrator_id']);
        $this->assertSame('President', $audit->new_values['position_title']);
    }

    public function test_a_new_account_can_take_over_with_the_outgoing_position(): void
    {
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/admins/{$this->outgoing->school_id}/handover", [
            'mode' => 'new',
            'school_id' => 20269999,
            'first_name' => 'Lia',
            'last_name' => 'Santos',
            'email' => 'LIA.SANTOS@example.edu ',
            'password' => 'Turnover2026!',
            'password_confirmation' => 'Turnover2026!',
        ])->assertOk()->assertJsonPath('successor.position_title', 'President');

        $successor = User::find(20269999);
        $this->assertSame('ADMIN', $successor->role);
        $this->assertSame($this->organization->id, $successor->organization_id);
        $this->assertSame('lia.santos@example.edu', $successor->email);
        $this->assertTrue(Hash::check('Turnover2026!', $successor->password_hash));
    }

    public function test_successors_outside_the_organization_or_department_heads_are_refused(): void
    {
        $outsider = User::factory()->create(['organization_id' => Organization::factory()->create()->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $departmentHead = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active']);
        Sanctum::actingAs($this->director);

        $this->postJson("/api/system/admins/{$this->outgoing->school_id}/handover", ['mode' => 'existing', 'successor_school_id' => $outsider->school_id])
            ->assertStatus(422)
            ->assertJsonPath('message', fn ($message) => str_contains($message, 'primary organization'));
        $this->postJson("/api/system/admins/{$this->outgoing->school_id}/handover", ['mode' => 'existing', 'successor_school_id' => $departmentHead->school_id])->assertStatus(422);
        $this->postJson("/api/system/admins/{$this->outgoing->school_id}/handover", ['mode' => 'existing', 'successor_school_id' => $this->outgoing->school_id])->assertStatus(422);

        $this->assertSame('active', $this->outgoing->fresh()->account_status);
        $this->assertSame('STUDENT', $outsider->fresh()->role);
    }

    public function test_only_an_active_organization_admin_can_be_handed_over_and_only_by_the_sao(): void
    {
        $student = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        Sanctum::actingAs($this->outgoing);
        $this->postJson("/api/system/admins/{$this->outgoing->school_id}/handover", ['mode' => 'existing', 'successor_school_id' => $student->school_id])->assertForbidden();

        Sanctum::actingAs($this->director);
        $this->postJson("/api/system/admins/{$student->school_id}/handover", ['mode' => 'existing', 'successor_school_id' => $student->school_id])->assertStatus(422);
        $this->outgoing->update(['account_status' => 'inactive']);
        $this->postJson("/api/system/admins/{$this->outgoing->school_id}/handover", ['mode' => 'existing', 'successor_school_id' => $student->school_id])->assertStatus(422);
    }

    public function test_member_search_lists_only_active_eligible_members_of_that_organization(): void
    {
        User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active', 'first_name' => 'Zyriel', 'last_name' => 'Reyes']);
        User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'disabled', 'first_name' => 'Zyriel', 'last_name' => 'Disabled']);
        User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active', 'first_name' => 'Zyriel', 'last_name' => 'Head']);
        User::factory()->create(['organization_id' => Organization::factory()->create()->id, 'role' => 'STUDENT', 'account_status' => 'active', 'first_name' => 'Zyriel', 'last_name' => 'Elsewhere']);
        Sanctum::actingAs($this->director);

        $members = $this->getJson("/api/system/organizations/{$this->organization->id}/members?search=Zyriel")->assertOk()->json();

        $this->assertSame(['Reyes'], array_column($members, 'last_name'));
        $this->assertArrayNotHasKey('password_hash', $members[0]);
    }
}
