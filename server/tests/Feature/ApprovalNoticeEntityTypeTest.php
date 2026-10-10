<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ApprovalNoticeEntityTypeTest extends TestCase
{
    use RefreshDatabase;

    private const ENTITY_TYPES = ['event', 'financial_report', 'budget', 'election', 'announcement', 'payment'];

    private function approvalFor(Organization $organization, User $requester, string $entityType, int $entityId, string $requiredRole = 'ADMIN'): ApprovalRequest
    {
        return ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'requested_by' => $requester->school_id,
            'required_role' => $requiredRole,
            'status' => 'pending',
        ]);
    }

    public function test_approver_notices_name_the_entity_type_and_keep_the_general_notification_type(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        foreach (self::ENTITY_TYPES as $index => $entityType) {
            $approval = $this->approvalFor($organization, $officer, $entityType, 100 + $index);

            $this->assertDatabaseHas('notifications', [
                'user_id' => $admin->school_id,
                'reference_type' => 'approval_request',
                'reference_id' => $approval->id,
                'notification_type' => 'general',
                'entity_type' => $entityType,
            ]);
        }

        $this->assertSame(count(self::ENTITY_TYPES), Notification::where('user_id', $admin->school_id)->count());
    }

    public function test_the_sao_notices_carry_the_entity_type_too(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $organization = Organization::factory()->create();
        $requester = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id, 'account_status' => 'active']);

        $report = $this->approvalFor($organization, $requester, 'financial_report', 7, 'SUPER_ADMIN');
        $event = $this->approvalFor($organization, $requester, 'event', 8, 'SUPER_ADMIN');

        $this->assertSame('financial_report', Notification::where('user_id', $director->school_id)->where('reference_id', $report->id)->value('entity_type'));
        $this->assertSame('event', Notification::where('user_id', $director->school_id)->where('reference_id', $event->id)->value('entity_type'));

        Sanctum::actingAs($director);
        $rows = collect($this->getJson('/api/notifications')->assertOk()->json('data'))->keyBy('reference_id');
        $this->assertSame('financial_report', $rows[$report->id]['entity_type']);
        $this->assertSame('event', $rows[$event->id]['entity_type']);
    }

    public function test_muting_every_mutable_type_still_shows_approval_notices_of_every_entity_type(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        foreach (self::ENTITY_TYPES as $index => $entityType) {
            $this->approvalFor($organization, $officer, $entityType, 200 + $index);
        }

        Sanctum::actingAs($admin);
        $this->putJson('/api/user/notification-preferences', ['muted' => Notification::MUTABLE_TYPES])->assertOk();

        $response = $this->getJson('/api/notifications')->assertOk();
        $shown = array_column($response->json('data'), 'entity_type');
        sort($shown);
        $expected = self::ENTITY_TYPES;
        sort($expected);

        $this->assertSame($expected, $shown);
        $this->assertSame(count(self::ENTITY_TYPES), $response->json('unread_count'));
        foreach ($response->json('data') as $row) {
            $this->assertNotContains($row['notification_type'], Notification::MUTABLE_TYPES);
        }
    }
}
