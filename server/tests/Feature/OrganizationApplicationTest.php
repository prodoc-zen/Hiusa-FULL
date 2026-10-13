<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\College;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrganizationApplicationTest extends TestCase
{
    use RefreshDatabase;

    private function payload(College $college): array
    {
        return ['college_id' => $college->id, 'name' => 'Computing Council', 'acronym' => 'CC', 'school_id' => 87651234, 'first_name' => 'Alex', 'last_name' => 'Rivera', 'email' => 'alex@example.test', 'position_title' => 'President'];
    }

    public function test_verified_application_requires_own_college_endorsement_before_sao_approval(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->postJson('/api/organization-applications', $this->payload($college))->assertCreated()->assertJsonMissing(['email', 'school_id']);
        $application = OrganizationApplication::firstOrFail();
        $this->assertSame('pending_verification', $application->status);
        $this->getJson('/api/organization-applications/'.$application->id.'/verify')->assertForbidden();
        $this->get(URL::temporarySignedRoute('organization-applications.verify', now()->addDay(), ['application' => $application->id]))->assertRedirect();
        $head = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => $college->name])->id]);
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        Sanctum::actingAs($sao);
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => 'Another College'])->id]));
        $this->getJson('/api/organization-applications')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'endorse'])->assertNotFound();
        Sanctum::actingAs($head);
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertUnprocessable()->assertJsonValidationErrors('action');
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'reject'])->assertUnprocessable()->assertJsonValidationErrors('remarks');
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'endorse'])->assertOk()->assertJsonPath('status', 'endorsed');
        $this->assertDatabaseHas('notifications', ['user_id' => $sao->school_id, 'reference_type' => 'organization_application', 'reference_id' => $application->id]);
        Sanctum::actingAs($sao);
        $response = $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertOk()->assertJsonPath('status', 'approved')->assertJsonPath('email_sent', true);
        $orgId = $response->json('organization_id');
        $this->assertDatabaseHas('users', ['school_id' => 87651234, 'role' => 'ADMIN', 'organization_id' => $orgId, 'first_name' => 'Alex', 'email' => 'alex@example.test']);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 87651234, 'organization_id' => $orgId, 'role' => 'ADMIN']);
        $this->assertDatabaseHas('sbo_positions', ['organization_id' => $orgId, 'role' => 'ADMIN', 'title' => 'President']);
        Mail::assertQueued(PasswordResetMail::class, fn ($mail) => $mail->hasTo('alex@example.test'));
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        $this->assertSame(1, Organization::where('name', 'Computing Council')->count());
    }

    public function test_validation_duplicate_applications_expired_links_and_forbidden_roles(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Arts', 'is_active' => true]);
        $this->getJson('/api/organization-applications')->assertUnauthorized();
        $this->postJson('/api/organization-applications', [])->assertUnprocessable()->assertJsonValidationErrors(['name', 'email', 'position_title']);
        $this->postJson('/api/organization-applications', $this->payload($college))->assertCreated();
        $this->postJson('/api/organization-applications', $this->payload($college))->assertUnprocessable()->assertJsonValidationErrors('name');
        $application = OrganizationApplication::firstOrFail();
        $url = URL::temporarySignedRoute('organization-applications.verify', now()->subMinute(), ['application' => $application->id]);
        $this->getJson($url)->assertForbidden();
        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role' => $role]));
            $this->getJson('/api/organization-applications')->assertForbidden();
            $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertForbidden();
        }
    }

    public function test_existing_verified_applicant_receives_a_profile_without_changing_their_login(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $existing = User::factory()->officer()->create(['school_id' => 87651234, 'email' => 'alex@example.test']);
        $hash = $existing->password_hash;
        $application = OrganizationApplication::create([...$this->payload($college), 'status' => 'endorsed', 'email_verified_at' => now(), 'endorsed_at' => now()]);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $id = $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertOk()->json('organization_id');
        $this->assertSame($hash, $existing->fresh()->password_hash);
        $this->assertSame('SBO_OFFICER', $existing->fresh()->role);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $existing->school_id, 'organization_id' => $id, 'role' => 'ADMIN']);
        Mail::assertNothingQueued();
    }

    public function test_unverified_and_inactive_applicants_cannot_receive_admin_access(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $application = OrganizationApplication::create([...$this->payload($college), 'status' => 'endorsed']);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        $application->update(['email_verified_at' => now()]);
        User::factory()->officer()->create(['school_id' => 87651234, 'email' => 'alex@example.test', 'account_status' => 'disabled']);
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        $this->assertDatabaseMissing('organizations', ['name' => 'Computing Council']);
    }
}
