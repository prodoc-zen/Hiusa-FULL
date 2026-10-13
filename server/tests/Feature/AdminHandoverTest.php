<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminHandoverTest extends TestCase
{
    use RefreshDatabase;

    public function test_sao_cannot_appoint_successors_or_deactivate_the_outgoing_admin_through_handover(): void
    {
        $org = Organization::factory()->create();
        $outgoing = User::factory()->admin()->create(['organization_id' => $org->id]);
        $successor = User::factory()->student()->create(['organization_id' => $org->id]);
        $outgoing->createToken('session');
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        foreach (['existing', 'new'] as $mode) {
            $this->postJson("/api/system/admins/{$outgoing->school_id}/handover", ['mode' => $mode, 'successor_school_id' => $successor->school_id])->assertForbidden();
        }
        $this->assertSame('active', $outgoing->fresh()->account_status);
        $this->assertSame('STUDENT', $successor->fresh()->role);
        $this->assertSame(1, $outgoing->tokens()->count());
        $this->assertDatabaseMissing('audit_logs', ['action' => 'administrator_handover']);
    }

    public function test_other_roles_cannot_use_the_removed_sao_handover_workflow(): void
    {
        $org = Organization::factory()->create();
        $outgoing = User::factory()->admin()->create(['organization_id' => $org->id]);
        foreach (['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $role) {
            Sanctum::actingAs(User::factory()->create(['organization_id' => $org->id, 'role' => $role]));
            $this->postJson("/api/system/admins/{$outgoing->school_id}/handover", ['mode' => 'existing'])->assertForbidden();
        }
    }
}
