<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Throwable;

class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        try {
            DB::select('select 1');
        } catch (Throwable $e) {
            report($e);

            return response()->json(['status' => 'error', 'database' => 'error', 'sha' => $this->sha()], 503);
        }

        return response()->json(['status' => 'ok', 'database' => 'ok', 'sha' => $this->sha()]);
    }

    // The deploy compares this with the first 12 characters of the commit it just merged. `-c safe.directory=*`
    // because php-fpm runs as a different user from the one that owns the checkout. Kept for 60 seconds so a
    // busy endpoint does not start git on every call; a failed read is not kept. The cache lives in the database in
    // production, so when the database is down the commit is read straight from git and the 503 still answers.
    private function sha(): ?string
    {
        try {
            return Cache::remember('health:sha', 60, fn () => $this->readSha());
        } catch (Throwable) {
            return $this->readSha();
        }
    }

    private function readSha(): ?string
    {
        $result = Process::path(base_path())->run(['git', '-c', 'safe.directory=*', 'rev-parse', 'HEAD']);

        return $result->successful() ? substr(trim($result->output()), 0, 12) : null;
    }
}
