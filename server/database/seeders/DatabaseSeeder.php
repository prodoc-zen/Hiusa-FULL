<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $this->call([
            AdministratorSeeder::class,
            UserSeeder::class,
            AnnouncementSeeder::class,
            EventSeeder::class,
            TaskSeeder::class,
            BudgetSeeder::class,
            MerchandiseSeeder::class,
            ElectionSeeder::class,
        ]);
    }
}
