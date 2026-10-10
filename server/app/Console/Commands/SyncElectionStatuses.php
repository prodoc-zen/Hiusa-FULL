<?php

namespace App\Console\Commands;

use App\Models\Election;
use Illuminate\Console\Command;

class SyncElectionStatuses extends Command
{
    protected $signature = 'elections:sync-statuses';

    protected $description = 'Open approved, finalized elections whose voting window has started and close those whose window has ended';

    public function handle(): int
    {
        $result = Election::synchronizeScheduledStatuses();

        $this->info("Opened {$result['opened']} election(s) and closed {$result['closed']} election(s).");

        return Command::SUCCESS;
    }
}
