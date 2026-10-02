<?php

namespace Tests\Feature;

use App\Http\Controllers\GrievanceController;
use App\Models\Attendance;
use App\Models\ClearancePeriod;
use App\Models\ClearanceSignature;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\EventRegistration;
use App\Models\Grievance;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\SaoGovernanceDemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use ReflectionMethod;
use Tests\TestCase;

class SaoGovernanceDemoSeederTest extends TestCase
{
    use RefreshDatabase;

    private const MODULE_TABLES = [
        'compliance_requirement_types',
        'organization_compliance_submissions',
        'venues',
        'venue_bookings',
        'grievances',
        'clearance_periods',
        'clearance_signatures',
        'event_registrations',
    ];

    protected function setUp(): void
    {
        parent::setUp();

        // The seeder stores placeholder PDFs on the local disk, where ComplianceController reads them back.
        Storage::fake('local');
        $this->seed(DatabaseSeeder::class);
    }

    private function sao(): User
    {
        return User::where('role', 'SUPER_ADMIN')->firstOrFail();
    }

    private function organization(string $acronym): Organization
    {
        return Organization::where('acronym', $acronym)->firstOrFail();
    }

    private function organizationAdmin(string $acronym): User
    {
        return User::where('organization_id', $this->organization($acronym)->id)->where('role', 'ADMIN')->orderBy('school_id')->firstOrFail();
    }

    private function moduleCounts(): array
    {
        return collect(self::MODULE_TABLES)->mapWithKeys(fn (string $table) => [$table => DB::table($table)->count()])->all();
    }

    private function distinct(string $table, string $column): array
    {
        return DB::table($table)->distinct()->orderBy($column)->pluck($column)->all();
    }

    public function test_every_governance_module_is_populated_and_shows_its_lifecycle(): void
    {
        foreach ($this->moduleCounts() as $table => $count) {
            $this->assertGreaterThan(0, $count, "{$table} is empty after a full seed.");
        }

        $this->assertSame(['approved', 'returned', 'submitted'], $this->distinct('organization_compliance_submissions', 'status'));
        $this->assertSame(['approved', 'pending', 'rejected'], $this->distinct('venue_bookings', 'status'));
        $this->assertSame(['dismissed', 'resolved', 'submitted', 'under_review'], $this->distinct('grievances', 'status'));
        $this->assertSame(['cleared', 'held', 'pending'], $this->distinct('clearance_signatures', 'status'));
        $this->assertSame(['attended', 'no_show', 'registered'], $this->distinct('event_registrations', 'status'));

        $deadlines = ComplianceRequirementType::all()->pluck('deadline_at');
        $this->assertTrue($deadlines->contains(fn ($deadline) => $deadline->isPast()) && $deadlines->contains(fn ($deadline) => $deadline->isFuture()), 'Requirement deadlines should include one already past and one still ahead.');
        $this->assertSame(1, OrganizationComplianceSubmission::where('status', 'returned')->whereNotNull('remarks')->count());
        $this->assertSame(0, OrganizationComplianceSubmission::where('status', '!=', 'returned')->whereNotNull('remarks')->count());

        $this->assertSame(Venue::count(), Venue::where('is_active', true)->count(), 'Every seeded venue should be bookable.');
        $this->assertSame(1, VenueBooking::where('status', 'rejected')->whereNotNull('remarks')->count());
        $this->assertSame(0, VenueBooking::where('status', 'pending')->whereNotNull('reviewed_by')->count());

        $this->assertSame(1, Grievance::where('is_anonymous', true)->count());
        $this->assertGreaterThan(0, Grievance::whereNull('organization_id')->count());
        $this->assertGreaterThan(0, Grievance::whereNotNull('organization_id')->count());

        $this->assertSame(1, ClearancePeriod::count());
        $this->assertTrue(ClearancePeriod::firstOrFail()->deadline_at->isFuture(), 'The seeded clearance period should still be open.');
    }

    public function test_approved_venue_bookings_never_overlap_on_one_venue(): void
    {
        $approved = VenueBooking::where('status', 'approved')->orderBy('start_time')->get()->groupBy('venue_id');

        $this->assertTrue($approved->contains(fn ($bookings) => $bookings->count() > 1), 'No venue has two approved bookings, so the overlap check would prove nothing.');

        foreach ($approved as $bookings) {
            foreach ($bookings->values() as $index => $booking) {
                foreach ($bookings->slice($index + 1) as $other) {
                    $this->assertFalse(
                        $booking->start_time < $other->end_time && $booking->end_time > $other->start_time,
                        "Approved bookings #{$booking->id} and #{$other->id} overlap on venue #{$booking->venue_id}."
                    );
                }
            }
        }
    }

