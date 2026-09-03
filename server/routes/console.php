<?php

use App\Console\Commands\MarkOverdueTasks;
use App\Console\Commands\PruneExpiredCache;
use App\Console\Commands\SendEventReminders;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command(MarkOverdueTasks::class)->dailyAt('00:05');
Schedule::command(SendEventReminders::class)->hourly()->withoutOverlapping();
Schedule::command(PruneExpiredCache::class)->dailyAt('02:30')->withoutOverlapping();
