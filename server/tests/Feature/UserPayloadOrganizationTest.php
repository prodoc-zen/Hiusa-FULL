<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * GET /api/user hands every member of an organization the organization row, so the row it carries is
 * a whitelist: the reviewer's and submitter's school ids (login identifiers) and the SAO's private
 * remarks stay on the server.
 */
class UserPayloadOrganizationTest extends TestCase
{
    use RefreshDatabase;

    private const VISIBLE = [
        'acronym', 'college', 'college_id', 'color', 'id', 'is_active', 'lifecycle_status', 'logo_url',
        'name', 'organization_type', 'parent_organization_id', 'slug',
    ];

    public function test_a_student_receives_only_the_whitelisted_organization_columns(): void
    {
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $head = User::factory()->departmentHead()->create();
        $director = User::factory()->superAdmin()->create();
        $organization = Organization::factory()->create([
            'college' => $college->name, 'college_id' => $college->id, 'lifecycle_status' => 'active', 'is_active' => true,
            'submitted_by' => $head->school_id, 'reviewed_by' => $director->school_id, 'archived_by' => $director->school_id,
            'review_remarks' => 'internal note', 'gcash_qr_url' => 'https://example.test/qr.png',
        ]);
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']));

        $keys = array_keys($this->getJson('/api/user')->assertOk()->json('organization'));
        sort($keys);

        $this->assertSame(self::VISIBLE, $keys);
    }
}
