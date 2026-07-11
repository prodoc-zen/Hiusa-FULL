<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Seeder;

class DepartmentHeadSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            return;
        }

        $departmentHeads = [
            ['school_id' => 940001, 'acronym' => 'PSITS-CCS', 'first_name' => 'Ramon',    'last_name' => 'Castillo',   'email' => 'dean.ccs@hiusa.local'],
            ['school_id' => 940002, 'acronym' => 'JPIA-CBE',  'first_name' => 'Corazon',  'last_name' => 'Villareal',  'email' => 'dean.cbe@hiusa.local'],
            ['school_id' => 940003, 'acronym' => 'FES-CTE',   'first_name' => 'Benjamin', 'last_name' => 'Torres',     'email' => 'dean.cte@hiusa.local'],
            ['school_id' => 940004, 'acronym' => 'NSC-CHS',   'first_name' => 'Marilou',  'last_name' => 'Santos',     'email' => 'dean.chs@hiusa.local'],
            ['school_id' => 940005, 'acronym' => 'EIG-COE',   'first_name' => 'Eduardo',  'last_name' => 'Ramos',      'email' => 'dean.coe@hiusa.local'],
        ];

        foreach ($departmentHeads as $head) {
            $organizationId = Organization::where('acronym', $head['acronym'])->value('id');

            if (!$organizationId) {
                continue;
            }

            User::updateOrCreate(
                ['school_id' => $head['school_id']],
                [
                    'organization_id' => $organizationId,
                    'first_name' => $head['first_name'],
                    'last_name' => $head['last_name'],
                    'email' => $head['email'],
                    'password_hash' => 'Demo@12345',
                    'role' => 'DEPARTMENT_HEAD',
                    'is_member' => true,
                ]
            );
        }
    }
}
