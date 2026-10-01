<?php

namespace App\Console\Commands;

use App\Models\EventRegistration;
use Illuminate\Console\Command;

class MarkEventNoShows extends Command
{
    protected $signature = 'events:mark-no-shows';

    protected $description = 'Set status=no_show on registrations still "registered" once their event has ended';

    public function handle(): int
    {
        $updated = EventRegistration::where('status', 'registered')
            ->whereHas('event', fn ($event) => $event->where('end_time', '<', now()))
            ->update(['status' => 'no_show']);

        $this->info("Marked {$updated} registration(s) as no_show.");

        return Command::SUCCESS;
    }
}
