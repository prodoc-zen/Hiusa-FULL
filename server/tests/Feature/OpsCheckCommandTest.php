<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class OpsCheckCommandTest extends TestCase
{
    use RefreshDatabase;

    private const HEARTBEAT_KEY = 'hiusa:scheduler-heartbeat';

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-12 10:00:00');
        Cache::put(self::HEARTBEAT_KEY, now()->getTimestamp());
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function pendingJob(int $availableAt, ?int $reservedAt = null): void
    {
        DB::table('jobs')->insert([
            'queue' => 'default',
            'payload' => '{}',
            'attempts' => 0,
            'reserved_at' => $reservedAt,
            'available_at' => $availableAt,
            'created_at' => $availableAt,
        ]);
    }

    public function test_a_healthy_queue_and_scheduler_exit_zero(): void
    {
        $this->pendingJob(now()->subMinutes(2)->getTimestamp());

        $this->artisan('hiusa:ops-check')
            ->expectsOutputToContain('Queue and scheduler look healthy.')
            ->assertExitCode(0);
    }

    public function test_failed_jobs_make_it_exit_non_zero(): void
    {
        DB::table('failed_jobs')->insert([
            'uuid' => (string) Str::uuid(),
            'connection' => 'database',
            'queue' => 'default',
            'payload' => '{}',
            'exception' => 'boom',
            'failed_at' => now(),
        ]);

        $this->artisan('hiusa:ops-check')
            ->expectsOutputToContain('1 failed job')
            ->assertExitCode(1);
    }

    public function test_an_old_pending_job_makes_it_exit_non_zero(): void
    {
        $this->pendingJob(now()->subMinutes(16)->getTimestamp());

        $this->artisan('hiusa:ops-check')
            ->expectsOutputToContain('oldest pending job has waited 16 minutes')
            ->assertExitCode(1);
    }

    public function test_a_job_still_being_worked_or_not_due_yet_is_not_pending_too_long(): void
    {
        $this->pendingJob(now()->subMinutes(30)->getTimestamp(), now()->subMinute()->getTimestamp());
        $this->pendingJob(now()->addHour()->getTimestamp());

        $this->artisan('hiusa:ops-check')->assertExitCode(0);
    }

    public function test_a_stale_scheduler_heartbeat_makes_it_exit_non_zero(): void
    {
        Cache::put(self::HEARTBEAT_KEY, now()->subMinutes(6)->getTimestamp());

        $this->artisan('hiusa:ops-check')
            ->expectsOutputToContain('scheduler last ran 6 minutes ago')
            ->assertExitCode(1);
    }

    public function test_a_scheduler_that_never_wrote_a_heartbeat_makes_it_exit_non_zero(): void
    {
        Cache::forget(self::HEARTBEAT_KEY);

        $this->artisan('hiusa:ops-check')
            ->expectsOutputToContain('scheduler has not recorded a heartbeat')
            ->assertExitCode(1);
    }

    public function test_the_scheduler_writes_the_heartbeat_every_minute(): void
    {
        Artisan::call('list');
        Cache::forget(self::HEARTBEAT_KEY);

        $event = collect(app(Schedule::class)->events())
            ->first(fn ($event) => $event->description === 'scheduler-heartbeat');

        $this->assertNotNull($event, 'No scheduled heartbeat is registered.');
        $this->assertSame('* * * * *', $event->expression);

        $event->run(app());

        $this->assertSame(now()->getTimestamp(), Cache::get(self::HEARTBEAT_KEY));
    }

    public function test_the_production_log_stack_rotates_daily_and_keeps_14_days(): void
    {
        $config = $this->freshLoggingConfig();

        $this->assertSame(['daily'], $config['channels']['stack']['channels']);
        $this->assertSame(14, $config['channels']['daily']['days']);
    }

    private function freshLoggingConfig(): array
    {
        $repository = Env::getRepository();
        $previous = $repository->get('LOG_STACK');
        $previousDays = $repository->get('LOG_DAILY_DAYS');
        $repository->clear('LOG_STACK');
        $repository->clear('LOG_DAILY_DAYS');

        try {
            return require config_path('logging.php');
        } finally {
            if ($previous !== null) {
                $repository->set('LOG_STACK', $previous);
            }
            if ($previousDays !== null) {
                $repository->set('LOG_DAILY_DAYS', $previousDays);
            }
        }
    }
}
