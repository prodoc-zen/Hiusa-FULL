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
            AcademicStructureSeeder::class,
            SboPositionSeeder::class,
            AnnouncementSeeder::class,
            EventSeeder::class,
            AttendanceSeeder::class,
            TaskSeeder::class,
            BudgetSeeder::class,
            MerchandiseSeeder::class,
            OrderSeeder::class,
            ElectionSeeder::class,
            NotificationSeeder::class,
            SaoGovernanceDemoSeeder::class,
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

        // WithoutModelEvents skips User::created, which gives every account the
        // organization profile the app looks members up by; without it, people
        // who have not signed in yet are invisible to delegation, clearances
        // and member lists.
        DB::table('users')
            ->whereNotNull('organization_id')
            ->whereNotExists(fn ($query) => $query->selectRaw('1')->from('account_profiles')
                ->whereColumn('account_profiles.user_school_id', 'users.school_id')
                ->whereColumn('account_profiles.organization_id', 'users.organization_id'))
            ->orderBy('school_id')
            ->get(['school_id', 'organization_id', 'role', 'account_status', 'position_title'])
            ->each(fn ($user) => DB::table('account_profiles')->insert([
                'user_school_id' => $user->school_id,
                'organization_id' => $user->organization_id,
                'role' => $user->role,
                'account_status' => $user->account_status,
                'position_title' => $user->position_title,
                'created_at' => now(),
                'updated_at' => now(),
            ]));

        // The Task hook dates every assignment for delegation recency.
        DB::table('tasks')->whereNotNull('assigned_to')->whereNull('assigned_at')->update(['assigned_at' => DB::raw('created_at')]);
    }
}
