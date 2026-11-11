<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Tests\TestCase;

class HealthCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_answers_without_signing_in_and_reports_the_database_and_the_deployed_commit(): void
    {
        $sha = substr(trim(shell_exec('git -C '.escapeshellarg(base_path('..')).' rev-parse HEAD')), 0, 12);

        $this->getJson('/api/health')
            ->assertOk()
            ->assertExactJson(['status' => 'ok', 'database' => 'ok', 'sha' => $sha]);
    }

    public function test_health_reads_the_commit_from_git_once_a_minute_not_on_every_call(): void
    {
        Process::fake(['*' => Process::result("0123456789abcdef0123456789abcdef01234567\n")]);
        $isGitCall = fn ($process) => str_contains(implode(' ', (array) $process->command), 'rev-parse');

        $this->getJson('/api/health')->assertOk()->assertJsonPath('sha', '0123456789ab');
        $this->getJson('/api/health')->assertOk()->assertJsonPath('sha', '0123456789ab');
        Process::assertRanTimes($isGitCall, 1);

        $this->travel(61)->seconds();
        $this->getJson('/api/health')->assertOk();
        Process::assertRanTimes($isGitCall, 2);
    }

    public function test_health_fails_with_503_when_the_database_does_not_answer(): void
    {
        $working = config('database.default');
        $workingCache = config('cache.default');
        config([
            'cache.default' => 'database',
            'database.default' => 'unreachable',
            'database.connections.unreachable' => [
                'driver' => 'sqlite',
                'database' => base_path('storage/no-such-folder/missing.sqlite'),
                'prefix' => '',
            ],
        ]);
        DB::purge('unreachable');

        try {
            $this->getJson('/api/health')
                ->assertStatus(503)
                ->assertJsonPath('status', 'error')
                ->assertJsonPath('database', 'error');
        } finally {
            config(['database.default' => $working, 'cache.default' => $workingCache]);
        }
    }
}
