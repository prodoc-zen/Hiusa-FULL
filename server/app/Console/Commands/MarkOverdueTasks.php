<?php

namespace App\Console\Commands;

use App\Models\Task;
use Illuminate\Console\Command;

class MarkOverdueTasks extends Command
{
    protected $signature = 'tasks:mark-overdue';
    protected $description = 'Set status=overdue on any task whose deadline has passed and is still pending or in_progress';

    public function handle(): int
    {
        $updated = Task::whereIn('status', ['pending', 'in_progress'])
            ->whereDate('deadline', '<', now())
            ->update(['status' => 'overdue']);

        $this->info("Marked {$updated} task(s) as overdue.");

        return Command::SUCCESS;
    }
}
