<?php

namespace Database\Seeders;

use App\Models\Organization;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $this->call([
            OrganizationSeeder::class,
            AdministratorSeeder::class,
            UserSeeder::class,
            DepartmentHeadSeeder::class,
            AnnouncementSeeder::class,
            EventSeeder::class,
            TaskSeeder::class,
            BudgetSeeder::class,
            MerchandiseSeeder::class,
            ElectionSeeder::class,
        ]);

        $defaultOrganizationId = Organization::where('acronym', 'PSITS-CCS')->value('id');

        if ($defaultOrganizationId) {
            foreach ([
                'announcements',
                'events',
                'tasks',
                'budgets',
                'transactions',
                'financial_forecasts',
                'merchandise',
                'orders',
                'elections',
                'partylists',
                'notifications',
            ] as $table) {
                DB::table($table)
                    ->whereNull('organization_id')
                    ->update(['organization_id' => $defaultOrganizationId]);
            }
        }
    }
}
