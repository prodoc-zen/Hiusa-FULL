<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdministrativeRegisterFiltersTest extends TestCase
{
    use RefreshDatabase;

    public function test_announcement_register_filters_and_sorts_within_the_organization(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);

        $matching = Announcement::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'title' => 'Leadership Training Notice',
            'category' => 'training',
            'target_role' => 'STUDENT',
            'approval_status' => 'approved',
            'is_published' => true,
            'views_count' => 18,
            'created_at' => now()->subDay(),
        ]);
        Announcement::factory()->create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'title' => 'General Draft',
            'category' => 'general',
            'is_published' => false,
        ]);
        Announcement::factory()->create([
            'organization_id' => $otherOrganization->id,
            'title' => 'Leadership Training Notice from another organization',
            'category' => 'training',
            'target_role' => 'STUDENT',
            'is_published' => true,
        ]);

        Sanctum::actingAs($admin);

        $response = $this->getJson('/api/announcements?category=training&target_role=STUDENT&publication_status=published&search=Leadership&sort=most_viewed');

        $response->assertOk()->assertJsonCount(1)->assertJsonPath('0.id', $matching->id);
        $response->assertJsonPath('0.creator.school_id', $admin->school_id);
    }

    public function test_approval_register_filters_by_type_requester_and_date_with_profile_context(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $requester = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'SBO_OFFICER',
            'first_name' => 'Andrea',
            'position_title' => 'Treasurer',
            'department' => 'College of Computer Studies',
            'program' => 'BSIT',
            'year_level' => '3rd Year',
            'section' => 'A',
        ]);

        $matching = ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => 999,
            'required_role' => 'ADMIN',
            'requested_by' => $requester->school_id,
            'status' => 'pending',
            'remarks' => 'Budget review requested',
            'requested_at' => now(),
        ]);
        ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'event',
            'entity_id' => 998,
            'required_role' => 'ADMIN',
            'requested_by' => $requester->school_id,
            'status' => 'pending',
            'requested_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $date = now()->toDateString();

        $response = $this->getJson("/api/approval-requests?status=pending&entity_type=budget&search=Andrea&from={$date}&to={$date}");

        $response->assertOk()->assertJsonCount(1)->assertJsonPath('0.id', $matching->id);
        $response->assertJsonPath('0.requester.position_title', 'Treasurer');
        $response->assertJsonPath('0.requester.program', 'BSIT');
    }
}
