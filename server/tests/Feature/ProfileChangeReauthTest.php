<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProfileChangeReauthTest extends TestCase
{
    use RefreshDatabase;

    private function signedInStudent(): User
    {
        $student = User::factory()->student()->create([
            'first_name' => 'Maria',
            'last_name' => 'Santos',
            'email' => 'maria@example.edu',
            'password_hash' => 'right-password',
        ]);
        Sanctum::actingAs($student);

        return $student;
    }

    public function test_changing_the_email_needs_the_current_password(): void
    {
        $student = $this->signedInStudent();

        $this->putJson('/api/user/profile', ['email' => 'someone-else@example.edu'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['current_password']);

        $this->putJson('/api/user/profile', ['email' => 'someone-else@example.edu', 'current_password' => 'wrong-password'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['current_password']);

        $this->assertSame('maria@example.edu', $student->fresh()->email);
    }

    public function test_changing_the_name_needs_the_current_password(): void
    {
        $student = $this->signedInStudent();

        $this->putJson('/api/user/profile', ['first_name' => 'Ana', 'last_name' => 'Reyes'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['current_password']);

        $this->assertSame('Maria', $student->fresh()->first_name);
        $this->assertSame('Santos', $student->fresh()->last_name);
    }

    public function test_the_right_password_lets_the_email_and_name_change(): void
    {
        $student = $this->signedInStudent();

        $this->putJson('/api/user/profile', [
            'first_name' => 'Ana',
            'last_name' => 'Reyes',
            'email' => 'ana@example.edu',
            'current_password' => 'right-password',
        ])->assertOk()->assertJsonPath('email', 'ana@example.edu');

        $fresh = $student->fresh();
        $this->assertSame('Ana', $fresh->first_name);
        $this->assertSame('ana@example.edu', $fresh->email);
    }

    public function test_sending_the_unchanged_name_and_email_does_not_need_the_password(): void
    {
        $this->signedInStudent();

        $this->putJson('/api/user/profile', [
            'first_name' => 'Maria',
            'last_name' => 'Santos',
            'email' => 'maria@example.edu',
            'contact_number' => '09171234567',
        ])->assertOk()->assertJsonPath('contact_number', '09171234567');
    }
}
