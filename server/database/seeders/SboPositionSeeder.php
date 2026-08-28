<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\SboPosition;
use Illuminate\Database\Seeder;

class SboPositionSeeder extends Seeder
{
    public function run(): void
    {
        $positions = [
            'President',
            'Vice President',
            'Secretary',
            'Treasurer',
            'Auditor',
            'Public Relations Officer',
            'Business Manager',
            'Adviser',
        ];

        Organization::all(['id'])->each(function (Organization $organization) use ($positions) {
            foreach ($positions as $title) {
                SboPosition::updateOrCreate(
                    ['organization_id' => $organization->id, 'title' => $title],
                    ['is_active' => true]
                );
            }
        });
    }
}
