<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Election;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StudentFeedTest extends TestCase
{
    use RefreshDatabase;

    public function test_student_feed_is_scoped_targeted_paginated_and_deduplicated(): void
    {
        $student = User::factory()->student()->create();
        $publisher = User::factory()->admin()->create(['organization_id' => $student->organization_id]);
        $otherOrganization = Organization::factory()->create();

        for ($index = 1; $index <= 13; $index++) {
            Announcement::factory()->create([
                'organization_id' => $student->organization_id,
                'created_by' => $publisher->id,
                'title' => "Visible update {$index}",
                'target_role' => $index % 2 ? 'all' : 'STUDENT',
                'is_published' => true,
                'approval_status' => 'approved',
                'published_at' => now()->subMinutes($index),
            ]);
        }

        $pinned = Announcement::factory()->create([
            'organization_id' => $student->organization_id,
            'created_by' => $publisher->id,
            'title' => 'Pinned safety advisory',
            'target_role' => 'all',
            'is_published' => true,
            'approval_status' => 'approved',
            'is_pinned' => true,
            'published_at' => now()->subMonth(),
        ]);
        Announcement::factory()->create([
            'organization_id' => $student->organization_id,
            'created_by' => $publisher->id,
            'title' => 'Admins only',
            'target_role' => 'ADMIN',
            'is_published' => true,
            'approval_status' => 'approved',
        ]);
        Announcement::factory()->create([
            'organization_id' => $otherOrganization->id,
            'title' => 'Other organization',
            'target_role' => 'all',
            'is_published' => true,
            'approval_status' => 'approved',
        ]);

        Event::factory()->create([
            'organization_id' => $student->organization_id,
            'created_by' => $publisher->id,
            'title' => 'Approved student event',
            'status' => 'approved',
        ]);
        Election::factory()->create([
            'organization_id' => $student->organization_id,
            'title' => 'Active student election',
            'status' => 'active',
            'start_time' => now()->subHour(),
            'end_time' => now()->addDay(),
            'approved_at' => now()->subDay(),
        ]);

        Sanctum::actingAs($student);
        $first = $this->getJson('/api/student/feed?page=1&per_page=12')->assertOk();
        $second = $this->getJson('/api/student/feed?page=2&per_page=12')->assertOk();

        $first->assertJsonPath('items.0.key', 'announcement-'.$pinned->id)
            ->assertJsonPath('items.0.is_pinned', true)
            ->assertJsonPath('pagination.current_page', 1)
            ->assertJsonPath('pagination.has_more', true)
            ->assertJsonMissing(['title' => 'Admins only'])
            ->assertJsonMissing(['title' => 'Other organization']);
        $second->assertJsonPath('pagination.has_more', false);

        $keys = collect($first->json('items'))->pluck('key')->merge(collect($second->json('items'))->pluck('key'));
        $this->assertSame($keys->count(), $keys->unique()->count());
        $this->assertContains('event-'.Event::where('title', 'Approved student event')->value('id'), $keys->all());
        $this->assertContains('election-'.Election::where('title', 'Active student election')->value('id'), $keys->all());
    }

    public function test_feed_media_uploads_are_validated_and_stored(): void
    {
        Storage::fake('public');
        $admin = User::factory()->admin()->create();
        Sanctum::actingAs($admin);

        $announcement = $this->post('/api/announcements', [
            'title' => 'Poster advisory',
            'body' => 'Please review the attached official poster.',
            'target_role' => 'STUDENT',
            'category' => 'general',
            'is_published' => '1',
            'is_pinned' => '1',
            'is_important' => '1',
            'image' => UploadedFile::fake()->image('advisory.webp'),
        ])->assertCreated();

        $announcement->assertJsonPath('is_pinned', true)
            ->assertJsonPath('is_important', true);
        $this->assertNotNull($announcement->json('image_url'));

        $event = $this->post('/api/events', [
            'title' => 'Campus activity',
            'start_time' => now()->addDay()->toIso8601String(),
            'end_time' => now()->addDay()->addHours(2)->toIso8601String(),
            'image' => UploadedFile::fake()->image('activity.png'),
        ])->assertCreated();
        $this->assertNotNull($event->json('image_url'));

        $this->withHeader('Accept', 'application/json')->post('/api/announcements', [
            'title' => 'Invalid file',
            'body' => 'Invalid file must be rejected.',
            'target_role' => 'all',
            'image' => UploadedFile::fake()->create('script.svg', 10, 'image/svg+xml'),
        ])->assertUnprocessable()->assertJsonValidationErrors('image');
    }
}
