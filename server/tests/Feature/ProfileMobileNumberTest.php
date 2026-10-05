<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProfileMobileNumberTest extends TestCase
{
    use RefreshDatabase;

    public function test_student_can_add_and_clear_their_own_mobile_number(): void
    {
        $organization = Organization::factory()->create();
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']);
        $otherStudent = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']);
        Sanctum::actingAs($student);

        $this->putJson('/api/user/profile', ['contact_number' => '09171234567'])
            ->assertOk()->assertJsonPath('contact_number', '09171234567');
        $this->assertSame('09171234567', $student->fresh()->contact_number);
        $this->assertNotSame('09171234567', $otherStudent->fresh()->contact_number);

        $this->putJson('/api/user/profile', ['contact_number' => null])
            ->assertOk()->assertJsonPath('contact_number', null);
    }

    public function test_profile_rejects_an_invalid_mobile_number(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT']));

        $this->putJson('/api/user/profile', ['contact_number' => 'call me'])
            ->assertStatus(422)->assertJsonValidationErrors('contact_number');
    }
}
