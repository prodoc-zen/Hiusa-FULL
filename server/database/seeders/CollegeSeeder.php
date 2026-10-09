<?php

namespace Database\Seeders;

use App\Models\College;
use Illuminate\Database\Seeder;

// Colleges are fixed reference data, so unlike the demo seeders this one also runs in production.
class CollegeSeeder extends Seeder
{
    public function run(): void
    {
        foreach ([
            'College of Computer Studies' => 'CCS',
            'College of Business Education' => 'CBE',
            'College of Teacher Education' => 'CTE',
            'College of Health Sciences' => 'CHS',
            'College of Engineering' => 'COE',
        ] as $name => $code) {
            College::updateOrCreate(['name' => $name], ['code' => $code, 'is_active' => true]);
        }
    }
}
