<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class ApiPerformanceProtectionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        RateLimiter::clear('127.0.0.1');
    }

    public function test_authenticated_json_reads_are_private_cached_and_support_etags(): void
    {
        $user = User::factory()->create(['role' => 'ADMIN']);
        Announcement::factory()->create([
            'organization_id' => $user->organization_id,
            'created_by' => $user->school_id,
        ]);
        $token = $user->createToken('cache-test')->plainTextToken;

        $first = $this->withToken($token)->getJson('/api/announcements');
        $first->assertOk()
            ->assertHeader('X-Cache', 'MISS');
        $this->assertStringContainsString('Authorization', (string) $first->headers->get('Vary'));
        $this->assertStringContainsString('private', (string) $first->headers->get('Cache-Control'));

        $etag = (string) $first->headers->get('ETag');
        $this->assertNotEmpty($etag);

        $this->withToken($token)->getJson('/api/announcements')
            ->assertOk()
            ->assertHeader('X-Cache', 'HIT')
            ->assertExactJson($first->json());

        $this->withToken($token)
            ->withHeader('If-None-Match', $etag)
            ->get('/api/announcements')
            ->assertNotModified()
            ->assertHeader('X-Cache', 'HIT');
    }

    public function test_cache_is_separated_by_organization_and_invalidated_after_a_write(): void
    {
        $firstUser = User::factory()->create(['role' => 'ADMIN']);
        $secondOrganization = Organization::factory()->create();
        $secondUser = User::factory()->create([
            'organization_id' => $secondOrganization->id,
            'role' => 'ADMIN',
        ]);

        Announcement::factory()->create([
            'organization_id' => $firstUser->organization_id,
            'created_by' => $firstUser->school_id,
            'title' => 'First organization only',
        ]);
        Announcement::factory()->create([
            'organization_id' => $secondUser->organization_id,
            'created_by' => $secondUser->school_id,
            'title' => 'Second organization only',
        ]);

        $firstToken = $firstUser->createToken('first-cache-test')->plainTextToken;
        $secondToken = $secondUser->createToken('second-cache-test')->plainTextToken;

        $this->withToken($firstToken)->getJson('/api/announcements')
            ->assertOk()
            ->assertJsonFragment(['title' => 'First organization only'])
            ->assertJsonMissing(['title' => 'Second organization only']);

        $this->app['auth']->forgetGuards();
        $this->withToken($secondToken)->getJson('/api/announcements')
            ->assertOk()
            ->assertHeader('X-Cache', 'MISS')
            ->assertJsonFragment(['title' => 'Second organization only'])
            ->assertJsonMissing(['title' => 'First organization only']);

        $this->app['auth']->forgetGuards();
        $this->withToken($firstToken)->getJson('/api/announcements')
            ->assertHeader('X-Cache', 'HIT');

        $this->app['auth']->forgetGuards();
        $this->withToken($firstToken)->postJson('/api/announcements', [
            'title' => 'Invalidates cached list',
            'body' => 'A complete announcement body.',
            'target_role' => 'all',
            'category' => 'general',
        ])->assertCreated();

        $this->app['auth']->forgetGuards();
        $this->withToken($firstToken)->getJson('/api/announcements')
            ->assertOk()
            ->assertHeader('X-Cache', 'MISS')
            ->assertJsonFragment(['title' => 'Invalidates cached list']);
    }

    public function test_login_is_rate_limited_with_a_json_response(): void
    {
        config()->set('performance.rate_limits.login_per_minute', 3);

        for ($attempt = 0; $attempt < 3; $attempt++) {
            $this->postJson('/api/login', [
                'organization_id' => 999,
                'school_id' => 12345678 + $attempt,
                'password' => 'invalid-password',
            ])->assertStatus(422);
        }

        $this->postJson('/api/login', [
            'organization_id' => 999,
            'school_id' => 22345678,
            'password' => 'invalid-password',
        ])->assertTooManyRequests()
            ->assertJsonPath('message', 'Too many requests. Please wait before trying again.');
    }

    public function test_expired_database_cache_rows_are_pruned_without_removing_live_entries(): void
    {
        config()->set('cache.default', 'database');
        config()->set('cache.stores.database.connection', null);
        config()->set('cache.stores.database.table', 'cache');

        DB::table('cache')->insert([
            [
                'key' => 'expired-cache-entry',
                'value' => serialize('expired'),
                'expiration' => now()->subMinute()->getTimestamp(),
            ],
            [
                'key' => 'live-cache-entry',
                'value' => serialize('live'),
                'expiration' => now()->addMinute()->getTimestamp(),
            ],
        ]);

        $this->artisan('hiusa:prune-expired-cache')->assertSuccessful();

        $this->assertDatabaseMissing('cache', ['key' => 'expired-cache-entry']);
        $this->assertDatabaseHas('cache', ['key' => 'live-cache-entry']);
    }
}
