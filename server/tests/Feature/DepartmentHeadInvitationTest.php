<?php

namespace Tests\Feature;

use App\Mail\DeanInvitationMail;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class DepartmentHeadInvitationTest extends TestCase
{
    use RefreshDatabase;

    private User $sao;
    private College $college;
    private Organization $home;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();

        $saoOrg = Organization::firstOrCreate(
            ['acronym' => 'SAO'],
            ['name' => 'Student Affairs Office', 'slug' => 'student-affairs-office', 'organization_type' => 'UNIVERSITY', 'is_active' => true, 'lifecycle_status' => 'active']
        );

        $this->sao = User::create([
            'school_id' => 10000001,
            'organization_id' => $saoOrg->id,
            'first_name' => 'SAO',
            'last_name' => 'Director',
            'email' => 'sao@example.edu',
            'password_hash' => Hash::make('Demo@12345'),
            'role' => 'SUPER_ADMIN',
            'account_status' => 'active',
            'is_member' => true,
        ]);

        $this->college = College::create([
            'name' => 'College of Information Technology',
            'code' => 'CIT',
            'is_active' => true,
        ]);

        $this->home = Organization::create([
            'name' => 'College of Information Technology',
            'slug' => 'college-of-information-technology',
            'acronym' => 'CIT',
            'college' => 'College of Information Technology',
            'college_id' => $this->college->id,
            'organization_type' => 'COLLEGE',
            'is_active' => true,
            'lifecycle_status' => 'active',
        ]);
    }

    public function test_sao_can_generate_magic_link_invitation_and_sends_email(): void
    {
        $response = $this->actingAs($this->sao)->postJson("/api/system/colleges/{$this->college->id}/invite-department-head", [
            'first_name' => 'Arthur',
            'last_name' => 'Dent',
            'email' => 'arthur.dent@example.edu',
            'school_id' => 20261111,
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure([
            'message',
            'invitation' => ['id', 'first_name', 'last_name', 'email', 'school_id'],
            'magic_link',
        ]);

        $this->assertStringContainsString('/accept-invitation?token=', $response->json('magic_link'));

        $this->assertDatabaseHas('department_head_invitations', [
            'college_id' => $this->college->id,
            'email' => 'arthur.dent@example.edu',
            'school_id' => 20261111,
        ]);

        Mail::assertQueued(DeanInvitationMail::class, function ($mail) {
            return $mail->hasTo('arthur.dent@example.edu')
                && str_contains($mail->collegeName, 'College of Information Technology')
                && str_contains($mail->magicLink, '/accept-invitation?token=');
        });
    }

    public function test_public_can_view_invitation_details_via_token(): void
    {
        $token = Str::random(64);
        DepartmentHeadInvitation::create([
            'college_id' => $this->college->id,
            'first_name' => 'Elena',
            'last_name' => 'Reyes',
            'email' => 'elena@example.edu',
            'school_id' => 20262222,
            'token_hash' => hash('sha256', $token),
            'invited_by' => $this->sao->school_id,
            'expires_at' => now()->addHours(48),
        ]);

        $response = $this->getJson("/api/department-head-invitations/{$token}");
        $response->assertStatus(200);
        $response->assertJson([
            'invitation' => [
                'first_name' => 'Elena',
                'last_name' => 'Reyes',
                'email' => 'elena@example.edu',
                'school_id' => 20262222,
            ],
            'college' => [
                'id' => $this->college->id,
                'name' => 'College of Information Technology',
            ],
        ]);
    }

    public function test_dean_can_accept_invitation_and_get_authenticated(): void
    {
        $token = Str::random(64);
        $invitation = DepartmentHeadInvitation::create([
            'college_id' => $this->college->id,
            'first_name' => 'Marcus',
            'last_name' => 'Vance',
            'email' => 'marcus@example.edu',
            'school_id' => 20263333,
            'token_hash' => hash('sha256', $token),
            'invited_by' => $this->sao->school_id,
            'expires_at' => now()->addHours(48),
        ]);

        $response = $this->postJson("/api/department-head-invitations/{$token}/accept", [
            'password' => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure(['message', 'token', 'user']);
        $this->assertEquals('DEPARTMENT_HEAD', $response->json('user.role'));

        $this->assertDatabaseHas('users', [
            'school_id' => 20263333,
            'email' => 'marcus@example.edu',
            'role' => 'DEPARTMENT_HEAD',
            'organization_id' => $this->home->id,
        ]);

        $invitation->refresh();
        $this->assertNotNull($invitation->accepted_at);

        // Accepting a second time should fail with 410 Gone
        $retryResponse = $this->postJson("/api/department-head-invitations/{$token}/accept", [
            'password' => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
        ]);
        $retryResponse->assertStatus(410);
    }
}

