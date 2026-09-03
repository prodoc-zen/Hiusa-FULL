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
            'Vice President – Internal',
            'Vice President – External',
            'Secretary',
            'Assistant Secretary',
            'Treasurer',
            'Auditor',
            'Public Information Officer',
            'Representative',
            'Business Manager',
            'Adviser',
        ];

        Organization::all(['id'])->each(function (Organization $organization) use ($positions) {
            foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
                foreach ($positions as $title) {
                    SboPosition::updateOrCreate(
                        ['organization_id' => $organization->id, 'role' => $role, 'title' => $title],
                        ['is_active' => true]
                    );
                }
            }
        });
    }
}
