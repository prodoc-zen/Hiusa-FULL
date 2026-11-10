<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class OpsCheck extends Command
{
    public const HEARTBEAT_KEY = 'hiusa:scheduler-heartbeat';

    private const OLDEST_PENDING_JOB_MINUTES = 15;

    private const HEARTBEAT_MINUTES = 5;

    protected $signature = 'hiusa:ops-check';

    protected $description = 'Report failed jobs, a stuck queue or a stopped scheduler; exits non-zero when any is found';

    public function handle(): int
    {
        $problems = [];

        $failed = DB::table(config('queue.failed.table', 'failed_jobs'))->count();
        if ($failed > 0) {
            $problems[] = $failed.' failed '.($failed === 1 ? 'job is' : 'jobs are').' waiting in the failed jobs table.';
        }

        $oldestPending = DB::table(config('queue.connections.database.table', 'jobs'))
            ->whereNull('reserved_at')
            ->where('available_at', '<=', now()->getTimestamp())
            ->min('available_at');
        if ($oldestPending !== null) {
            $minutes = intdiv(now()->getTimestamp() - (int) $oldestPending, 60);
            if ($minutes > self::OLDEST_PENDING_JOB_MINUTES) {
                $problems[] = "The oldest pending job has waited {$minutes} minutes, so the queue worker may be stopped.";
            }
        }

        $heartbeat = Cache::get(self::HEARTBEAT_KEY);
        if ($heartbeat === null) {
            $problems[] = 'The scheduler has not recorded a heartbeat, so it may be stopped.';
        } else {
            $minutes = intdiv(now()->getTimestamp() - (int) $heartbeat, 60);
            if ($minutes > self::HEARTBEAT_MINUTES) {
                $problems[] = "The scheduler last ran {$minutes} minutes ago, so it may be stopped.";
            }
        }

        if ($problems === []) {
            $this->info('Queue and scheduler look healthy.');

            return self::SUCCESS;
        }

        foreach ($problems as $problem) {
            $this->error($problem);
        }

        return self::FAILURE;
    }
}
