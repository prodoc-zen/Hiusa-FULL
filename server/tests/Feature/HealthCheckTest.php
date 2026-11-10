<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class HealthCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_answers_without_signing_in_and_reports_the_database_and_the_deployed_commit(): void
    {
        $sha = trim(shell_exec('git -C '.escapeshellarg(base_path('..')).' rev-parse HEAD'));

        $this->getJson('/api/health')
            ->assertOk()
            ->assertExactJson(['status' => 'ok', 'database' => 'ok', 'sha' => $sha]);
    }

    public function test_health_fails_with_503_when_the_database_does_not_answer(): void
    {
        $working = config('database.default');
        config([
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
            config(['database.default' => $working]);
        }
    }
}
