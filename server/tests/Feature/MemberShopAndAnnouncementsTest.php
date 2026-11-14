<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Announcement;
use App\Models\College;
use App\Models\Grievance;
use App\Models\Invoice;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
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
            ->assertStatus(422)->assertJsonPath('message', 'GCash is paid through CCS Coders Guild, which sells this product. Reserve with cash, or switch to your CCS Coders Guild profile to pay with GCash.');
        $this->assertSame(0, Order::count());
    }

    private function invoice(User $student, Organization $organization, string $description, string $amount = '150.00'): Invoice
    {
        return Invoice::create([
            'organization_id' => $organization->id, 'reference' => 'INV-'.Str::upper(Str::random(8)), 'student_id' => $student->school_id,
            'description' => $description, 'amount_due' => $amount, 'status' => 'unpaid',
        ]);
    }

    public function test_a_member_sees_their_own_invoices_receipts_and_debt_from_every_organization_they_belong_to(): void
    {
        $this->invoice($this->rina, $this->guild, 'Guild fee');
        $this->invoice($this->rina, $this->home, 'College fee', '50.00');
        $this->invoice($this->leo, $this->guild, 'Leo guild fee');
        $this->invoice($this->rina, $this->otherClub, 'Other club fee');
        $admin = User::factory()->admin()->create(['organization_id' => $this->guild->id]);
        foreach ([[$this->rina, $this->guild, 'RINA-GUILD'], [$this->leo, $this->guild, 'LEO-GUILD'], [$this->rina, $this->otherClub, 'RINA-OTHER']] as [$payer, $organization, $reference]) {
            Transaction::create([
                'organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'payer_id' => $payer->school_id, 'type' => 'income',
                'category' => 'Fees', 'description' => $reference, 'amount' => 100, 'receipt_reference' => $reference, 'transaction_date' => now(),
            ]);
        }

        $member = $this->signedInAsCollege($this->rina);
        $this->assertEqualsCanonicalizing(['Guild fee', 'College fee'], collect($member->getJson('/api/invoices')->assertOk()->json())->pluck('description')->all());
        $this->assertSame(['RINA-GUILD'], collect($member->getJson('/api/transactions/personal-receipts')->assertOk()->json())->pluck('receipt_reference')->all());
        $debt = $member->getJson('/api/student-debts')->assertOk()->json('data.0');
        $this->assertEquals(200.0, $debt['total_debt']);
        $this->assertSame(2, $debt['unpaid_invoice_count']);
    }

    public function test_the_assistant_does_not_tell_a_member_with_an_open_club_fee_that_they_owe_nothing(): void
    {
        $this->invoice($this->rina, $this->guild, 'Guild fee');

        $rows = $this->signedInAsCollege($this->rina)->postJson('/api/ai/assistant/ask', ['question' => 'What should I do today?', 'topic' => 'daily_priorities'])
            ->assertOk()->json('sections.0.rows');

        $this->assertContains('stu-fees', collect($rows)->pluck('id')->all());
    }

    public function test_a_grievance_filed_to_my_organization_goes_to_the_only_club_the_member_belongs_to(): void
    {
        $this->signedInAsCollege($this->rina)->postJson('/api/grievances', ['title' => 'Broken door', 'description' => 'The door is broken.', 'addressed_to' => 'organization'])->assertCreated();

        $this->assertSame($this->guild->id, Grievance::where('submitted_by', $this->rina->school_id)->value('organization_id'));
        $this->signedInAsCollege($this->rina)->getJson('/api/grievances/filing-options')->assertOk()->assertJsonCount(1)->assertJsonPath('0.id', $this->guild->id);
    }

    public function test_a_member_of_several_clubs_must_choose_one_they_belong_to(): void
    {
        $third = $this->makeCollegeStudentOrganization($this->home->catalogCollege, ['name' => 'Third Club']);
        AccountProfile::create(['user_school_id' => $this->rina->school_id, 'organization_id' => $third->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $payload = ['title' => 'Broken door', 'description' => 'The door is broken.', 'addressed_to' => 'organization'];

        $member = $this->signedInAsCollege($this->rina);
        $member->getJson('/api/grievances/filing-options')->assertOk()->assertJsonCount(2);
        $member->postJson('/api/grievances', $payload)->assertStatus(422)->assertJsonValidationErrors('organization_id');
        $member->postJson('/api/grievances', [...$payload, 'organization_id' => $this->otherClub->id])->assertStatus(422)->assertJsonValidationErrors('organization_id');
        $member->postJson('/api/grievances', [...$payload, 'organization_id' => $third->id])->assertCreated();

        $this->assertSame([$third->id], Grievance::where('submitted_by', $this->rina->school_id)->pluck('organization_id')->all());
    }

    /** A club in another college that the member belongs to; the college is archived afterwards. */
    private function clubInArchivedCollege(): Organization
    {
        $other = $this->makeCollege('CAS');
        $club = $this->makeCollegeStudentOrganization($other, ['name' => 'CAS Debate Club']);
        AccountProfile::create(['user_school_id' => $this->rina->school_id, 'organization_id' => $club->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $other->forceFill(['is_active' => false])->save();

        return $club;
    }

    public function test_a_club_in_an_archived_college_is_not_one_the_member_belongs_to(): void
    {
        $club = $this->clubInArchivedCollege();
        $archivedItem = $this->product($club, 'Debate Shirt');
        $this->product($this->guild, 'Guild Shirt');
        $order = Order::factory()->create(['organization_id' => $club->id, 'student_id' => $this->rina->school_id, 'merchandise_id' => $archivedItem->id, 'processed_by' => null, 'approved_by' => null]);
        AccountProfile::create(['user_school_id' => $this->rina->school_id, 'organization_id' => $this->otherClub->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $member = $this->signedInAsCollege($this->rina);

        $this->assertNotContains($club->id, $this->rina->memberOrganizationIds());
        $this->assertSame(['Guild Shirt'], collect($member->getJson('/api/merchandise')->assertOk()->json('data'))->pluck('name')->all());
        $this->assertNotContains($order->id, collect($member->getJson('/api/orders')->assertOk()->json('data'))->pluck('id')->all());
        $this->assertNotContains($club->id, collect($member->getJson('/api/grievances/filing-options')->assertOk()->json())->pluck('id')->all());
    }

    public function test_a_member_whose_only_club_sits_in_an_archived_college_is_not_in_a_student_organization(): void
    {
        $other = $this->makeCollege('CAS');
        $club = $this->makeCollegeStudentOrganization($other, ['name' => 'CAS Debate Club']);
        $newcomer = User::factory()->student()->create(['organization_id' => $this->home->id]);
        AccountProfile::create(['user_school_id' => $newcomer->school_id, 'organization_id' => $club->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $this->signedInAsCollege($newcomer)->getJson('/api/user')->assertOk()->assertJsonPath('in_student_organization', true);

        College::whereKey($other->id)->update(['is_active' => false]);

        $this->signedInAsCollege($newcomer)->getJson('/api/user')->assertOk()->assertJsonPath('in_student_organization', false);
    }

    public function test_a_club_officer_signed_in_on_the_college_profile_sees_the_clubs_shop(): void
    {
        $this->product($this->guild, 'Guild Shirt');
        $officer = User::factory()->student()->create(['organization_id' => $this->home->id]);
        AccountProfile::create(['user_school_id' => $officer->school_id, 'organization_id' => $this->guild->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);

        $names = collect($this->signedInAsCollege($officer)->getJson('/api/merchandise')->assertOk()->json('data'))->pluck('name')->all();

        $this->assertSame(['Guild Shirt'], $names);
        $this->signedInAsCollege($officer)->getJson('/api/user')->assertOk()->assertJsonPath('in_student_organization', true);
    }

    public function test_submitting_gcash_proof_from_the_college_profile_names_the_selling_club_even_when_the_college_has_no_qr(): void
    {
        $item = $this->product($this->guild, 'Guild Shirt');
        $order = Order::factory()->create(['organization_id' => $this->guild->id, 'student_id' => $this->rina->school_id, 'merchandise_id' => $item->id, 'status' => 'pending', 'officer_review_status' => 'pending', 'processed_by' => null, 'approved_by' => null]);

        $this->signedInAsCollege($this->rina)->post("/api/orders/{$order->id}/payment", [
            'payment_reference' => '1234567890123',
            'payment_proof' => UploadedFile::fake()->image('proof.png'),
        ], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('message', fn ($message) => str_contains($message, 'GCash is paid through CCS Coders Guild') && str_contains($message, 'switch to your CCS Coders Guild profile'));
    }

    public function test_another_student_asking_for_a_payment_proof_gets_the_same_not_found_as_a_missing_order(): void
    {
        $item = $this->product($this->guild, 'Guild Shirt');
        $order = Order::factory()->create(['organization_id' => $this->guild->id, 'student_id' => $this->rina->school_id, 'merchandise_id' => $item->id, 'payment_proof_url' => 'payment-proofs/00000000-0000-0000-0000-000000000000.png', 'processed_by' => null, 'approved_by' => null]);
        AccountProfile::create(['user_school_id' => $this->leo->school_id, 'organization_id' => $this->guild->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $this->signedInAsCollege($this->leo)->getJson("/api/orders/{$order->id}/payment-proof")->assertNotFound()->assertJsonPath('message', 'Order not found.');
    }
}
