<?php

namespace App\Console\Commands;

use App\Services\DepartmentHeadProfileService;
use Illuminate\Console\Command;

class SyncDepartmentHeadProfiles extends Command
{
    protected $signature = 'hiusa:consolidate-department-head-profiles';

    protected $description = 'Remove redundant organization profiles from Department Heads who have college-wide access';

    public function handle(DepartmentHeadProfileService $profiles): int
    {
        $removed = $profiles->removeOrganizationProfiles();
        $this->info("Removed {$removed} redundant Department Head organization profiles.");

        return self::SUCCESS;
    }
}
