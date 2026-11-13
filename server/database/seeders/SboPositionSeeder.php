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
        ];

        Organization::student()->get(['id'])->each(function (Organization $organization) use ($positions) {
            foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
                foreach ($positions as $title) {
                    // DatabaseSeeder runs without model events, so the creating hook cannot set the switch here.
                    // Only a new row gets the default, so a reseed never overwrites an Admin's choice.
                    $position = SboPosition::firstOrNew(['organization_id' => $organization->id, 'role' => $role, 'title' => $title]);
                    if (! $position->exists) {
                        $position->can_book_venues = SboPosition::bookingDefaultFor($title);
                    }
                    $position->is_active = true;
                    $position->save();
                }
            }
        });
    }
}
