<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use App\Services\Edp\HttpStudentRegistry;
use App\Services\Edp\StudentRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class StudentRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private College $college;

    private Organization $home;

    private StudentRegistryEntry $record;

    protected function setUp(): void
    {
        parent::setUp();

        $this->college = College::create(['name' => 'College of Information Technology', 'code' => 'CIT', 'is_active' => true]);
        $this->home = Organization::create([
            'name' => 'College of Information Technology', 'slug' => 'college-of-information-technology', 'acronym' => 'CIT',
            'college' => 'College of Information Technology', 'college_id' => $this->college->id,
            'organization_type' => 'COLLEGE', 'is_active' => true, 'lifecycle_status' => 'active',
        ]);
        $this->record = StudentRegistryEntry::create([
            'school_id' => 2600101, 'first_name' => 'Hannah', 'last_name' => 'Reyes', 'birth_date' => '2007-03-14',
            'college_id' => $this->college->id, 'program' => 'BS Information Technology', 'year_level' => '1st Year', 'section' => 'A',
        ]);
    }

    private function payload(array $overrides = []): array
    {
        return [
            'school_id' => 2600101, 'birth_date' => '2007-03-14', 'email' => 'Hannah.Reyes@example.edu',
            'password' => 'a-long-passphrase', 'password_confirmation' => 'a-long-passphrase', ...$overrides,
        ];
    }

    public function test_a_matching_school_id_and_birth_date_creates_the_account_on_the_college_home_organization(): void
    {
        $response = $this->postJson('/api/register', $this->payload())
            ->assertCreated()
            ->assertJsonPath('user.role', 'STUDENT')
            ->assertJsonPath('user.must_change_password', false)
            ->assertJsonStructure(['access_token', 'token_type', 'session_expires_in_seconds']);

        $user = User::findOrFail(2600101);
        $this->assertSame($this->home->id, $user->organization_id);
        $this->assertSame('hannah.reyes@example.edu', $user->email);
        $this->assertSame('College of Information Technology', $user->department);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 2600101, 'organization_id' => $this->home->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $this->assertNotNull($this->record->fresh()->claimed_at);
        $this->assertTrue(Hash::check('a-long-passphrase', $user->password_hash));

        $this->withToken($response->json('access_token'))->getJson('/api/user')->assertOk()->assertJsonPath('school_id', 2600101);
    }

    public function test_names_program_year_and_section_come_from_the_record_never_from_the_client(): void
    {
        $this->postJson('/api/register', $this->payload([
            'first_name' => 'Mallory', 'last_name' => 'Hacker', 'program' => 'BS Nursing', 'year_level' => '4th Year', 'section' => 'Z',
            'role' => 'SUPER_ADMIN', 'organization_id' => Organization::factory()->create()->id,
        ]))->assertCreated();

        $user = User::findOrFail(2600101);
        $this->assertSame(['Hannah', 'Reyes', 'BS Information Technology', '1st Year', 'A', 'STUDENT'], [
            $user->first_name, $user->last_name, $user->program, $user->year_level, $user->section, $user->role,
        ]);
        $this->assertSame($this->home->id, $user->organization_id);
    }

    public function test_a_wrong_birth_date_is_refused_with_the_generic_message(): void
    {
        $this->postJson('/api/register', $this->payload(['birth_date' => '2007-03-15']))
            ->assertUnprocessable()
            ->assertJsonPath('errors.school_id.0', "We couldn't match that school ID and birth date with the school records.");

        $this->assertDatabaseMissing('users', ['school_id' => 2600101]);
        $this->assertNull($this->record->fresh()->claimed_at);
    }

    public function test_an_unknown_school_id_gets_the_same_message_as_a_wrong_birth_date(): void
    {
        $this->postJson('/api/register', $this->payload(['school_id' => 2699999]))
            ->assertUnprocessable()
            ->assertJsonPath('errors.school_id.0', "We couldn't match that school ID and birth date with the school records.");
    }

    public function test_a_record_cannot_be_claimed_twice(): void
    {
        $this->postJson('/api/register', $this->payload())->assertCreated();

        $this->postJson('/api/register', $this->payload(['email' => 'someone.else@example.edu']))
            ->assertUnprocessable()
            ->assertJsonPath('errors.school_id.0', 'This school ID already has an account. Sign in, or reset your password.');

        $this->assertSame(1, User::where('school_id', 2600101)->count());
    }

    public function test_a_taken_email_is_refused(): void
    {
        User::factory()->student()->create(['organization_id' => $this->home->id, 'email' => 'hannah.reyes@example.edu']);

        $this->postJson('/api/register', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertNull($this->record->fresh()->claimed_at);
    }

    public function test_sign_up_requires_a_birth_date_and_a_confirmed_password(): void
    {
        $this->postJson('/api/register', ['school_id' => 2600101, 'email' => 'h@example.edu', 'password' => 'a-long-passphrase'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['birth_date', 'password']);
    }

    public function test_lookup_returns_the_record_for_the_confirm_step_without_the_birth_date(): void
    {
        $this->postJson('/api/register/lookup', ['school_id' => 2600101, 'birth_date' => '2007-03-14'])
            ->assertOk()
            ->assertExactJson([
                'name' => 'Hannah Reyes', 'college' => 'College of Information Technology', 'program' => 'BS Information Technology',
                'year_level' => '1st Year', 'section' => 'A',
            ]);

        $this->assertNull($this->record->fresh()->claimed_at);
    }

    public function test_lookup_refuses_a_mismatch_and_a_claimed_record(): void
    {
        $this->postJson('/api/register/lookup', ['school_id' => 2600101, 'birth_date' => '2000-01-01'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.school_id.0', "We couldn't match that school ID and birth date with the school records.");

        $this->postJson('/api/register', $this->payload())->assertCreated();
        $this->postJson('/api/register/lookup', ['school_id' => 2600101, 'birth_date' => '2007-03-14'])
            ->assertUnprocessable()->assertJsonPath('errors.school_id.0', 'This school ID already has an account. Sign in, or reset your password.');
    }

    public function test_repeated_wrong_birth_dates_lock_that_school_id_for_a_while(): void
    {
        RateLimiter::clear('signup-failures:2600101');

        foreach (range(1, 5) as $_) {
            $this->postJson('/api/register/lookup', ['school_id' => 2600101, 'birth_date' => '2000-01-01'])->assertUnprocessable();
        }

        $this->postJson('/api/register/lookup', ['school_id' => 2600101, 'birth_date' => '2007-03-14'])->assertStatus(429);
        $this->postJson('/api/register', $this->payload())->assertStatus(429);
        $this->assertDatabaseMissing('users', ['school_id' => 2600101]);
    }

    public function test_sign_up_fails_closed_when_the_school_records_are_unreachable(): void
    {
        $this->app->instance(StudentRegistry::class, new HttpStudentRegistry);

        $this->postJson('/api/register', $this->payload())->assertStatus(503);
        $this->assertDatabaseMissing('users', ['school_id' => 2600101]);
    }

    public function test_sign_up_is_refused_when_the_college_is_archived_or_has_no_home_organization(): void
    {
        $this->college->update(['is_active' => false]);
        $this->postJson('/api/register', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('school_id');

        $this->college->update(['is_active' => true]);
        $this->home->update(['is_active' => false]);
        $this->postJson('/api/register', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('school_id');

        $this->assertNull($this->record->fresh()->claimed_at);
    }

    public function test_a_new_student_can_sign_in_with_email_or_school_id(): void
    {
        $this->postJson('/api/register', $this->payload())->assertCreated();

        $this->postJson('/api/login', ['identifier' => 'hannah.reyes@example.edu', 'password' => 'a-long-passphrase'])->assertOk();
        $this->postJson('/api/login', ['identifier' => '2600101', 'password' => 'a-long-passphrase'])->assertOk();
    }

    public function test_a_student_on_the_college_home_organization_gets_no_department_head_scope_or_routes(): void
    {
        $this->postJson('/api/register', $this->payload())->assertCreated();
        $student = User::findOrFail(2600101);
        $sibling = Organization::factory()->create(['college_id' => $this->college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);

        $this->assertSame([$this->home->id], $student->scopedOrganizationIds());
        $this->assertNotContains($sibling->id, $student->scopedOrganizationIds());

        foreach (['/api/college/overview', '/api/college/organizations', '/api/students/registry', '/api/system/colleges'] as $uri) {
            $this->actingAs($student)->getJson($uri)->assertForbidden();
        }
    }
}
