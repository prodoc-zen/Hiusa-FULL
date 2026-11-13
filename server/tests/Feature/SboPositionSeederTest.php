<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SboPosition;
use Database\Seeders\SboPositionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * DatabaseSeeder runs without model events, so the SboPosition creating hook never fires during db:seed. The seeder
 * has to set the booking switch itself, or a fresh database leaves every officer unable to book a venue.
 */
class SboPositionSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_database_seeder_gives_positions_their_booking_defaults(): void
    {
        Storage::fake('local');

        $this->seed();

        $organization = Organization::student()->firstOrFail();
        foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
            foreach (['President', "Vice President \u{2013} Internal", "Vice President \u{2013} External", 'Secretary', 'Business Manager'] as $title) {
                $this->assertTrue(
                    (bool) SboPosition::where(['organization_id' => $organization->id, 'role' => $role, 'title' => $title])->value('can_book_venues'),
                    "{$title} ({$role}) should seed ON"
                );
            }
            foreach (['Assistant Secretary', 'Treasurer', 'Auditor', 'Public Information Officer', 'Representative'] as $title) {
                $this->assertFalse(
                    (bool) SboPosition::where(['organization_id' => $organization->id, 'role' => $role, 'title' => $title])->value('can_book_venues'),
                    "{$title} ({$role}) should seed OFF"
                );
            }
        }
    }

    public function test_reseeding_keeps_a_switch_an_admin_changed(): void
    {
        $organization = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION']);

        $this->seed(SboPositionSeeder::class);
        SboPosition::where(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer'])->update(['can_book_venues' => true]);
        SboPosition::where(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Secretary'])->update(['can_book_venues' => false]);

        $this->seed(SboPositionSeeder::class);

        $this->assertTrue((bool) SboPosition::where(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer'])->value('can_book_venues'));
        $this->assertFalse((bool) SboPosition::where(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Secretary'])->value('can_book_venues'));
    }
}