    public function test_every_row_is_scoped_to_the_organization_of_its_related_user_or_event(): void
    {
        foreach (OrganizationComplianceSubmission::with('submitter')->get() as $submission) {
            $this->assertEquals($submission->submitter->organization_id, $submission->organization_id, "Submission #{$submission->id}");
            $this->assertSame('ADMIN', $submission->submitter->role, "Submission #{$submission->id} must be filed by an ADMIN, as the route requires.");
            $this->assertStringStartsWith("compliance-submissions/{$submission->organization_id}/", $submission->file_path);
        }

        foreach (VenueBooking::with(['requester', 'event'])->get() as $booking) {
            $this->assertEquals($booking->requester->organization_id, $booking->organization_id, "Booking #{$booking->id}");
            $this->assertContains($booking->requester->role, ['ADMIN', 'SBO_OFFICER'], "Booking #{$booking->id}");
            if ($booking->event) {
                $this->assertEquals($booking->event->organization_id, $booking->organization_id, "Booking #{$booking->id} is linked to another organization's event.");
            }
        }

        foreach (Grievance::with('submitter')->get() as $grievance) {
            $this->assertSame('STUDENT', $grievance->submitter->role, "Grievance #{$grievance->id}");
            if ($grievance->organization_id !== null) {
                $this->assertEquals($grievance->submitter->organization_id, $grievance->organization_id, "Grievance #{$grievance->id}");
            }
        }

        foreach (ClearanceSignature::with('student')->get() as $signature) {
            $this->assertSame('STUDENT', $signature->student->role, "Signature #{$signature->id}");
            $this->assertEquals($signature->student->organization_id, $signature->organization_id, "Signature #{$signature->id}");
        }

        foreach (EventRegistration::with(['event', 'user'])->get() as $registration) {
            $this->assertEquals($registration->event->organization_id, $registration->organization_id, "Registration #{$registration->id}");
            $this->assertEquals($registration->user->organization_id, $registration->organization_id, "Registration #{$registration->id}");
        }
    }

    public function test_running_the_seeder_again_changes_nothing(): void
    {
        $before = $this->moduleCounts();
        $filesBefore = Storage::disk('local')->allFiles();

        $this->seed(SaoGovernanceDemoSeeder::class);

        $this->assertSame($before, $this->moduleCounts());
        $this->assertEqualsCanonicalizing($filesBefore, Storage::disk('local')->allFiles());
    }

    public function test_seeded_compliance_documents_are_where_the_download_endpoint_looks(): void
    {
        $disk = Storage::disk('local');

        foreach (OrganizationComplianceSubmission::all() as $submission) {
            $this->assertMatchesRegularExpression('#^compliance-submissions/\d+/[0-9a-zA-Z._-]+$#', $submission->file_path);
            $this->assertTrue($disk->exists($submission->file_path), "Submission #{$submission->id} has no file on the local disk.");
            $this->assertEquals($disk->size($submission->file_path), $submission->file_size);
            $this->assertStringStartsWith('%PDF-', $disk->get($submission->file_path));
            $this->assertSame('application/pdf', $submission->mime_type);
        }

        $submission = OrganizationComplianceSubmission::where('status', 'submitted')->firstOrFail();

        Sanctum::actingAs($this->sao());
        $this->get("/api/compliance/submissions/{$submission->id}/document")
            ->assertOk()
            ->assertHeader('Content-Type', 'application/pdf');

        Sanctum::actingAs(User::findOrFail($submission->submitted_by));
        $this->get("/api/compliance/submissions/{$submission->id}/document")->assertOk();
    }

    public function test_seeded_grievances_carry_the_classification_the_php_fallback_produces(): void
    {
        $classify = new ReflectionMethod(GrievanceController::class, 'localClassification');
        $controller = app(GrievanceController::class);

        foreach (Grievance::all() as $grievance) {
            $expected = $classify->invoke($controller, $grievance->title, $grievance->description);

            $this->assertSame($expected['urgency'], $grievance->urgency, "Grievance #{$grievance->id}");
            $this->assertSame($expected['category'], $grievance->category, "Grievance #{$grievance->id}");
            $this->assertEqualsWithDelta($expected['confidence_score'], $grievance->classification_confidence, 0.0001, "Grievance #{$grievance->id}");
            $this->assertSame($expected['reasoning'], $grievance->classification_reasoning, "Grievance #{$grievance->id}");
            $this->assertSame('php-fallback', $grievance->classification_engine);
        }
    }

