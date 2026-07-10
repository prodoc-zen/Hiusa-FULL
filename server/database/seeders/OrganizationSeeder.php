<?php

namespace Database\Seeders;

use App\Models\Organization;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class OrganizationSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            return;
        }

        $organizations = [
            [
                'name' => 'Philippine Society of Information Technology Students - College of Computer Studies',
                'college' => 'College of Computer Studies',
                'acronym' => 'PSITS-CCS',
            ],
            [
                'name' => 'Junior Philippine Institute of Accountants - College of Business Education',
                'college' => 'College of Business Education',
                'acronym' => 'JPIA-CBE',
            ],
            [
                'name' => 'Future Educators Society - College of Teacher Education',
                'college' => 'College of Teacher Education',
                'acronym' => 'FES-CTE',
            ],
            [
                'name' => 'Nursing Student Council - College of Health Sciences',
                'college' => 'College of Health Sciences',
                'acronym' => 'NSC-CHS',
            ],
            [
                'name' => 'Engineering Innovators Guild - College of Engineering',
                'college' => 'College of Engineering',
                'acronym' => 'EIG-COE',
            ],
        ];

        foreach ($organizations as $organization) {
            Organization::updateOrCreate(
                ['slug' => Str::slug($organization['name'])],
                [...$organization, 'is_active' => true]
            );
        }
    }
}
