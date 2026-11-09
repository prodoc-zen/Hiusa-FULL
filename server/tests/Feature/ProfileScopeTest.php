<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Announcement;
use App\Models\Election;
use App\Models\Event;
use App\Models\Invoice;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * A student's account lives in the college and each organization they belong to is a student profile of its own.
 * Whichever profile is current decides what the student pages read: the organization profile reads that
 * organization, the college profile reads the college home. A profile the student does not hold reads nothing.
 */
class ProfileScopeTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $home;

    private Organization $psits;

    private Organization $elsewhere;

    private User $student;

    private AccountProfile $collegeProfile;

    private AccountProfile $psitsProfile;

    protected function setUp(): void
    {
        parent::setUp();

        config(['performance.api_cache.enabled' => false]);

        $college = $this->makeCollege('CCS');
        $this->home = $this->makeCollegeHome($college);
        $this->psits = $this->makeCollegeStudentOrganization($college, ['name' => 'PSITS']);
        $this->elsewhere = $this->makeCollegeStudentOrganization($college, ['name' => 'Elsewhere Guild']);

        $this->student = User::factory()->student()->create(['organization_id' => $this->home->id]);
        $this->collegeProfile = AccountProfile::where('user_school_id', $this->student->school_id)->where('organization_id', $this->home->id)->firstOrFail();
        $this->psitsProfile = AccountProfile::create([
            'user_school_id' => $this->student->school_id, 'organization_id' => $this->psits->id, 'role' => 'STUDENT', 'account_status' => 'active',
        ]);
    }

    /** The next requests are made with a token bound to `$profile`, as the profile menu's switch leaves it. */
    private function asProfile(AccountProfile $profile): static
    {
        $this->app['auth']->forgetGuards();
        $token = $this->student->createToken('profile-scope');
        $token->accessToken->forceFill(['account_profile_id' => $profile->id])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function event(Organization $organization, string $title): Event
    {
        return Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $this->student->school_id, 'title' => $title, 'status' => 'approved',
        ]);
    }

    private function announcement(Organization $organization, string $title): Announcement
    {
        return Announcement::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $this->student->school_id, 'title' => $title,
            'target_role' => 'all', 'is_published' => true, 'approval_status' => 'approved',
        ]);
    }

    private function election(Organization $organization, string $title): Election
    {
        return Election::factory()->create([
            'organization_id' => $organization->id, 'title' => $title, 'status' => 'active',
            'start_time' => now()->subHour(), 'end_time' => now()->addHour(),
            'approved_at' => now()->subDay(), 'finalized_at' => now()->subDay(),
        ]);
    }

    public function test_events_follow_the_current_profile(): void
    {
        $this->event($this->home, 'College assembly');
        $this->event($this->psits, 'PSITS hackathon');
        $this->event($this->elsewhere, 'Elsewhere picnic');

        $this->asProfile($this->psitsProfile)->getJson('/api/events')->assertOk()
            ->assertJsonPath('data.0.title', 'PSITS hackathon')->assertJsonCount(1, 'data');

        $this->asProfile($this->collegeProfile)->getJson('/api/events')->assertOk()
            ->assertJsonPath('data.0.title', 'College assembly')->assertJsonCount(1, 'data');
    }

    public function test_announcements_follow_the_current_profile(): void
    {
        $this->announcement($this->home, 'From the college');
        $this->announcement($this->psits, 'From PSITS');
        $this->announcement($this->elsewhere, 'From Elsewhere');

        $this->asProfile($this->psitsProfile)->getJson('/api/announcements?published_only=1')->assertOk()
            ->assertJsonPath('data.0.title', 'From PSITS')->assertJsonCount(1, 'data');

        $this->asProfile($this->collegeProfile)->getJson('/api/announcements?published_only=1')->assertOk()
            ->assertJsonPath('data.0.title', 'From the college')->assertJsonCount(1, 'data');
    }

    public function test_the_store_follows_the_current_profile(): void
    {
        Merchandise::factory()->create(['organization_id' => $this->home->id, 'name' => 'College lanyard', 'is_active' => true]);
        Merchandise::factory()->create(['organization_id' => $this->psits->id, 'name' => 'PSITS shirt', 'is_active' => true]);

        $this->asProfile($this->psitsProfile)->getJson('/api/merchandise')->assertOk()
            ->assertJsonPath('data.0.name', 'PSITS shirt')->assertJsonCount(1, 'data');

        $this->asProfile($this->collegeProfile)->getJson('/api/merchandise')->assertOk()
            ->assertJsonPath('data.0.name', 'College lanyard')->assertJsonCount(1, 'data');
    }

    public function test_orders_and_payments_follow_the_current_profile(): void
    {
        $collegeItem = Merchandise::factory()->create(['organization_id' => $this->home->id]);
        $psitsItem = Merchandise::factory()->create(['organization_id' => $this->psits->id]);
        $collegeOrder = Order::factory()->create(['organization_id' => $this->home->id, 'student_id' => $this->student->school_id, 'merchandise_id' => $collegeItem->id, 'processed_by' => null, 'approved_by' => null]);
        $psitsOrder = Order::factory()->create(['organization_id' => $this->psits->id, 'student_id' => $this->student->school_id, 'merchandise_id' => $psitsItem->id, 'processed_by' => null, 'approved_by' => null]);
        foreach ([$this->home, $this->psits] as $organization) {
            Invoice::create([
                'organization_id' => $organization->id, 'reference' => 'INV-'.Str::upper(Str::random(8)), 'student_id' => $this->student->school_id,
                'description' => $organization->name.' fee', 'amount_due' => '100.00', 'status' => 'unpaid',
            ]);
        }

        $orders = $this->asProfile($this->psitsProfile)->getJson('/api/orders')->assertOk();
        $this->assertSame([$psitsOrder->id], collect($orders->json('data'))->pluck('id')->all());
        $this->assertSame(['PSITS fee'], collect($this->getJson('/api/invoices')->assertOk()->json())->pluck('description')->all());

        $orders = $this->asProfile($this->collegeProfile)->getJson('/api/orders')->assertOk();
        $this->assertSame([$collegeOrder->id], collect($orders->json('data'))->pluck('id')->all());
        $this->assertSame([$this->home->name.' fee'], collect($this->getJson('/api/invoices')->assertOk()->json())->pluck('description')->all());
    }

    public function test_the_other_profiles_order_cannot_be_opened(): void
    {
        $psitsItem = Merchandise::factory()->create(['organization_id' => $this->psits->id]);
        $psitsOrder = Order::factory()->create(['organization_id' => $this->psits->id, 'student_id' => $this->student->school_id, 'merchandise_id' => $psitsItem->id, 'processed_by' => null, 'approved_by' => null]);

        $this->asProfile($this->collegeProfile)->getJson("/api/orders/{$psitsOrder->id}")->assertNotFound();
        $this->asProfile($this->psitsProfile)->getJson("/api/orders/{$psitsOrder->id}")->assertOk();
    }

    public function test_voting_follows_the_current_profile(): void
    {
        AccountProfile::create(['user_school_id' => $this->student->school_id, 'organization_id' => $this->elsewhere->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $psitsElection = $this->election($this->psits, 'PSITS officers');
        $elsewhereElection = $this->election($this->elsewhere, 'Elsewhere officers');

        $elections = $this->asProfile($this->psitsProfile)->getJson('/api/elections')->assertOk();
        $this->assertSame([$psitsElection->id], collect($elections->json())->pluck('id')->all());
        $this->getJson("/api/elections/{$elsewhereElection->id}")->assertNotFound();

        $feed = $this->getJson('/api/student/feed')->assertOk();
        $this->assertSame(
            [$psitsElection->id],
            collect($feed->json('items'))->where('type', 'election')->pluck('data.id')->values()->all(),
        );
    }

    public function test_the_college_profile_lists_the_elections_of_the_organizations_the_student_belongs_to(): void
    {
        $psitsElection = $this->election($this->psits, 'PSITS officers');
        $homeElection = $this->election($this->home, 'College council');
        $elsewhereElection = $this->election($this->elsewhere, 'Elsewhere officers');

        $ids = collect($this->asProfile($this->collegeProfile)->getJson('/api/elections')->assertOk()->json())->pluck('id')->all();

        $this->assertEqualsCanonicalizing([$psitsElection->id, $homeElection->id], $ids);
        $this->assertNotContains($elsewhereElection->id, $ids);
    }

    public function test_a_student_cannot_switch_to_a_profile_they_do_not_hold(): void
    {
        $stranger = User::factory()->student()->create(['organization_id' => $this->elsewhere->id]);
        $strangerProfile = AccountProfile::where('user_school_id', $stranger->school_id)->firstOrFail();

        $this->asProfile($this->collegeProfile)->postJson("/api/user/profiles/{$strangerProfile->id}/switch")->assertNotFound();
    }

    public function test_an_inactive_profile_reads_nothing(): void
    {
        $this->election($this->psits, 'PSITS officers');
        $this->psitsProfile->update(['account_status' => 'inactive']);

        $this->asProfile($this->collegeProfile)->getJson('/api/elections')->assertOk()->assertJsonCount(0);
        $this->asProfile($this->psitsProfile)->getJson('/api/events')->assertForbidden();
    }
}