    public function test_grievance_status_follows_the_lifecycle_the_controller_allows(): void
    {
        foreach (Grievance::all() as $grievance) {
            $closed = in_array($grievance->status, ['resolved', 'dismissed'], true);

            $this->assertSame($closed, $grievance->resolved_at !== null, "Grievance #{$grievance->id} resolved_at");
            if ($closed) {
                $this->assertNotEmpty($grievance->remarks, "Grievance #{$grievance->id} was closed without remarks, which the controller rejects.");
            }
            if ($grievance->status === 'submitted') {
                $this->assertNull($grievance->remarks, "Grievance #{$grievance->id} has remarks before anyone reviewed it.");
            }
            $this->assertTrue($grievance->created_at->lessThanOrEqualTo($grievance->updated_at));
            $this->assertTrue($grievance->created_at->isPast());
        }

        $anonymous = Grievance::where('is_anonymous', true)->firstOrFail();
        $this->assertNotNull($anonymous->organization_id, 'Anonymity is only offered when a grievance is addressed to the filer\'s own organization.');
    }

    public function test_clearance_lines_are_signed_by_the_signatory_the_controller_routes_them_to(): void
    {
        $period = ClearancePeriod::firstOrFail();
        $students = User::where('role', 'STUDENT')->where('account_status', 'active')->count();

        $this->assertSame(['organization_treasurer', 'adviser', 'sao'], $period->required_roles);
        $this->assertSame($students * count($period->required_roles), ClearanceSignature::where('clearance_period_id', $period->id)->count());

        foreach (ClearanceSignature::with('signer')->get() as $signature) {
            if ($signature->status === 'pending') {
                $this->assertNull($signature->signed_by, "Signature #{$signature->id}");
                $this->assertNull($signature->signed_at, "Signature #{$signature->id}");

                continue;
            }

            $signer = $signature->signer;
            $this->assertNotNull($signer, "Signature #{$signature->id} has no signer.");
            $this->assertTrue($signature->signed_at->isPast());

            if ($signature->required_role === 'sao') {
                $this->assertSame('SUPER_ADMIN', $signer->role, "Signature #{$signature->id}");
            } else {
                $this->assertContains($signer->role, ['ADMIN', 'SBO_OFFICER'], "Signature #{$signature->id}");
                $this->assertEquals($signature->organization_id, $signer->organization_id, "Signature #{$signature->id} is signed from another organization.");
            }

            if ($signature->status === 'held') {
                $this->assertNotEmpty($signature->remarks, "Signature #{$signature->id} is held without a reason, which the controller rejects.");
            }
        }

        $this->assertGreaterThan(0, ClearanceSignature::where('required_role', 'sao')->where('status', 'pending')->count());
    }

    public function test_registrations_agree_with_event_state_and_attendance(): void
    {
        $upcoming = Event::where('status', 'approved')->where('start_time', '>', now())->get();
        $this->assertNotEmpty($upcoming);

        foreach ($upcoming as $event) {
            $registrations = EventRegistration::where('event_id', $event->id)->get();

            $this->assertGreaterThan(1, $registrations->count());
            $this->assertSame(['registered'], $registrations->pluck('status')->unique()->values()->all());
            $this->assertTrue($registrations->every(fn (EventRegistration $registration) => $registration->registered_at->isPast()));
        }

        $completed = Event::where('status', 'completed')->get();
        $this->assertNotEmpty($completed);

        foreach ($completed as $event) {
            $checkedIn = Attendance::where('event_id', $event->id)->whereIn('status', ['present', 'late'])->pluck('user_id');
            $anyAttendance = Attendance::where('event_id', $event->id)->pluck('user_id');
            $registrations = EventRegistration::where('event_id', $event->id)->get();

            $this->assertGreaterThanOrEqual(2, $registrations->where('status', 'attended')->count());
            $this->assertSame(1, $registrations->where('status', 'no_show')->count());

            foreach ($registrations as $registration) {
                $this->assertTrue($registration->registered_at->lessThan($event->start_time));

                if ($registration->status === 'attended') {
                    $this->assertTrue($checkedIn->contains($registration->user_id), "Registration #{$registration->id} is attended without a present or late check-in.");
                } else {
                    $this->assertFalse($anyAttendance->contains($registration->user_id), "Registration #{$registration->id} is a no-show but has an attendance record.");
                }
            }
        }

        $this->assertSame(0, EventRegistration::whereNotIn('event_id', $upcoming->pluck('id')->merge($completed->pluck('id')))->count());
    }

