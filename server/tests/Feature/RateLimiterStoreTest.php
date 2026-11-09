<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RateLimiterStoreTest extends TestCase
{
    use RefreshDatabase;

    private array $savedEnv = [];

    protected function setUp(): void
    {
        // Boot the app the way production does: the default cache store is the database and nothing names a limiter store.
        foreach (['CACHE_STORE' => 'database', 'CACHE_LIMITER_STORE' => null] as $name => $value) {
            $this->savedEnv[$name] = $_ENV[$name] ?? null;
            $value === null ? $this->forgetEnv($name) : $this->putEnv($name, $value);
        }
        parent::setUp();
    }

    protected function tearDown(): void
    {
        Cache::store('file')->flush();
        parent::tearDown();
        foreach ($this->savedEnv as $name => $value) {
            $value === null ? $this->forgetEnv($name) : $this->putEnv($name, $value);
        }
    }

    private function putEnv(string $name, string $value): void
    {
        $_ENV[$name] = $_SERVER[$name] = $value;
        putenv("$name=$value");
    }

    private function forgetEnv(string $name): void
    {
        unset($_ENV[$name], $_SERVER[$name]);
        putenv($name);
    }

    /**
     * Production deadlocked on "insert ignore into cache" when a fresh login fired parallel requests: two
     * transactions each held a shared lock on the expired limiter row and both waited to upgrade it, and the
     * loser answered 500. The throttle must never write its counters to the database cache.
     */
    public function test_throttled_requests_do_not_write_rate_limit_counters_to_the_database_cache(): void
    {
        $this->assertSame('database', config('cache.default'));
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]));

        $cacheWrites = [];
        DB::listen(function ($query) use (&$cacheWrites) {
            if (preg_match('/^insert (or )?ignore into [`"]cache[`"]/i', $query->sql)) {
                $cacheWrites[] = $query->sql;
            }
        });

        $this->getJson('/api/academic-periods')->assertOk();
        $this->getJson('/api/my/organization-applications')->assertOk();

        $this->assertSame([], $cacheWrites);
    }

    public function test_the_limiter_store_is_not_the_database_store(): void
    {
        $this->assertSame('file', config('cache.limiter'));
    }
}
