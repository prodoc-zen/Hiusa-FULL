<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Transaction;
use App\Models\User;
use App\Services\OrganizationDeletionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CollegeOrganizationLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private User $sao;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
        Storage::fake('uploads');
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]);
        Sanctum::actingAs($this->sao);
    }

    private function college(): College
    {
        $id = $this->postJson('/api/system/colleges', ['name' => 'College of Computing'])->assertCreated()->json('id');

        return College::findOrFail($id);
    }

    private function organization(College $college): Organization
    {
        return Organization::factory()->create(['college_id' => $college->id, 'college' => $college->name, 'parent_organization_id' => $college->homeOrganization->id]);
    }

    private function submission(Organization $organization, User $user, string $path): OrganizationComplianceSubmission
    {
        $type = ComplianceRequirementType::create(['name' => 'Registration document '.basename($path), 'academic_year' => '2026-2027', 'deadline_at' => now()->addMonth(), 'created_by' => $this->sao->school_id, 'is_active' => true]);
        Storage::disk('local')->put($path, 'private document');

        return OrganizationComplianceSubmission::create(['organization_id' => $organization->id, 'requirement_type_id' => $type->id, 'status' => 'submitted', 'file_path' => $path, 'file_original_name' => 'document.pdf', 'mime_type' => 'application/pdf', 'file_size' => 16, 'submitted_by' => $user->school_id, 'submitted_at' => now()]);
    }

    public function test_archive_blocks_login_and_existing_sessions_but_sao_keeps_file_access(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $user = User::factory()->admin()->create(['organization_id' => $organization->id, 'password_hash' => 'secret123']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $college->homeOrganization->id, 'password_hash' => 'secret123']);
        $file = $this->submission($organization, $user, "compliance-submissions/{$organization->id}/test.pdf");
        $user->createToken('session');
        $head->createToken('session');
        $this->postJson('/api/system/colleges/'.$college->id.'/archive')->assertOk()->assertJsonPath('is_active', false);
        $this->assertSame(0, $user->tokens()->count());
        $this->assertSame(0, $head->tokens()->count());
        $this->assertTrue($organization->fresh()->is_active);
        $this->getJson('/api/compliance/submissions/'.$file->id.'/document')->assertOk();
        foreach ([$user, $head] as $account) {
            $this->postJson('/api/login', ['school_id' => $account->school_id, 'password' => 'secret123'])->assertForbidden();
        }
        Sanctum::actingAs($user);
        $this->getJson('/api/user')->assertForbidden();
        Sanctum::actingAs($this->sao);
        $this->postJson('/api/system/colleges/'.$college->id.'/archive')->assertConflict();
        $this->postJson('/api/system/colleges/'.$college->id.'/restore')->assertOk()->assertJsonPath('is_active', true);
        $this->postJson('/api/login', ['school_id' => $user->school_id, 'password' => 'secret123'])->assertOk();
    }

    public function test_restoring_college_keeps_individually_archived_organizations_archived(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $organization->update(['is_active' => false, 'lifecycle_status' => 'archived']);
        $this->postJson('/api/system/colleges/'.$college->id.'/archive')->assertOk();
        $this->postJson('/api/system/colleges/'.$college->id.'/restore')->assertOk();
        $this->assertFalse($organization->fresh()->is_active);
        $this->assertSame('archived', $organization->fresh()->lifecycle_status);
    }

    public function test_permanent_college_delete_requires_exact_name_and_removes_records_and_files(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $submission = $this->submission($organization, $user, "compliance-submissions/{$organization->id}/delete.pdf");
        $application = OrganizationApplication::create(['college_id' => $college->id, 'name' => 'New Applicant Organization', 'acronym' => 'NAO', 'school_id' => 987001, 'first_name' => 'Applicant', 'last_name' => 'Student', 'email' => 'applicant@example.test', 'position_title' => 'President']);
        $application->documents()->create(['requirement_type_id' => $submission->requirement_type_id, 'file_path' => 'organization-applications/delete.pdf', 'file_original_name' => 'application.pdf', 'mime_type' => 'application/pdf', 'file_size' => 4]);
        Storage::disk('local')->put('organization-applications/delete.pdf', 'file');
        $event = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->school_id]);
        $college->update(['logo_url' => '/storage/college-logos/delete.png']);
        Storage::disk('public')->put('college-logos/delete.png', 'logo');
        $user->createToken('session');
        $url = '/api/system/colleges/'.$college->id;
        $this->deleteJson($url, ['mode' => 'permanent', 'confirmation_name' => 'wrong'])->assertUnprocessable()->assertJsonValidationErrors('confirmation_name');
        Storage::disk('local')->assertExists("compliance-submissions/{$organization->id}/delete.pdf");
        $this->deleteJson($url, ['mode' => 'permanent', 'confirmation_name' => $college->name])->assertNoContent();
        $this->assertDatabaseMissing('colleges', ['id' => $college->id]);
        $this->assertDatabaseMissing('organizations', ['id' => $organization->id]);
        $this->assertDatabaseMissing('users', ['school_id' => $user->school_id]);
        $this->assertDatabaseMissing('events', ['id' => $event->id]);
        $this->assertDatabaseMissing('organization_applications', ['id' => $application->id]);
        Storage::disk('local')->assertMissing('organization-applications/delete.pdf');
        Storage::disk('local')->assertMissing("compliance-submissions/{$organization->id}/delete.pdf");
        Storage::disk('public')->assertMissing('college-logos/delete.png');
        $this->assertDatabaseCount('pending_file_deletions', 0);
        $this->assertDatabaseHas('audit_logs', ['action' => 'college_permanently_deleted', 'user_id' => $this->sao->school_id]);
    }

    public function test_organization_delete_keeps_other_colleges_shared_profiles_and_files(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $other = Organization::factory()->create();
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        AccountProfile::create(['user_school_id' => $user->school_id, 'organization_id' => $other->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $this->submission($organization, $user, "compliance-submissions/{$organization->id}/target.pdf");
        $otherFile = $this->submission($other, $user, "compliance-submissions/{$other->id}/other.pdf");
        $organization->update(['logo_url' => '/storage/logos/shared.png']);
        $other->update(['logo_url' => '/storage/logos/shared.png']);
        Storage::disk('public')->put('logos/shared.png', 'shared');
        $this->deleteJson('/api/system/organizations/'.$organization->id, ['confirmation_name' => $organization->name])->assertNoContent();
        $this->assertDatabaseHas('colleges', ['id' => $college->id]);
        $this->assertDatabaseHas('organizations', ['id' => $other->id]);
        $this->assertSame($other->id, $user->fresh()->organization_id);
        $this->assertSame('STUDENT', $user->fresh()->role);
        $this->assertDatabaseHas('organization_compliance_submissions', ['id' => $otherFile->id]);
        Storage::disk('local')->assertMissing("compliance-submissions/{$organization->id}/target.pdf");
        Storage::disk('local')->assertExists("compliance-submissions/{$other->id}/other.pdf");
        Storage::disk('public')->assertExists('logos/shared.png');
    }

    public function test_only_sao_can_archive_restore_or_permanently_delete_and_system_department_is_protected(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $this->deleteJson('/api/system/organizations/'.$this->sao->organization_id, ['confirmation_name' => 'Student Affairs Office'])->assertNotFound();
        foreach (['ADMIN', 'STUDENT', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role' => $role, 'organization_id' => $organization->id]));
            $this->postJson('/api/system/colleges/'.$college->id.'/archive')->assertForbidden();
            $this->postJson('/api/system/colleges/'.$college->id.'/restore')->assertForbidden();
            $this->deleteJson('/api/system/colleges/'.$college->id, ['mode' => 'permanent', 'confirmation_name' => $college->name])->assertForbidden();
            $this->deleteJson('/api/system/organizations/'.$organization->id, ['confirmation_name' => $organization->name])->assertForbidden();
        }
    }

    public function test_suborganizations_block_parent_delete_without_removing_files(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        Organization::factory()->create(['parent_organization_id' => $organization->id]);
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->submission($organization, $user, "compliance-submissions/{$organization->id}/keep.pdf");
        $this->deleteJson('/api/system/organizations/'.$organization->id, ['confirmation_name' => $organization->name])->assertConflict();
        Storage::disk('local')->assertExists("compliance-submissions/{$organization->id}/keep.pdf");
        $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
        $this->assertSame(0, DB::table('pending_file_deletions')->count());
    }

    public function test_archived_college_profiles_are_unavailable_for_switching_and_public_listing(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $other = Organization::factory()->create();
        $user = User::factory()->student()->create(['organization_id' => $other->id]);
        $profile = AccountProfile::create(['user_school_id' => $user->school_id, 'organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $this->postJson('/api/system/colleges/'.$college->id.'/archive')->assertOk();
        Sanctum::actingAs($user);
        $this->postJson('/api/user/profiles/'.$profile->id.'/switch')->assertNotFound();
        $profiles = $this->getJson('/api/user/profiles')->assertOk()->json('profiles');
        $archived = collect($profiles)->firstWhere('id', $profile->id);
        $this->assertFalse($archived['organization']['college_is_active']);
        $this->getJson('/api/organizations')->assertOk()->assertJsonMissing(['id' => $organization->id]);
    }

    public function test_external_restricted_records_roll_back_the_entire_delete_and_keep_files(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $file = $this->submission($organization, $user, "compliance-submissions/{$organization->id}/rollback.pdf");
        $other = Organization::factory()->create();
        $transaction = Transaction::factory()->create(['organization_id' => $other->id, 'recorded_by' => $user->school_id, 'budget_id' => null]);
        $this->deleteJson('/api/system/colleges/'.$college->id, ['mode' => 'permanent', 'confirmation_name' => $college->name])->assertConflict();
        $this->assertDatabaseHas('users', ['school_id' => $user->school_id]);
        $this->assertDatabaseHas('organization_compliance_submissions', ['id' => $file->id]);
        $this->assertDatabaseHas('transactions', ['id' => $transaction->id]);
        Storage::disk('local')->assertExists($file->file_path);
        $this->assertDatabaseCount('pending_file_deletions', 0);
    }

    public function test_file_cleanup_is_durable_and_can_be_retried_after_database_deletion(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $file = $this->submission($organization, $user, "compliance-submissions/{$organization->id}/retry.pdf");
        $this->app->instance(OrganizationDeletionService::class, new class extends OrganizationDeletionService
        {
            public function cleanup(?array $ids = null): void {}
        });
        $this->deleteJson('/api/system/organizations/'.$organization->id, ['confirmation_name' => $organization->name])->assertNoContent();
        $this->assertDatabaseMissing('organizations', ['id' => $organization->id]);
        Storage::disk('local')->assertExists($file->file_path);
        $this->assertDatabaseHas('pending_file_deletions', ['disk' => 'local', 'path' => $file->file_path]);
        (new OrganizationDeletionService)->cleanup();
        Storage::disk('local')->assertMissing($file->file_path);
        $this->assertDatabaseCount('pending_file_deletions', 0);
    }

    public function test_private_payment_proofs_and_owned_ledger_rows_are_removed(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $product = Merchandise::factory()->create(['organization_id' => $organization->id]);
        $order = Order::factory()->create(['organization_id' => $organization->id, 'student_id' => $user->school_id, 'merchandise_id' => $product->id, 'processed_by' => null, 'approved_by' => null, 'payment_proof_url' => 'payment-proofs/delete.png']);
        Storage::disk('local')->put('payment-proofs/delete.png', 'proof');
        $transaction = Transaction::factory()->create(['organization_id' => $organization->id, 'recorded_by' => $user->school_id, 'budget_id' => null]);
        $this->deleteJson('/api/system/organizations/'.$organization->id, ['confirmation_name' => $organization->name])->assertNoContent();
        $this->assertDatabaseMissing('orders', ['id' => $order->id]);
        $this->assertDatabaseMissing('transactions', ['id' => $transaction->id]);
        Storage::disk('local')->assertMissing('payment-proofs/delete.png');
    }

    public function test_legacy_uploads_are_removed_but_shared_external_and_unsafe_paths_are_preserved(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $product = Merchandise::factory()->create(['organization_id' => $organization->id, 'image_url' => '/uploads/merchandise/delete.png']);
        Order::factory()->create(['organization_id' => $organization->id, 'student_id' => $user->school_id,
            'merchandise_id' => $product->id, 'processed_by' => null, 'approved_by' => null, 'payment_proof_url' => '/uploads/payments/delete.png']);
        $other = Organization::factory()->create();
        Merchandise::factory()->create(['organization_id' => $organization->id, 'image_url' => '/uploads/merchandise/shared.png']);
        Merchandise::factory()->create(['organization_id' => $other->id, 'image_url' => '/uploads/merchandise/shared.png']);
        Merchandise::factory()->create(['organization_id' => $organization->id, 'image_url' => 'https://outside.example/storage/merchandise/external.png']);
        Merchandise::factory()->create(['organization_id' => $organization->id, 'image_url' => '/uploads/../keep.txt']);
        foreach (['merchandise/delete.png', 'payments/delete.png', 'merchandise/shared.png', 'keep.txt'] as $path) {
            Storage::disk('uploads')->put($path, 'image');
        }
        Storage::disk('public')->put('merchandise/external.png', 'keep');

        $this->deleteJson('/api/system/organizations/'.$organization->id, ['confirmation_name' => $organization->name])->assertNoContent();

        Storage::disk('uploads')->assertMissing('merchandise/delete.png');
        Storage::disk('uploads')->assertMissing('payments/delete.png');
        Storage::disk('uploads')->assertExists('merchandise/shared.png');
        Storage::disk('uploads')->assertExists('keep.txt');
        Storage::disk('public')->assertExists('merchandise/external.png');
        $this->assertDatabaseCount('pending_file_deletions', 0);
    }

    public function test_missing_confirmation_invalid_modes_and_unauthenticated_deletes_are_rejected(): void
    {
        $college = $this->college();
        $organization = $this->organization($college);
        $this->deleteJson('/api/system/colleges/'.$college->id, ['mode' => 'permanent'])->assertUnprocessable()->assertJsonValidationErrors('confirmation_name');
        $this->deleteJson('/api/system/colleges/'.$college->id, ['mode' => 'invalid'])->assertUnprocessable()->assertJsonValidationErrors('mode');
        $this->deleteJson('/api/system/organizations/'.$organization->id)->assertUnprocessable()->assertJsonValidationErrors('confirmation_name');
        $this->deleteJson('/api/system/organizations/'.$organization->id, ['confirmation_name' => [$organization->name]])->assertUnprocessable()->assertJsonValidationErrors('confirmation_name');
        $this->app['auth']->forgetGuards();
        $this->deleteJson('/api/system/organizations/'.$organization->id, ['confirmation_name' => $organization->name])->assertUnauthorized();
        $this->postJson('/api/system/colleges/'.$college->id.'/archive')->assertUnauthorized();
        $this->assertDatabaseHas('organizations', ['id' => $organization->id]);
    }

    public function test_legacy_college_name_assignments_are_also_blocked_when_archived(): void
    {
        $college = $this->college();
        $organization = Organization::factory()->create(['college_id' => null, 'college' => $college->name]);
        $user = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->postJson('/api/system/colleges/'.$college->id.'/archive')->assertOk();
        $this->postJson('/api/login', ['school_id' => $user->school_id, 'password' => 'password'])->assertForbidden();
        $this->getJson('/api/organizations')->assertOk()->assertJsonMissing(['id' => $organization->id]);
        $this->getJson('/api/system/organizations')->assertOk()->assertJsonFragment(['college_is_active' => false]);
    }
}
