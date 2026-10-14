<?php

namespace App\Console\Commands;

use App\Services\DepartmentHeadProfileService;
use Illuminate\Console\Command;

class SyncDepartmentHeadProfiles extends Command
{
    protected $signature = 'hiusa:sync-department-head-profiles';

    protected $description = 'Add missing Department Head profiles for previously approved organizations';

    public function handle(DepartmentHeadProfileService $profiles): int
    {
        $created = $profiles->backfillApprovedOrganizations();
        $this->info("Created {$created} Department Head organization profiles.");

        return self::SUCCESS;
    }
}
