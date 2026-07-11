<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Seeder;

class UserSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            return;
        }

        $defaultOrganizationId = Organization::where('acronym', 'PSITS-CCS')->value('id');
        $otherOrganizationIds = Organization::where('acronym', '!=', 'PSITS-CCS')->pluck('id')->values();

        $users = [
            // Officers (login with email)
            ['school_id' => 900001, 'role' => 'SBO_OFFICER',  'first_name' => 'Marco',      'last_name' => 'Dela Cruz',   'email' => 'officer1@hiusa.local'],
            ['school_id' => 900002, 'role' => 'SBO_OFFICER',  'first_name' => 'Angela',     'last_name' => 'Santos',      'email' => 'officer2@hiusa.local'],

            // Advisers — exec-board members, role ADMIN with position_title 'Adviser' (login with email)
            ['school_id' => 910001, 'role' => 'ADMIN',  'position_title' => 'Adviser', 'first_name' => 'Ricardo',    'last_name' => 'Lim',         'email' => 'adviser1@hiusa.local'],
            ['school_id' => 910002, 'role' => 'ADMIN',  'position_title' => 'Adviser', 'first_name' => 'Maria',      'last_name' => 'Reyes',       'email' => 'adviser2@hiusa.local'],

            // Students (login with school_id, password: Demo@12345)
            ['school_id' => 2100142, 'role' => 'STUDENT', 'first_name' => 'Juan',       'last_name' => 'Dela Vega',   'email' => 'juan.delavega@student.hiusa.local'],
            ['school_id' => 2100217, 'role' => 'STUDENT', 'first_name' => 'Sofia',      'last_name' => 'Bautista',    'email' => 'sofia.bautista@student.hiusa.local'],
            ['school_id' => 2100389, 'role' => 'STUDENT', 'first_name' => 'Carlo',      'last_name' => 'Mendoza',     'email' => 'carlo.mendoza@student.hiusa.local'],
            ['school_id' => 2200055, 'role' => 'STUDENT', 'first_name' => 'Pia',        'last_name' => 'Torres',      'email' => 'pia.torres@student.hiusa.local'],
            ['school_id' => 2200134, 'role' => 'STUDENT', 'first_name' => 'Luis',       'last_name' => 'Ramos',       'email' => 'luis.ramos@student.hiusa.local'],
            ['school_id' => 2200298, 'role' => 'STUDENT', 'first_name' => 'Gabrielle',  'last_name' => 'Villanueva',  'email' => 'gabrielle.villanueva@student.hiusa.local'],
            ['school_id' => 2200451, 'role' => 'STUDENT', 'first_name' => 'Rafael',     'last_name' => 'Aquino',      'email' => 'rafael.aquino@student.hiusa.local'],
            ['school_id' => 2300078, 'role' => 'STUDENT', 'first_name' => 'Camille',    'last_name' => 'Garcia',      'email' => 'camille.garcia@student.hiusa.local'],
            ['school_id' => 2300163, 'role' => 'STUDENT', 'first_name' => 'Andrei',     'last_name' => 'Navarro',     'email' => 'andrei.navarro@student.hiusa.local'],
            ['school_id' => 2300247, 'role' => 'STUDENT', 'first_name' => 'Beatrice',   'last_name' => 'Castillo',    'email' => 'beatrice.castillo@student.hiusa.local'],
            ['school_id' => 2300312, 'role' => 'STUDENT', 'first_name' => 'Miguel',     'last_name' => 'Pascual',     'email' => 'miguel.pascual@student.hiusa.local'],
            ['school_id' => 2400019, 'role' => 'STUDENT', 'first_name' => 'Trisha',     'last_name' => 'Herrera',     'email' => 'trisha.herrera@student.hiusa.local'],
            ['school_id' => 2400067, 'role' => 'STUDENT', 'first_name' => 'Jerome',     'last_name' => 'Evangelista', 'email' => 'jerome.evangelista@student.hiusa.local'],
            ['school_id' => 2400093, 'role' => 'STUDENT', 'first_name' => 'Alyssa',     'last_name' => 'Domingo',     'email' => 'alyssa.domingo@student.hiusa.local'],
        ];

        foreach ($users as $u) {
            User::updateOrCreate(
                ['school_id' => $u['school_id']],
                array_merge($u, [
                    'organization_id' => $defaultOrganizationId,
                    'password_hash' => 'Demo@12345',
                    'is_member' => true,
                ])
            );
        }

        $sampleOtherOrgUsers = [
            ['school_id' => 920011, 'role' => 'SBO_OFFICER', 'first_name' => 'Mika', 'last_name' => 'Salcedo', 'email' => 'mika.salcedo@cbe.hiusa.local'],
            ['school_id' => 2400118, 'role' => 'STUDENT', 'first_name' => 'Nico', 'last_name' => 'Valdez', 'email' => 'nico.valdez@cte.hiusa.local'],
            ['school_id' => 930027, 'role' => 'ADMIN', 'position_title' => 'Adviser', 'first_name' => 'Elena', 'last_name' => 'Soriano', 'email' => 'elena.soriano@chs.hiusa.local'],
            ['school_id' => 2400133, 'role' => 'STUDENT', 'first_name' => 'Paolo', 'last_name' => 'Marquez', 'email' => 'paolo.marquez@coe.hiusa.local'],
        ];

        foreach ($sampleOtherOrgUsers as $index => $u) {
            User::updateOrCreate(
                ['school_id' => $u['school_id']],
                array_merge($u, [
                    'organization_id' => $otherOrganizationIds[$index] ?? $defaultOrganizationId,
                    'password_hash' => 'Demo@12345',
                    'is_member' => true,
                ])
            );
        }
    }
}
