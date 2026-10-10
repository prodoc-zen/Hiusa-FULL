<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PasswordChangeEnforcementTest extends TestCase
{
    use RefreshDatabase;

    private const REQUIRED = ['message' => 'You must change your password before continuing.', 'error_code' => 'PASSWORD_CHANGE_REQUIRED'];

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withHeaders(['Accept' => 'application/json']);
        $this->organization = Organization::factory()->create(['college' => 'College of Computer Studies']);
    }

    private function importStudent(string $schoolId = '87654321'): User
    {
        $admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($admin);
        $this->postJson('/api/academic-structure/programs', ['name' => 'BSIT', 'duration_years' => 4, 'sections' => ['1' => 1, '2' => 0, '3' => 0, '4' => 0]])->assertCreated();
        $csv = "school_id,first_name,last_name,email,program,year_level,section\n{$schoolId},New,Student,new.student@example.test,BSIT,1,1-A\n";
        $file = fn () => UploadedFile::fake()->createWithContent('students.csv', $csv);
        $preview = $this->post('/api/academic-structure/class-list/preview', ['file' => $file()])->assertOk();
        $this->post('/api/academic-structure/class-list/apply', ['file' => $file(), 'hash' => $preview->json('hash'), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1])
            ->assertOk()->assertJsonPath('created', 1);
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withHeaders(['Accept' => 'application/json']);

        return User::findOrFail((int) $schoolId);
    }

    private function signIn(string $schoolId, string $password): string
    {
        $response = $this->postJson('/api/login', ['school_id' => $schoolId, 'password' => $password])->assertOk();
        $this->app['auth']->forgetGuards();

        return $response->json('access_token');
    }

    private function as(string $token): static
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withHeaders(['Accept' => 'application/json'])->withToken($token);
    }

    public function test_an_imported_student_signs_in_with_the_default_password_flagged_to_change_it(): void
    {
        $this->importStudent();

        $this->assertTrue((bool) User::find(87654321)->must_change_password);
        $this->postJson('/api/login', ['school_id' => '87654321', 'password' => '4321-uclm'])
            ->assertOk()
            ->assertJsonPath('user.must_change_password', true)
            ->assertJsonStructure(['access_token', 'token_type']);
    }

    public function test_the_flag_is_on_the_current_user_payload(): void
    {
        $this->importStudent();
        $token = $this->signIn('87654321', '4321-uclm');

        $this->as($token)->getJson('/api/user')->assertOk()->assertJsonPath('must_change_password', true);
    }

    public function test_every_authenticated_route_but_the_allowlist_is_refused_while_the_password_is_unchanged(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'must_change_password' => true]);
        $token = $student->createToken('auth_token')->plainTextToken;
        $this->withoutMiddleware(ThrottleRequests::class);

        $allowed = ['GET api/user', 'PUT api/user/password', 'POST api/logout'];
        $checked = 0;
        foreach (Route::getRoutes() as $route) {
            if (! in_array('auth:sanctum', $route->gatherMiddleware(), true)) {
                continue;
            }
            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                if (in_array($method.' '.$route->uri(), $allowed, true)) {
                    continue;
                }
                $uri = '/'.preg_replace('/\{[^}]+\??\}/', '1', $route->uri());
                $response = $this->as($token)->json($method, $uri);
                $this->assertSame(403, $response->status(), $method.' '.$uri.' returned '.$response->status());
                $response->assertExactJson(self::REQUIRED);
                $checked++;
            }
        }

        $this->assertGreaterThan(150, $checked);
    }

    public function test_a_flagged_user_can_read_their_account_change_the_password_and_sign_out_only(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'must_change_password' => true]);
        $token = $student->createToken('auth_token')->plainTextToken;

        $this->as($token)->getJson('/api/user')->assertOk();
        $this->as($token)->putJson('/api/user/password', [])->assertUnprocessable();
        $this->as($token)->getJson('/api/events')->assertForbidden()->assertJsonPath('error_code', 'PASSWORD_CHANGE_REQUIRED');
        $this->as($token)->postJson('/api/logout')->assertOk();
    }

    public function test_changing_the_password_clears_the_flag_and_unlocks_every_route(): void
    {
        $this->importStudent();
        $token = $this->signIn('87654321', '4321-uclm');
        $this->as($token)->getJson('/api/events')->assertForbidden();

        $this->as($token)->putJson('/api/user/password', [
            'current_password' => '4321-uclm',
            'password' => 'my-own-secret',
            'password_confirmation' => 'my-own-secret',
        ])->assertOk();

        $user = User::find(87654321);
        $this->assertFalse((bool) $user->must_change_password);
        $this->assertTrue(Hash::check('my-own-secret', $user->password_hash));
        $this->as($token)->getJson('/api/user')->assertOk()->assertJsonPath('must_change_password', false);
        $this->as($token)->getJson('/api/events')->assertOk();
        $this->postJson('/api/login', ['school_id' => '87654321', 'password' => 'my-own-secret'])
            ->assertOk()->assertJsonPath('user.must_change_password', false);
    }

    public function test_the_default_password_cannot_be_kept_as_the_new_password(): void
    {
        $this->importStudent();
        $token = $this->signIn('87654321', '4321-uclm');

        $this->as($token)->putJson('/api/user/password', [
            'current_password' => '4321-uclm',
            'password' => '4321-uclm',
            'password_confirmation' => '4321-uclm',
        ])->assertUnprocessable()->assertJsonPath('message', 'Choose a password different from your current one.');

        $this->assertTrue((bool) User::find(87654321)->must_change_password);
    }

    public function test_an_unflagged_user_may_keep_the_same_password_as_before(): void
    {
        $user = User::factory()->student()->create(['organization_id' => $this->organization->id, 'password_hash' => 'same-password-1']);

        $this->as($user->createToken('auth_token')->plainTextToken)->putJson('/api/user/password', [
            'current_password' => 'same-password-1',
            'password' => 'same-password-1',
            'password_confirmation' => 'same-password-1',
        ])->assertOk();
    }

    public function test_changing_the_password_revokes_the_other_sessions_but_keeps_the_current_one(): void
    {
        $this->importStudent();
        $leaked = $this->signIn('87654321', '4321-uclm');
        $current = $this->signIn('87654321', '4321-uclm');

        $this->as($current)->putJson('/api/user/password', [
            'current_password' => '4321-uclm',
            'password' => 'my-own-secret',
            'password_confirmation' => 'my-own-secret',
        ])->assertOk();

        $this->assertSame(1, User::find(87654321)->tokens()->count());
        $this->as($leaked)->getJson('/api/user')->assertUnauthorized();
        $this->as($current)->getJson('/api/user')->assertOk();
    }

    public function test_a_self_registered_student_is_not_flagged(): void
    {
        $response = $this->postJson('/api/register', [
            'organization_id' => $this->organization->id,
            'school_id' => 1001,
            'first_name' => 'Ada',
            'last_name' => 'Lovelace',
            'email' => 'ada@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertCreated()->assertJsonPath('user.must_change_password', false);

        $this->as($response->json('access_token'))->getJson('/api/events')->assertOk();
    }

    public function test_setting_a_password_through_the_reset_flow_clears_the_flag(): void
    {
        $user = User::factory()->student()->create(['organization_id' => $this->organization->id, 'must_change_password' => true]);
        DB::table('password_reset_tokens')->insert([
            'organization_id' => $user->organization_id,
            'email' => $user->email,
            'token' => Hash::make('reset-token'),
            'created_at' => now(),
        ]);

        $this->postJson('/api/password/reset', [
            'organization_id' => $user->organization_id,
            'email' => $user->email,
            'token' => 'reset-token',
            'password' => 'my-own-secret',
            'password_confirmation' => 'my-own-secret',
        ])->assertOk();

        $this->assertFalse((bool) $user->fresh()->must_change_password);
    }

    public function test_the_migration_adds_a_false_default_column_and_rolls_back(): void
    {
        $migration = require database_path('migrations/2026_10_10_000002_add_must_change_password_to_users.php');

        $this->assertTrue(Schema::hasColumn('users', 'must_change_password'));
        $this->assertFalse((bool) User::factory()->create(['organization_id' => $this->organization->id])->fresh()->must_change_password);

        $migration->down();
        $this->assertFalse(Schema::hasColumn('users', 'must_change_password'));

        $migration->up();
        $this->assertTrue(Schema::hasColumn('users', 'must_change_password'));
    }
}
