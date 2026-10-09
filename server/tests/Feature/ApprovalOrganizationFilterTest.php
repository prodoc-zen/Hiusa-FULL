<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ApprovalOrganizationFilterTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private User $head;

    private Organization $first;

    private Organization $second;

    private Organization $foreign;

    protected function setUp(): void
    {
        parent::setUp();
        $computing = $this->makeCollege('CCS');
        $business = $this->makeCollege('CBE');
        $this->head = $this->makeCollegeHead($computing);
        $this->first = $this->makeCollegeStudentOrganization($computing);
        $this->second = $this->makeCollegeStudentOrganization($computing);
        $this->foreign = $this->makeCollegeStudentOrganization($business);
        $this->makeCollegeHead($business);
    }

    private function pendingEventApproval(Organization $organization, string $status = 'pending'): ApprovalRequest
    {
        $requester = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $event = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $requester->id, 'status' => 'planning']);

        return ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'event',
            'entity_id' => $event->id,
            'requested_by' => $requester->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => $status,
            'requested_at' => now()->subHour(),
        ]);
    }

    private function ids(string $query): array
    {
        return collect($this->getJson('/api/approval-requests'.$query)->assertOk()->json('data'))->pluck('id')->all();
    }

    public function test_a_head_narrows_the_list_and_its_totals_to_one_organization_on_the_server(): void
    {
        $inFirst = [$this->pendingEventApproval($this->first), $this->pendingEventApproval($this->first)];
        $inSecond = $this->pendingEventApproval($this->second);
        $reviewedInFirst = $this->pendingEventApproval($this->first, 'approved');
        $this->pendingEventApproval($this->foreign);
        Sanctum::actingAs($this->head);

        $this->assertCount(4, $this->ids('?status=all'));

        $filtered = $this->getJson("/api/approval-requests?organization_id={$this->first->id}")->assertOk();
        $this->assertEqualsCanonicalizing(collect($inFirst)->pluck('id')->all(), collect($filtered->json('data'))->pluck('id')->all());
        $filtered->assertJsonPath('total', 2);

        $this->assertEqualsCanonicalizing(
            [...collect($inFirst)->pluck('id')->all(), $reviewedInFirst->id],
            $this->ids("?status=all&organization_id={$this->first->id}"),
        );
        $this->assertSame([$inSecond->id], $this->ids("?organization_id={$this->second->id}"));
    }

    public function test_the_filter_pages_from_the_server(): void
    {
        foreach (range(1, 3) as $ignored) {
            $this->pendingEventApproval($this->first);
        }
        $this->pendingEventApproval($this->second);
        Sanctum::actingAs($this->head);

        $page = $this->getJson("/api/approval-requests?organization_id={$this->first->id}&per_page=2&page=2")->assertOk();

        $this->assertSame(3, $page->json('total'));
        $this->assertSame(2, $page->json('last_page'));
        $this->assertCount(1, $page->json('data'));
    }

    public function test_an_organization_outside_the_heads_college_is_refused(): void
    {
        $this->pendingEventApproval($this->foreign);
        Sanctum::actingAs($this->head);

        $this->getJson("/api/approval-requests?organization_id={$this->foreign->id}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('organization_id');
        $this->getJson('/api/approval-requests?organization_id=999999')->assertUnprocessable()->assertJsonValidationErrors('organization_id');
        $this->getJson('/api/approval-requests?organization_id=abc')->assertUnprocessable()->assertJsonValidationErrors('organization_id');
    }

    public function test_other_roles_keep_their_own_scope_and_ignore_the_filter(): void
    {
        $own = $this->pendingEventApproval($this->first);
        $this->pendingEventApproval($this->second);
        $admin = User::factory()->admin()->create(['organization_id' => $this->first->id]);
        ApprovalRequest::where('id', $own->id)->update(['required_role' => 'ADMIN']);
        ApprovalRequest::where('organization_id', $this->second->id)->update(['required_role' => 'ADMIN']);
        Sanctum::actingAs($admin);

        $this->assertSame([$own->id], $this->ids("?organization_id={$this->second->id}"));
    }
}
