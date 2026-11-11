<?php

use App\Console\Commands\MarkEventNoShows;
use App\Console\Commands\MarkOverdueTasks;
use App\Console\Commands\OpsCheck;
use App\Console\Commands\PruneExpiredCache;
use App\Console\Commands\SendEventReminders;
use App\Console\Commands\SyncElectionStatuses;
use App\Http\Controllers\GlobalAnnouncementController;
use App\Services\OrganizationDeletionService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command(MarkOverdueTasks::class)->dailyAt('00:05');
Schedule::command(SendEventReminders::class)->hourly()->withoutOverlapping(70);
Schedule::command(MarkEventNoShows::class)->hourly()->withoutOverlapping(70);
Schedule::command(SyncElectionStatuses::class)->everyMinute()->withoutOverlapping(5);
Schedule::command(PruneExpiredCache::class)->dailyAt('02:30')->withoutOverlapping(120);
Schedule::call(fn () => app(OrganizationDeletionService::class)->cleanup())->name('retry-deleted-organization-files')->hourly()->withoutOverlapping(70);
Schedule::call(fn () => app(GlobalAnnouncementController::class)->publishScheduled())->name('publish-scheduled-sao-announcements')->everyMinute()->withoutOverlapping(5);
Schedule::call(fn () => Cache::put(OpsCheck::HEARTBEAT_KEY, now()->getTimestamp()))->name('scheduler-heartbeat')->everyMinute();
