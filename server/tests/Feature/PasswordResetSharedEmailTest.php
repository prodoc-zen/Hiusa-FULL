<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class PasswordResetSharedEmailTest extends TestCase
{
    use RefreshDatabase;

    public function test_one_email_in_two_organizations_keeps_a_separate_reset_token_for_each(): void
    {
        Mail::fake();
        config(['app.frontend_url' => 'https://hiusa.example.test']);

        $orgA = Organization::factory()->create(['is_active' => true]);
        $orgB = Organization::factory()->create(['is_active' => true]);
        $userA = User::factory()->create(['organization_id' => $orgA->id, 'email' => 'shared@example.edu', 'account_status' => 'active']);
        $userB = User::factory()->create(['organization_id' => $orgB->id, 'email' => 'shared@example.edu', 'account_status' => 'active']);

        foreach ([$orgA, $orgB] as $org) {
            $this->postJson('/api/password/forgot', ['organization_id' => $org->id, 'email' => 'shared@example.edu'])
                ->assertOk()
                ->assertJsonStructure(['message']);
        }

        $this->assertDatabaseCount('password_reset_tokens', 2);
        $this->assertDatabaseHas('password_reset_tokens', ['organization_id' => $orgA->id, 'email' => 'shared@example.edu']);
        $this->assertDatabaseHas('password_reset_tokens', ['organization_id' => $orgB->id, 'email' => 'shared@example.edu']);

        $tokens = [];
        Mail::assertQueued(PasswordResetMail::class, function (PasswordResetMail $mail) use (&$tokens) {
            parse_str((string) parse_url($mail->resetUrl, PHP_URL_QUERY), $query);
            $tokens[(int) $query['organization_id']] = $query['token'];

            return true;
        });
        $this->assertCount(2, $tokens);

        $this->postJson('/api/password/reset', [
            'organization_id' => $orgA->id,
            'email' => 'shared@example.edu',
            'token' => $tokens[$orgA->id],
            'password' => 'new-password',
            'password_confirmation' => 'new-password',
        ])->assertOk();

        $this->assertDatabaseMissing('password_reset_tokens', ['organization_id' => $orgA->id, 'email' => 'shared@example.edu']);
        $this->assertDatabaseHas('password_reset_tokens', ['organization_id' => $orgB->id, 'email' => 'shared@example.edu']);
        $this->assertDatabaseCount('password_reset_tokens', 1);

        $this->postJson('/api/password/reset/validate', [
            'organization_id' => $orgB->id,
            'email' => 'shared@example.edu',
            'token' => $tokens[$orgB->id],
        ])->assertOk();

        $this->postJson('/api/password/reset', [
            'organization_id' => $orgB->id,
            'email' => 'shared@example.edu',
            'token' => $tokens[$orgB->id],
            'password' => 'other-password',
            'password_confirmation' => 'other-password',
        ])->assertOk();

        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_a_second_request_for_the_same_account_replaces_its_own_token_only(): void
    {
        Mail::fake();

        $orgA = Organization::factory()->create(['is_active' => true]);
        $orgB = Organization::factory()->create(['is_active' => true]);
        User::factory()->create(['organization_id' => $orgA->id, 'email' => 'shared@example.edu', 'account_status' => 'active']);
        User::factory()->create(['organization_id' => $orgB->id, 'email' => 'shared@example.edu', 'account_status' => 'active']);

        foreach ([$orgA->id, $orgB->id, $orgA->id] as $organizationId) {
            $this->postJson('/api/password/forgot', ['organization_id' => $organizationId, 'email' => 'shared@example.edu'])->assertOk();
        }

        $this->assertDatabaseCount('password_reset_tokens', 2);
    }
}
