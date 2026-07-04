<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class UserSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            return;
        }

        $users = [
            // Officers (login with email)
            ['school_id' => 'OFF-2024-001', 'role' => 'officer',  'first_name' => 'Marco',      'last_name' => 'Dela Cruz',   'email' => 'officer1@hiusa.local'],
            ['school_id' => 'OFF-2024-002', 'role' => 'officer',  'first_name' => 'Angela',     'last_name' => 'Santos',      'email' => 'officer2@hiusa.local'],

            // Advisers (login with email)
            ['school_id' => 'ADV-2024-001', 'role' => 'adviser',  'first_name' => 'Ricardo',    'last_name' => 'Lim',         'email' => 'adviser1@hiusa.local'],
            ['school_id' => 'ADV-2024-002', 'role' => 'adviser',  'first_name' => 'Maria',      'last_name' => 'Reyes',       'email' => 'adviser2@hiusa.local'],

            // Students (login with school_id, password: Demo@12345)
            ['school_id' => '2021-00142', 'role' => 'student', 'first_name' => 'Juan',       'last_name' => 'Dela Vega',   'email' => 'juan.delavega@student.hiusa.local'],
            ['school_id' => '2021-00217', 'role' => 'student', 'first_name' => 'Sofia',      'last_name' => 'Bautista',    'email' => 'sofia.bautista@student.hiusa.local'],
            ['school_id' => '2021-00389', 'role' => 'student', 'first_name' => 'Carlo',      'last_name' => 'Mendoza',     'email' => 'carlo.mendoza@student.hiusa.local'],
            ['school_id' => '2022-00055', 'role' => 'student', 'first_name' => 'Pia',        'last_name' => 'Torres',      'email' => 'pia.torres@student.hiusa.local'],
            ['school_id' => '2022-00134', 'role' => 'student', 'first_name' => 'Luis',       'last_name' => 'Ramos',       'email' => 'luis.ramos@student.hiusa.local'],
            ['school_id' => '2022-00298', 'role' => 'student', 'first_name' => 'Gabrielle',  'last_name' => 'Villanueva',  'email' => 'gabrielle.villanueva@student.hiusa.local'],
            ['school_id' => '2022-00451', 'role' => 'student', 'first_name' => 'Rafael',     'last_name' => 'Aquino',      'email' => 'rafael.aquino@student.hiusa.local'],
            ['school_id' => '2023-00078', 'role' => 'student', 'first_name' => 'Camille',    'last_name' => 'Garcia',      'email' => 'camille.garcia@student.hiusa.local'],
            ['school_id' => '2023-00163', 'role' => 'student', 'first_name' => 'Andrei',     'last_name' => 'Navarro',     'email' => 'andrei.navarro@student.hiusa.local'],
            ['school_id' => '2023-00247', 'role' => 'student', 'first_name' => 'Beatrice',   'last_name' => 'Castillo',    'email' => 'beatrice.castillo@student.hiusa.local'],
            ['school_id' => '2023-00312', 'role' => 'student', 'first_name' => 'Miguel',     'last_name' => 'Pascual',     'email' => 'miguel.pascual@student.hiusa.local'],
            ['school_id' => '2024-00019', 'role' => 'student', 'first_name' => 'Trisha',     'last_name' => 'Herrera',     'email' => 'trisha.herrera@student.hiusa.local'],
            ['school_id' => '2024-00067', 'role' => 'student', 'first_name' => 'Jerome',     'last_name' => 'Evangelista', 'email' => 'jerome.evangelista@student.hiusa.local'],
            ['school_id' => '2024-00093', 'role' => 'student', 'first_name' => 'Alyssa',     'last_name' => 'Domingo',     'email' => 'alyssa.domingo@student.hiusa.local'],
        ];

        foreach ($users as $u) {
            User::updateOrCreate(
                ['school_id' => $u['school_id']],
                array_merge($u, ['password_hash' => 'Demo@12345', 'is_member' => true])
            );
        }
    }
}
