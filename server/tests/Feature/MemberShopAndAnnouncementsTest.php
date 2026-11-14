<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Announcement;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * "Give access" as Member leaves the account on the college and adds an active student profile in the organization.
 * That member signs in to the college profile and must still see the shop and the announcements of the organization.
 */
class MemberShopAndAnnouncementsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $home;

    private Organization $guild;

    private Organization $otherClub;

    private User $rina;

    private User $leo;

    private AccountProfile $rinaCollegeProfile;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $college = $this->makeCollege('CCS');
        $this->home = $this->makeCollegeHome($college);
        $this->guild = $this->makeCollegeStudentOrganization($college, ['name' => 'CCS Coders Guild']);
        $this->otherClub = $this->makeCollegeStudentOrganization($college, ['name' => 'Other Club']);

        $this->rina = User::factory()->student()->create(['organization_id' => $this->home->id]);
        $this->rinaCollegeProfile = AccountProfile::where('user_school_id', $this->rina->school_id)->where('organization_id', $this->home->id)->firstOrFail();
        // The profile "Give access" creates for a plain member.
        AccountProfile::create(['user_school_id' => $this->rina->school_id, 'organization_id' => $this->guild->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $this->leo = User::factory()->student()->create(['organization_id' => $this->home->id]);
        AccountProfile::create(['user_school_id' => $this->leo->school_id, 'organization_id' => $this->otherClub->id, 'role' => 'STUDENT', 'account_status' => 'active']);
    }

    /** A request signed in to the member's college profile, as sign in leaves it. */
    private function signedInAsCollege(User $student): static
    {
        $this->app['auth']->forgetGuards();
        $profile = AccountProfile::where('user_school_id', $student->school_id)->where('organization_id', $this->home->id)->firstOrFail();
        $token = $student->createToken('member-shop');
        $token->accessToken->forceFill(['account_profile_id' => $profile->id])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function announcement(Organization $organization, string $title, array $overrides = []): Announcement
    {
        return Announcement::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $this->rina->school_id, 'title' => $title,
            'target_role' => 'all', 'is_published' => true, 'approval_status' => 'approved', ...$overrides,
        ]);
    }

    private function product(Organization $organization, string $name, array $overrides = []): Merchandise
    {
        return Merchandise::factory()->create(['organization_id' => $organization->id, 'name' => $name, 'is_active' => true, 'stock_quantity' => 10, ...$overrides]);
    }

    public function test_a_member_sees_the_published_announcements_of_the_organization_they_belong_to(): void
    {
        $this->announcement($this->guild, 'General Assembly this Friday');
        $this->announcement($this->guild, 'Unpublished plan', ['is_published' => false]);
        $this->announcement($this->otherClub, 'Other club news');

        $titles = collect($this->signedInAsCollege($this->rina)->getJson('/api/announcements')->assertOk()->json('data'))->pluck('title')->all();

        $this->assertSame(['General Assembly this Friday'], $titles);
    }

    public function test_a_student_of_another_club_never_sees_that_clubs_announcements_or_shop(): void
    {
        $post = $this->announcement($this->guild, 'General Assembly this Friday');
        $this->product($this->guild, 'Guild Shirt');
        $this->announcement($this->otherClub, 'Other club news');
        $this->product($this->otherClub, 'Other Club Mug');

        $leo = $this->signedInAsCollege($this->leo);
        $this->assertSame(['Other club news'], collect($leo->getJson('/api/announcements')->assertOk()->json('data'))->pluck('title')->all());
        $this->assertSame(['Other Club Mug'], collect($leo->getJson('/api/merchandise')->assertOk()->json('data'))->pluck('name')->all());
        $leo->postJson("/api/announcements/{$post->id}/view")->assertNotFound();
        $leo->putJson("/api/announcements/{$post->id}/reaction")->assertNotFound();
    }

    public function test_an_inactive_membership_shows_nothing_of_the_organization(): void
    {
        $this->announcement($this->guild, 'General Assembly this Friday');
        $this->product($this->guild, 'Guild Shirt');
        AccountProfile::where('user_school_id', $this->rina->school_id)->where('organization_id', $this->guild->id)->update(['account_status' => 'inactive']);

        $this->assertSame([], $this->signedInAsCollege($this->rina)->getJson('/api/announcements')->assertOk()->json('data'));
        $this->assertSame([], $this->signedInAsCollege($this->rina)->getJson('/api/merchandise')->assertOk()->json('data'));
    }

    public function test_a_member_can_react_to_and_view_an_announcement_of_their_organization(): void
    {
        $post = $this->announcement($this->guild, 'General Assembly this Friday');

        $member = $this->signedInAsCollege($this->rina);
        $member->postJson("/api/announcements/{$post->id}/view")->assertOk();
        $member->putJson("/api/announcements/{$post->id}/reaction")->assertOk();
    }

    public function test_a_member_sees_only_the_active_products_of_the_organization_they_belong_to(): void
    {
        $this->product($this->guild, 'Guild Shirt');
        $this->product($this->guild, 'Retired Cap', ['is_active' => false]);
        $this->product($this->home, 'College Lanyard');
        $this->product($this->otherClub, 'Other Club Mug');

        $items = $this->signedInAsCollege($this->rina)->getJson('/api/merchandise')->assertOk()->json('data');

        $this->assertEqualsCanonicalizing(['Guild Shirt', 'College Lanyard'], collect($items)->pluck('name')->all());
        $this->assertSame('CCS Coders Guild', collect($items)->firstWhere('name', 'Guild Shirt')['organization']['name']);
    }

    public function test_a_member_orders_in_the_organization_that_sells_the_product_and_finds_the_order_again(): void
    {
        $item = $this->product($this->guild, 'Guild Shirt');

        $member = $this->signedInAsCollege($this->rina);
        $orderId = $member->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])
            ->assertCreated()->assertJsonPath('organization_id', $this->guild->id)->json('id');

        $this->assertSame([$orderId], collect($member->getJson('/api/orders')->assertOk()->json('data'))->pluck('id')->all());
        $member->getJson("/api/orders/{$orderId}")->assertOk();
        $member->patchJson("/api/orders/{$orderId}/cancel")->assertOk()->assertJsonPath('status', 'cancelled');
    }

    public function test_a_student_of_another_club_cannot_order_the_product_or_open_the_order(): void
    {
        $item = $this->product($this->guild, 'Guild Shirt');
        $order = Order::factory()->create(['organization_id' => $this->guild->id, 'student_id' => $this->rina->school_id, 'merchandise_id' => $item->id, 'processed_by' => null, 'approved_by' => null]);

        $leo = $this->signedInAsCollege($this->leo);
        $leo->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])->assertStatus(422);
        $leo->getJson("/api/orders/{$order->id}")->assertNotFound();
        $leo->patchJson("/api/orders/{$order->id}/cancel")->assertNotFound();
        $this->assertSame(1, Order::where('merchandise_id', $item->id)->count());
    }

    public function test_gcash_is_paid_only_through_the_signed_in_organization(): void
    {
        $this->guild->forceFill(['gcash_qr_url' => '/uploads/gcash/demo-gcash-qr.png'])->save();
        $item = $this->product($this->guild, 'Guild Shirt');

        $this->signedInAsCollege($this->rina)->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'gcash'])
            ->assertStatus(422)->assertJsonPath('message', fn ($message) => str_contains($message, 'Reserve with cash'));
        $this->assertSame(0, Order::count());
    }
}
