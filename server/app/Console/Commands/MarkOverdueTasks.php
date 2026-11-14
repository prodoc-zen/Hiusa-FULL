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
        // A deadline stored at exactly midnight is a date-only due date, which runs to the end of that day.
        $updated = Task::whereIn('status', ['pending', 'in_progress'])
            ->where('deadline', '<', now())
            ->where('deadline', '!=', now()->startOfDay())
            ->update(['status' => 'overdue']);

        $this->info("Marked {$updated} task(s) as overdue.");

        return Command::SUCCESS;
    }
}
