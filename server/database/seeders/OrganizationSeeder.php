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
                // Only the primary demo organization gets a GCash QR on seed, so
                // the merchandise money path is demonstrable out of the box.
                // FinancialAccountabilityTest::test_gcash_order_is_rejected_until_an_official_qr_is_configured
                // depends on a factory-made org having none, so this must stay
                // seeder-only and never move into OrganizationFactory.
                'gcash_qr_url' => '/uploads/gcash/378e6878-a7e0-44b8-b77e-90f5b4892058.png',
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
