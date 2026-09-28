<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserPhotoTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_uploads_scoped_student_photo_and_replaces_old_file(): void
    {
        Storage::fake('public');
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);
        $image = fn () => UploadedFile::fake()->createWithContent('avatar.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlS4WQAAAAASUVORK5CYII='));

        $this->post("/api/users/{$student->school_id}/photo", ['photo' => $image()], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonStructure(['photo_url']);
        $oldPath = $student->fresh()->photo_path;
        Storage::disk('public')->assertExists($oldPath);
        $this->post("/api/users/{$student->school_id}/photo", ['photo' => $image()], ['Accept' => 'application/json'])->assertOk();
        Storage::disk('public')->assertMissing($oldPath);
        Storage::disk('public')->assertExists($student->fresh()->photo_path);
        $this->getJson('/api/users')->assertOk()->assertJsonFragment(['photo_url' => $student->fresh()->photo_url]);
    }

    public function test_photo_upload_rejects_cross_organization_and_non_admin(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $otherStudent = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($admin);
        $this->postJson("/api/users/{$otherStudent->school_id}/photo", [])->assertNotFound();
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id]));
        $this->postJson("/api/users/{$otherStudent->school_id}/photo", [])->assertForbidden();
    }
}
