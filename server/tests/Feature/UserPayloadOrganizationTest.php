<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * GET /api/user and GET /api/users hand every member of an organization the organization row, so the
 * row they carry is a whitelist: the reviewer's and submitter's school ids (login identifiers) and the
 * SAO's private remarks stay on the server, wherever in the payload the row is nested.
 */
class UserPayloadOrganizationTest extends TestCase
{
    use RefreshDatabase;

    private const VISIBLE = [
        'acronym', 'college', 'college_id', 'color', 'id', 'is_active', 'is_university_wide', 'lifecycle_status', 'logo_url',
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

    public function test_an_officer_and_a_department_head_receive_the_same_whitelisted_organization_columns(): void
    {
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $director = User::factory()->superAdmin()->create();
        $private = [
            'submitted_by' => $director->school_id, 'reviewed_by' => $director->school_id, 'archived_by' => $director->school_id,
            'review_remarks' => 'internal note', 'gcash_qr_url' => 'https://example.test/qr.png',
        ];
        $organization = Organization::factory()->create([
            'college' => $college->name, 'college_id' => $college->id, 'lifecycle_status' => 'active', 'is_active' => true, ...$private,
        ]);
        $home = Organization::factory()->create([
            'name' => $college->name, 'college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE', ...$private,
        ]);
        $callers = [
            User::factory()->officer()->create(['organization_id' => $organization->id, 'account_status' => 'active']),
            User::factory()->departmentHead()->create(['organization_id' => $home->id, 'account_status' => 'active']),
        ];

        foreach ($callers as $caller) {
            Sanctum::actingAs($caller);
            $json = $this->getJson('/api/user')->assertOk()->json();

            $this->assertSame(self::VISIBLE, $this->sortedKeys($json['organization']), $caller->role.' received organization columns beyond the whitelist');
            $this->assertSame([], $this->leakedKeys($json), $caller->role.' received reviewer fields from /api/user');
        }
    }

    public function test_the_member_directory_carries_no_reviewer_field_on_any_nested_organization(): void
    {
        $head = User::factory()->departmentHead()->create();
        $director = User::factory()->superAdmin()->create();
        $organization = Organization::factory()->create([
            'lifecycle_status' => 'active', 'is_active' => true,
            'submitted_by' => $head->school_id, 'reviewed_by' => $director->school_id, 'archived_by' => $director->school_id,
            'review_remarks' => 'zz-private-remark', 'gcash_qr_url' => 'https://example.test/qr.png',
        ]);
        User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id, 'account_status' => 'active']);

        foreach ([$officer, $admin] as $caller) {
            Sanctum::actingAs($caller);
            $payload = $this->getJson('/api/users')->assertOk()->json('data');

            $this->assertNotEmpty($payload);
            $this->assertSame([], $this->leakedKeys($payload), $caller->role.' received reviewer fields from /api/users');
            $this->assertSame(self::VISIBLE, $this->sortedKeys($payload[0]['account_profiles'][0]['organization']));
        }
    }

    /** @return array<int, string> */
    private function sortedKeys(array $node): array
    {
        $keys = array_keys($node);
        sort($keys);

        return $keys;
    }

    /** @return array<int, string> */
    private function leakedKeys(mixed $node): array
    {
        $private = ['submitted_by', 'reviewed_by', 'archived_by', 'review_remarks', 'gcash_qr_url'];
        $found = [];

        foreach ((array) $node as $key => $value) {
            if (in_array($key, $private, true)) {
                $found[] = $key;
            }
            if (is_array($value)) {
                $found = [...$found, ...$this->leakedKeys($value)];
            }
        }

        return array_values(array_unique($found));
    }
}
