<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class MustChangePasswordFlaggingTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withHeaders(['Accept' => 'application/json']);
    }

    private function accountPayload(int $schoolId, array $overrides = []): array
    {
        return [
            'school_id' => $schoolId,
            'first_name' => 'Rae',
            'last_name' => 'Cruz',
            'email' => "rae{$schoolId}@example.test",
            'password' => 'Chosen-by-staff-1',
            'password_confirmation' => 'Chosen-by-staff-1',
            ...$overrides,
        ];
    }

    private function sao(): User
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);

        return User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
    }

    public function test_an_account_an_admin_creates_with_a_chosen_password_must_change_it(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));

        $this->postJson('/api/users', $this->accountPayload(88000001, ['role' => 'SBO_OFFICER']))
            ->assertCreated()
            ->assertJsonPath('must_change_password', true);

        $this->assertTrue((bool) User::find(88000001)->must_change_password);
    }

    public function test_a_roster_import_account_with_an_unknown_random_password_is_not_flagged(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $csv = "school_id,first_name,last_name,email,role\n88000002,Rae,Cruz,rae88000002@example.test,SBO Officer\n";

        $this->post('/api/users/import', ['file' => UploadedFile::fake()->createWithContent('roster.csv', $csv)])->assertCreated();

        $this->assertFalse((bool) User::find(88000002)->must_change_password);
    }

    public function test_an_admin_editing_other_fields_does_not_flag_the_member(): void
    {
        $organization = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));

        $this->putJson('/api/users/'.$student->school_id, ['first_name' => 'Renamed'])->assertOk();

        $this->assertFalse((bool) $student->fresh()->must_change_password);
    }

    public function test_sao_created_administrator_must_replace_the_staff_chosen_initial_password(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs($this->sao());

        $this->postJson('/api/system/admins', $this->accountPayload(88000003, ['organization_id' => $organization->id]))->assertCreated()->assertJsonPath('must_change_password', true);

        $this->assertTrue(User::findOrFail(88000003)->must_change_password);
    }

    public function test_sao_cannot_create_a_successor_account_at_handover(): void
    {
        $organization = Organization::factory()->create();
        $outgoing = User::factory()->admin()->create(['organization_id' => $organization->id, 'position_title' => 'President']);
        Sanctum::actingAs($this->sao());

        $this->postJson("/api/system/admins/{$outgoing->school_id}/handover", $this->accountPayload(88000004, ['mode' => 'new']))->assertForbidden();

        $this->assertNull(User::find(88000004));
    }

    public function test_a_department_head_who_registers_through_the_link_keeps_the_password_they_chose(): void
    {
        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        Sanctum::actingAs($this->sao());

        $link = $this->postJson("/api/system/colleges/{$college->id}/invite-department-head")->assertCreated()->json('magic_link');
        parse_str((string) parse_url($link, PHP_URL_QUERY), $query);
        app('auth')->forgetGuards();

        $this->postJson("/api/department-head-invitations/{$query['token']}/accept", [
            'first_name' => 'Ramon', 'last_name' => 'Castillo', 'email' => 'ramon@example.edu', 'school_id' => 88000005,
            'password' => 'Dean2026!Pass', 'password_confirmation' => 'Dean2026!Pass',
        ])->assertOk();

        $this->assertFalse((bool) User::find(88000005)->must_change_password);
    }
}
