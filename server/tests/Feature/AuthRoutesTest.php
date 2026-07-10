<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthRoutesTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_without_explicit_role(): void
    {
        $organization = Organization::factory()->create();

        $response = $this->postJson('/api/register', [
            'organization_id' => $organization->id,
            'school_id' => 1001,
            'first_name' => 'Ada',
            'last_name' => 'Lovelace',
            'email' => 'ada@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('user.email', 'ada@example.com')
            ->assertJsonPath('user.role', 'student')
            ->assertJsonStructure(['access_token', 'token_type', 'user']);

        $this->assertDatabaseHas('users', [
            'school_id' => 1001,
            'email' => 'ada@example.com',
            'role' => 'student',
        ]);
    }

    public function test_user_can_login_and_access_authenticated_user_route(): void
    {
        $user = User::factory()->create([
            'email' => 'student@example.com',
            'password_hash' => 'password123',
        ]);

        $login = $this->postJson('/api/login', [
            'organization_id' => $user->organization_id,
            'email' => 'student@example.com',
            'password' => 'password123',
        ]);

        $login
            ->assertOk()
            ->assertJsonStructure(['access_token', 'token_type', 'user']);

        $this->withToken($login->json('access_token'))
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('email', 'student@example.com');
    }

    public function test_no_prefix_auth_aliases_accept_requests(): void
    {
        $user = User::factory()->create([
            'email' => 'alias@example.com',
            'password_hash' => 'password123',
        ]);

        $this->postJson('/login', [
            'organization_id' => $user->organization_id,
            'email' => 'alias@example.com',
            'password' => 'password123',
        ])
            ->assertOk()
            ->assertJsonStructure(['access_token', 'token_type', 'user']);
    }

    public function test_auth_routes_accept_cors_preflight_requests(): void
    {
        $this->withHeaders([
            'Origin' => 'http://localhost:5173',
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type',
        ])->options('/api/login')
            ->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173');

        $this->withHeaders([
            'Origin' => 'http://localhost:5173',
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type',
        ])->options('/login')
            ->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    }
}