    public function test_sao_screens_read_the_seeded_data(): void
    {
        Sanctum::actingAs($this->sao());

        $statuses = collect($this->getJson('/api/compliance/status')->assertOk()->json('organizations'))->pluck('accreditation_status')->unique()->sort()->values()->all();
        $this->assertSame(['accredited', 'incomplete', 'pending_review', 'returned'], $statuses);

        $queue = $this->getJson('/api/compliance/submissions?status=submitted')->assertOk();
        $this->assertSame(OrganizationComplianceSubmission::where('status', 'submitted')->count(), $queue->json('total'));

        $this->getJson('/api/venues')->assertOk()->assertJsonPath('total', Venue::count());
        $this->getJson('/api/venue-bookings?status=pending')->assertOk()->assertJsonPath('total', VenueBooking::where('status', 'pending')->count());

        $availability = collect($this->getJson('/api/venues/'.Venue::where('name', 'Audio-Visual Room')->value('id').'/availability')->assertOk()->json());
        $this->assertSame(VenueBooking::where('status', 'approved')->where('venue_id', Venue::where('name', 'Audio-Visual Room')->value('id'))->count(), $availability->count());

        $grievances = collect($this->getJson('/api/grievances')->assertOk()->json('data'));
        $this->assertCount(Grievance::count(), $grievances);
        $this->assertTrue($grievances->every(fn (array $row) => array_key_exists('submitted_by', $row)), 'SAO always sees who filed a grievance, anonymous or not.');

        $period = ClearancePeriod::firstOrFail();
        $this->getJson('/api/clearance-periods')->assertOk()->assertJsonPath('data.0.id', $period->id);
        $this->getJson("/api/clearance-signatures?clearance_period_id={$period->id}&status=pending")
            ->assertOk()
            ->assertJsonPath('total', ClearanceSignature::where('required_role', 'sao')->where('status', 'pending')->count());
    }

    public function test_organization_and_student_screens_read_the_seeded_data(): void
    {
        $psits = $this->organization('PSITS-CCS');
        Sanctum::actingAs($this->organizationAdmin('PSITS-CCS'));

        $submissions = collect($this->getJson('/api/compliance/submissions')->assertOk()->json('data'));
        $this->assertCount(OrganizationComplianceSubmission::where('organization_id', $psits->id)->count(), $submissions);
        $this->assertNotEmpty($submissions->firstWhere('status', 'returned')['remarks']);

        $grievances = collect($this->getJson('/api/grievances')->assertOk()->json('data'));
        $this->assertCount(Grievance::where('organization_id', $psits->id)->count(), $grievances);
        $anonymous = $grievances->firstWhere('is_anonymous', true);
        $this->assertNotNull($anonymous);
        $this->assertArrayNotHasKey('submitted_by', $anonymous);
        $this->assertArrayNotHasKey('submitter', $anonymous);
        $this->assertTrue($grievances->where('is_anonymous', false)->every(fn (array $row) => array_key_exists('submitted_by', $row)));

        $upcoming = Event::where('status', 'approved')->where('start_time', '>', now())->firstOrFail();
        $this->getJson("/api/events/{$upcoming->id}/registrations")
            ->assertOk()
            ->assertJsonPath('summary.registered', EventRegistration::where('event_id', $upcoming->id)->count());

        $completed = Event::where('status', 'completed')->firstOrFail();
        $this->getJson("/api/events/{$completed->id}/registrations")
            ->assertOk()
            ->assertJsonPath('summary.attended', EventRegistration::where('event_id', $completed->id)->where('status', 'attended')->count())
            ->assertJsonPath('summary.no_show', 1);

        Sanctum::actingAs(User::findOrFail(EventRegistration::where('event_id', $upcoming->id)->value('user_id')));

        $this->getJson('/api/me/event-registrations')->assertOk()->assertJsonCount(1, 'upcoming');

        $clearances = collect($this->getJson('/api/clearances/mine')->assertOk()->json());
        $this->assertCount(1, $clearances);
        $this->assertCount(3, $clearances[0]['signatures']);

        $filer = Grievance::where('is_anonymous', true)->firstOrFail()->submitter;
        Sanctum::actingAs($filer);

        $own = collect($this->getJson('/api/grievances')->assertOk()->json('data'));
        $this->assertCount(Grievance::where('submitted_by', $filer->school_id)->count(), $own);
        $this->assertTrue($own->every(fn (array $row) => array_key_exists('submitted_by', $row)), 'A filer always sees their own submissions, even an anonymous one.');
    }
}
