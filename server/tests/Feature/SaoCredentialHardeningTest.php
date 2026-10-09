<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class SaoCredentialHardeningTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private User $director;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        Sanctum::actingAs($this->director);
    }

    public function test_a_head_password_reset_is_limited_per_target_across_the_hour(): void
    {
        Mail::fake();
        config(['performance.rate_limits.password_per_minute' => 100]);
        $head = $this->makeCollegeHead($this->makeCollege('CCS'));
        $other = $this->makeCollegeHead($this->makeCollege('CBE'));

        for ($i = 0; $i < 3; $i++) {
            $this->postJson("/api/system/department-heads/{$head->school_id}/password-reset")->assertOk();
        }

        $this->postJson("/api/system/department-heads/{$head->school_id}/password-reset")
            ->assertTooManyRequests()
            ->assertJsonStructure(['message']);
        $this->postJson("/api/system/department-heads/{$other->school_id}/password-reset")->assertOk();
    }

    public function test_an_admin_password_reset_is_limited_per_target_too(): void
    {
        Mail::fake();
        config(['performance.rate_limits.password_per_minute' => 100]);
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        for ($i = 0; $i < 3; $i++) {
            $this->postJson("/api/system/admins/{$admin->school_id}/password-reset")->assertOk();
        }

        $this->postJson("/api/system/admins/{$admin->school_id}/password-reset")->assertTooManyRequests();
    }

    public function test_changing_a_heads_email_revokes_their_tokens_but_other_edits_do_not(): void
    {
        $head = $this->makeCollegeHead($this->makeCollege('CCS'));
        $head->createToken('auth_token');

        $this->putJson("/api/system/department-heads/{$head->school_id}", ['first_name' => 'Renamed'])->assertOk();
        $this->assertSame(1, $head->tokens()->count());

        $this->putJson("/api/system/department-heads/{$head->school_id}", ['email' => $head->email])->assertOk();
        $this->assertSame(1, $head->tokens()->count());

        $this->putJson("/api/system/department-heads/{$head->school_id}", ['email' => 'new.head@example.edu'])->assertOk();
        $this->assertSame(0, $head->tokens()->count());
    }

    public function test_changing_an_admins_email_revokes_their_tokens_but_other_edits_do_not(): void
    {
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $admin->createToken('auth_token');

        $this->putJson("/api/system/admins/{$admin->school_id}", ['first_name' => 'Renamed'])->assertOk();
        $this->assertSame(1, $admin->tokens()->count());

        $this->putJson("/api/system/admins/{$admin->school_id}", ['email' => 'new.admin@example.edu'])->assertOk();
        $this->assertSame(0, $admin->tokens()->count());
    }
}
