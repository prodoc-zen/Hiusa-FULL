<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A student signed in to their college profile still sees what was filed under a club they belong to or bought from:
 * the Payment Approved claim token, an election result, a granted profile. A club they are not in stays out of the bell,
 * and nobody ever reaches another person's rows.
 */
class StudentClubNotificationVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $college;

    private Organization $club;

    private Organization $strangerClub;

    private User $student;

    protected function setUp(): void
    {
        parent::setUp();
        $this->college = Organization::factory()->create(['organization_type' => 'COLLEGE']);
        $this->club = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'parent_organization_id' => $this->college->id]);
        $this->strangerClub = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'parent_organization_id' => $this->college->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->college->id]);
        $this->student->accountProfiles()->create(['organization_id' => $this->club->id, 'role' => 'STUDENT', 'account_status' => 'active']);
    }

    private function notify(User $user, Organization $organization, string $title = 'Payment Approved'): Notification
    {
        return Notification::create([
            'organization_id' => $organization->id,
            'user_id' => $user->school_id,
            'notification_type' => 'financial',
            'title' => $title,
            'message' => $title,
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }

    public function test_a_college_profile_lists_a_notice_filed_under_a_club_the_student_belongs_to(): void
    {
        $inClub = $this->notify($this->student, $this->club);
        $atCollege = $this->notify($this->student, $this->college, 'Hello');
        Sanctum::actingAs($this->student);

        $listed = $this->getJson('/api/notifications')->assertOk();
        $this->assertEqualsCanonicalizing([$inClub->id, $atCollege->id], collect($listed->json('data'))->pluck('id')->all());
        $this->assertSame(2, $listed->json('unread_count'));
    }

    public function test_a_college_profile_marks_a_club_notice_read_one_at_a_time_and_all_at_once(): void
    {
        $first = $this->notify($this->student, $this->club);
        $second = $this->notify($this->student, $this->club, 'You won');
        Sanctum::actingAs($this->student);

        $this->patchJson('/api/notifications/'.$first->id.'/read')->assertOk()->assertJsonPath('is_read', true);
        $this->assertFalse($second->fresh()->is_read);

        $this->patchJson('/api/notifications/read-all')->assertOk();
        $this->assertTrue($second->fresh()->is_read);
    }

    public function test_the_briefing_unread_count_includes_a_club_notice_for_a_college_profile(): void
    {
        $this->notify($this->student, $this->club);
        $this->notify($this->student, $this->college, 'Hello');
        Sanctum::actingAs($this->student);

        $this->assertStringContainsString('2 unread notification(s)', $this->getJson('/api/dashboard/briefing')->assertOk()->json('pillars.communication.context'));
    }

    public function test_a_notice_filed_under_a_club_the_student_is_not_in_stays_hidden_and_unmarked(): void
    {
        // The student has no standing in that club, so even a row addressed to them there is not shown to them.
        $outside = $this->notify($this->student, $this->strangerClub);
        Sanctum::actingAs($this->student);

        $this->assertSame([], $this->getJson('/api/notifications')->assertOk()->json('data'));
        $this->patchJson('/api/notifications/'.$outside->id.'/read')->assertNotFound();
        $this->patchJson('/api/notifications/read-all')->assertOk();
        $this->assertFalse($outside->fresh()->is_read);
        $this->assertStringContainsString('0 unread notification(s)', $this->getJson('/api/dashboard/briefing')->json('pillars.communication.context'));
    }

    public function test_another_students_notice_in_a_shared_club_is_never_visible_or_markable(): void
    {
        $classmate = User::factory()->student()->create(['organization_id' => $this->college->id]);
        $classmate->accountProfiles()->create(['organization_id' => $this->club->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $theirs = $this->notify($classmate, $this->club);
        Sanctum::actingAs($this->student);

        $this->assertSame([], $this->getJson('/api/notifications')->assertOk()->json('data'));
        $this->patchJson('/api/notifications/'.$theirs->id.'/read')->assertNotFound();
        $this->patchJson('/api/notifications/read-all')->assertOk();
        $this->assertFalse($theirs->fresh()->is_read);
        $this->assertStringContainsString('0 unread notification(s)', $this->getJson('/api/dashboard/briefing')->json('pillars.communication.context'));
    }

    public function test_a_club_profile_still_reads_only_its_own_club(): void
    {
        $clubProfileUser = User::factory()->student()->create(['organization_id' => $this->club->id]);
        $atClub = $this->notify($clubProfileUser, $this->club);
        $this->notify($clubProfileUser, $this->college, 'College notice');
        Sanctum::actingAs($clubProfileUser);

        $this->assertSame([$atClub->id], collect($this->getJson('/api/notifications')->assertOk()->json('data'))->pluck('id')->all());
    }

    public function test_an_officer_still_reads_only_the_active_organization(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->club->id]);
        $own = $this->notify($officer, $this->club);
        $this->notify($officer, $this->strangerClub, 'Elsewhere');
        Sanctum::actingAs($officer);

        $this->assertSame([$own->id], collect($this->getJson('/api/notifications')->assertOk()->json('data'))->pluck('id')->all());
    }

    public function test_claiming_a_paid_order_notifies_the_buyer_once_under_the_selling_club(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->club->id]);
        $item = Merchandise::factory()->create(['organization_id' => $this->club->id]);
        $order = Order::create([
            'organization_id' => $this->club->id, 'student_id' => $this->student->school_id,
            'merchandise_id' => $item->id, 'quantity' => 1, 'unit_price' => 75,
            'total_price' => 75, 'status' => 'paid', 'payment_method' => 'cash',
            'claim_token' => 'CLAIMTOKEN000003', 'approved_by' => $officer->school_id,
        ]);

        Sanctum::actingAs($officer);
        $this->postJson('/api/orders/claim', ['claim_token' => $order->claim_token])->assertOk()->assertJsonPath('status', 'claimed');
        $this->postJson('/api/orders/claim', ['claim_token' => $order->claim_token])->assertStatus(409);

        $released = Notification::where('title', 'Order released')->get();
        $this->assertCount(1, $released);
        $this->assertSame($this->student->school_id, (int) $released->first()->user_id);
        $this->assertSame($this->club->id, (int) $released->first()->organization_id);
        $this->assertSame(Order::class, $released->first()->reference_type);
        $this->assertSame($order->id, (int) $released->first()->reference_id);

        Sanctum::actingAs($this->student);
        $this->assertContains('Order released', collect($this->getJson('/api/notifications')->assertOk()->json('data'))->pluck('title')->all());
    }

    public function test_a_refused_claim_creates_no_notice(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->club->id]);
        $item = Merchandise::factory()->create(['organization_id' => $this->club->id]);
        $order = Order::create([
            'organization_id' => $this->club->id, 'student_id' => $this->student->school_id,
            'merchandise_id' => $item->id, 'quantity' => 1, 'total_price' => 75,
            'status' => 'pending', 'payment_method' => 'cash', 'claim_token' => 'CLAIMTOKEN000004',
        ]);

        Sanctum::actingAs($officer);
        $this->postJson('/api/orders/claim', ['claim_token' => $order->claim_token])->assertUnprocessable();

        $this->assertSame(0, Notification::where('title', 'Order released')->count());
    }
}
