<?php

namespace Tests\Feature;

use App\Console\Commands\SendRenewalReminders;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\Notification;
use App\Models\OfficerAppointment;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Support\RenewalDeadline;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The renewal tracker reads Compliance and stores nothing of its own, and the daily reminder reaches the officers of
 * every organization that has not yet submitted a renewal requirement due in seven days.
 */
class RenewalTrackerTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $officer;

    private User $student;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
    }

    private function type(string $name, $deadline, array $overrides = []): ComplianceRequirementType
    {
        return ComplianceRequirementType::create([
            'category' => 'renewal',
            'academic_year' => '2026-2027',
            'name' => $name,
            'deadline_at' => $deadline,
            'is_active' => true,
            'created_by' => $this->admin->school_id,
            ...$overrides,
        ]);
    }

    private function submit(Organization $organization, ComplianceRequirementType $type, string $status = 'submitted'): OrganizationComplianceSubmission
    {
        return OrganizationComplianceSubmission::create([
            'organization_id' => $organization->id,
            'requirement_type_id' => $type->id,
            'status' => $status,
            'file_path' => 'compliance/x.pdf',
            'file_original_name' => 'x.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 800,
            'submitted_by' => $this->admin->school_id,
            'submitted_at' => now(),
        ]);
    }

    private function appointment(User $user, array $overrides = []): OfficerAppointment
    {
        return OfficerAppointment::factory()->create([
            'organization_id' => $this->organization->id,
            'election_id' => Election::factory()->create(['organization_id' => $this->organization->id, 'status' => 'closed'])->id,
            'user_school_id' => $user->school_id,
            ...$overrides,
        ]);
    }

    public function test_the_official_deadline_is_the_earliest_future_renewal_deadline_in_compliance(): void
    {
        $this->type('Past renewal', now()->subDays(3));
        $this->type('Later renewal', now()->addDays(60));
        $soonest = $this->type('Soon renewal', now()->addDays(20));
        $this->type('Retired renewal', now()->addDays(5), ['is_active' => false]);
        $this->type('Not a renewal', now()->addDays(2), ['category' => 'organization']);

        $deadline = RenewalDeadline::for($this->organization->id);

        $this->assertTrue($soonest->deadline_at->equalTo($deadline));
    }

    public function test_there_is_no_deadline_when_compliance_has_none_in_the_future(): void
    {
        $this->type('Past renewal', now()->subDays(3));

        $this->assertNull(RenewalDeadline::for($this->organization->id));
    }

    public function test_the_tracker_deadline_equals_compliance_and_follows_a_change_there(): void
    {
        $type = $this->type('Renewal of accreditation', now()->addDays(30)->startOfSecond());
        Sanctum::actingAs($this->admin);

        $first = $this->getJson('/api/officer-transition/renewal')->assertOk()->json();
        $this->assertTrue(now()->addDays(30)->isSameDay($first['deadline_at']));

        $type->update(['deadline_at' => now()->addDays(12)]);

        $second = $this->getJson('/api/officer-transition/renewal')->assertOk()->json();
        $this->assertTrue(now()->addDays(12)->isSameDay($second['deadline_at']));
    }

    public function test_the_tracker_reports_overdue_requirements_and_progress(): void
    {
        $submitted = $this->type('Constitution', now()->addDays(10));
        $approved = $this->type('Plan of activities', now()->addDays(10));
        $returned = $this->type('Financial plan', now()->addDays(10));
        $overdue = $this->type('Roster', now()->subDay());
        $this->type('Future', now()->addDays(40));
        $this->submit($this->organization, $submitted, 'submitted');
        $this->submit($this->organization, $approved, 'approved');
        $this->submit($this->organization, $returned, 'returned');
        Sanctum::actingAs($this->admin);

        $body = $this->getJson('/api/officer-transition/renewal')->assertOk()->json();

        $this->assertSame(['done' => 2, 'total' => 5], $body['progress']);
        $rows = collect($body['requirements'])->keyBy('name');
        $this->assertSame('submitted', $rows['Constitution']['status']);
        $this->assertSame('approved', $rows['Plan of activities']['status']);
        $this->assertSame('returned', $rows['Financial plan']['status']);
        $this->assertSame('not_submitted', $rows['Roster']['status']);
        $this->assertTrue($rows['Roster']['overdue']);
        $this->assertFalse($rows['Constitution']['overdue']);
        $this->assertFalse($rows['Future']['overdue']);
        $this->assertTrue($rows['Financial plan']['overdue'] === false);
        $this->assertNotNull($rows['Constitution']['submitted_at']);
        $this->assertSame($overdue->id, $rows['Roster']['id']);
        $this->assertNotNull($body['last_updated']);
    }

    public function test_another_organizations_submissions_do_not_count(): void
    {
        $type = $this->type('Constitution', now()->addDays(10));
        $other = $this->makeCollegeStudentOrganization(College::find($this->organization->college_id));
        $this->submit($other, $type);
        Sanctum::actingAs($this->admin);

        $body = $this->getJson('/api/officer-transition/renewal')->assertOk()->json();

        $this->assertSame(['done' => 0, 'total' => 1], $body['progress']);
        $this->assertNull($body['last_updated']);
    }

    public function test_the_tracker_lists_incoming_admins_who_are_active_or_upcoming(): void
    {
        $president = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'first_name' => 'Pia', 'last_name' => 'Reyes']);
        $upcoming = User::factory()->student()->create(['organization_id' => $this->organization->id, 'first_name' => 'Ulo', 'last_name' => 'Cruz']);
        $secretary = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $former = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->appointment($president, ['position_title' => 'President', 'role' => 'ADMIN', 'status' => 'active']);
        $this->appointment($upcoming, ['position_title' => 'Vice President for Internal Affairs', 'role' => 'ADMIN', 'status' => 'upcoming']);
        $this->appointment($secretary, ['role' => 'SBO_OFFICER', 'status' => 'active']);
        $this->appointment($former, ['role' => 'ADMIN', 'status' => 'ended']);
        $this->appointment($this->admin, ['role' => 'ADMIN', 'kind' => 'outgoing', 'status' => 'active']);
        Sanctum::actingAs($this->admin);

        $officers = $this->getJson('/api/officer-transition/renewal')->assertOk()->json('assigned_officers');

        $this->assertCount(2, $officers);
        $this->assertEqualsCanonicalizing(['Pia Reyes', 'Ulo Cruz'], array_column($officers, 'name'));
        $this->assertEqualsCanonicalizing(['active', 'upcoming'], array_column($officers, 'status'));
    }

    public function test_a_student_cannot_read_the_tracker(): void
    {
        Sanctum::actingAs($this->student);

        $this->getJson('/api/officer-transition/renewal')->assertForbidden();
    }

    public function test_the_reminder_reaches_officers_of_organizations_that_have_not_submitted_once(): void
    {
        $type = $this->type('Renewal of accreditation', now()->addDays(7)->setTime(23, 59));
        $this->type('Far off', now()->addDays(20));
        $incoming = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->appointment($this->officer, ['status' => 'active']);
        $this->appointment($incoming, ['status' => 'upcoming']);
        $this->appointment($this->student, ['status' => 'ended']);

        $submittedOrganization = $this->makeCollegeStudentOrganization(College::find($this->organization->college_id));
        $submittedUser = User::factory()->officer()->create(['organization_id' => $submittedOrganization->id]);
        OfficerAppointment::factory()->create([
            'organization_id' => $submittedOrganization->id,
            'election_id' => Election::factory()->create(['organization_id' => $submittedOrganization->id, 'status' => 'closed'])->id,
            'user_school_id' => $submittedUser->school_id,
            'status' => 'active',
        ]);
        $this->submit($submittedOrganization, $type, 'approved');

        $this->artisan(SendRenewalReminders::class)->assertSuccessful();
        $this->artisan(SendRenewalReminders::class)->assertSuccessful();

        $notifications = Notification::where('reference_type', 'compliance_requirement_type')->get();
        $this->assertCount(2, $notifications);
        $this->assertEqualsCanonicalizing([$this->officer->school_id, $incoming->school_id], $notifications->pluck('user_id')->all());
        $this->assertSame($type->id, (int) $notifications->first()->reference_id);
        $this->assertSame('general', $notifications->first()->notification_type);
        $this->assertSame($this->organization->id, (int) $notifications->first()->organization_id);
        $this->assertFalse((bool) $notifications->first()->is_read);
    }

    public function test_a_returned_submission_still_gets_the_reminder(): void
    {
        $type = $this->type('Renewal of accreditation', now()->addDays(7)->setTime(12, 0));
        $this->appointment($this->officer, ['status' => 'active']);
        $this->submit($this->organization, $type, 'returned');

        $this->artisan(SendRenewalReminders::class)->assertSuccessful();

        $this->assertSame(1, Notification::where('reference_type', 'compliance_requirement_type')->count());
    }

    public function test_the_reminder_is_scheduled_daily_at_seven(): void
    {
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($event) => str_contains($event->command, 'officers:renewal-reminders'));

        $this->assertNotNull($event);
        $this->assertSame('0 7 * * *', $event->expression);
    }
}
