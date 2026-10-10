<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SaoBrandingAndPositionsTest extends TestCase
{
    use RefreshDatabase;

    public function test_sao_can_upload_college_and_organization_logos_and_set_colors(): void
    {
        Storage::fake('public');
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $organization = Organization::factory()->create();
        $college = College::create(['name' => 'College of Computing', 'color' => '#123ABC', 'is_active' => true]);

        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $this->post('/api/system/organizations/'.$organization->id.'/logo', ['logo' => UploadedFile::fake()->image('org.png')])->assertForbidden();

        Sanctum::actingAs($director);
        $this->putJson('/api/system/organizations/'.$organization->id, ['color' => '#456DEF'])->assertOk()->assertJsonPath('color', '#456DEF');
        $this->post('/api/system/organizations/'.$organization->id.'/logo', ['logo' => UploadedFile::fake()->image('org.png')])->assertOk();
        $this->post('/api/system/colleges/'.$college->id.'/logo', ['logo' => UploadedFile::fake()->image('college.png')])->assertOk();
        $this->assertStringStartsWith('/storage/organization-logos/', $organization->fresh()->logo_url);
        $this->assertStringStartsWith('/storage/college-logos/', $college->fresh()->logo_url);
        Storage::disk('public')->assertExists(substr($organization->fresh()->logo_url, strlen('/storage/')));
        Storage::disk('public')->assertExists(substr($college->fresh()->logo_url, strlen('/storage/')));
        $this->withHeader('Accept', 'application/json')->post('/api/system/colleges/'.$college->id.'/logo', ['logo' => UploadedFile::fake()->create('bad.pdf', 10, 'application/pdf')])->assertUnprocessable();
    }

    public function test_sao_administrator_title_is_visible_in_organization_positions(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $organization = Organization::factory()->create();
        Sanctum::actingAs($director);

        $this->postJson('/api/system/admins', [
            'organization_id' => $organization->id,
            'school_id' => 87654321,
            'first_name' => 'Alex',
            'last_name' => 'Rivera',
            'email' => 'alex.rivera@example.test',
            'position_title' => 'President',
            'password' => 'ChangeMe123!',
            'password_confirmation' => 'ChangeMe123!',
        ])->assertCreated();

        $this->assertDatabaseHas('sbo_positions', ['organization_id' => $organization->id, 'role' => 'ADMIN', 'title' => 'President', 'is_active' => true]);

        $adviser = SboPosition::create(['organization_id' => $organization->id, 'role' => 'ADMIN', 'title' => 'Adviser', 'is_active' => true]);
        $admin = User::where('school_id', 87654321)->firstOrFail();
        $this->assertTrue($admin->must_change_password);
        $admin->update(['must_change_password' => false]);
        Sanctum::actingAs($admin);
        $this->getJson('/api/sbo-positions')->assertOk()->assertJsonFragment(['title' => 'Adviser']);
        $this->putJson('/api/sbo-positions/'.$adviser->id, ['description' => 'Changed'])->assertForbidden();
        $this->deleteJson('/api/sbo-positions/'.$adviser->id)->assertForbidden();
    }
}
