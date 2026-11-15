<?php

namespace Tests\Concerns;

use App\Models\ApprovalRequest;
use App\Models\Organization;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

trait FinishesEventApproval
{
    /**
     * The route is organization, Department Head, organization, SAO. Once the Department Head approved, the
     * organization Admin sends the event on and the SAO approves it, which is what makes the event approved.
     */
    private function sendEventToSaoAndApprove(int $eventId, User $admin): void
    {
        Sanctum::actingAs($admin);
        $this->postJson('/api/events/'.$eventId.'/submission')->assertOk();

        $director = User::factory()->superAdmin()->create([
            'organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id,
        ]);
        $row = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'SUPER_ADMIN')->firstOrFail();
        Sanctum::actingAs($director);
        $this->patchJson('/api/approval-requests/'.$row->id, ['status' => 'approved'])->assertOk();
    }
}
