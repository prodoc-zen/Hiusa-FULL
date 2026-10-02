<?php

namespace Database\Seeders;

use App\Models\AcademicYear;
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
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/**
 * Demo data for the SAO governance modules: compliance and accreditation,
 * venues, grievances, clearances and event registrations. Every row is one the
 * real controllers could have written (same statuses, same organization
 * scoping, same document path shape). Each insert is keyed on a natural key and
 * skipped when it already exists, so running this again neither duplicates nor
 * overwrites anything.
 */
class SaoGovernanceDemoSeeder extends Seeder
{
    /** Statuses of the treasurer, adviser and SAO lines, in that order, cycled across the student list. */
    private const CLEARANCE_OUTCOMES = [
        ['cleared', 'cleared', 'pending'],
        ['cleared', 'cleared', 'cleared'],
        ['cleared', 'pending', 'pending'],
        ['pending', 'pending', 'pending'],
        ['held', 'pending', 'pending'],
        ['cleared', 'cleared', 'pending'],
        ['pending', 'pending', 'pending'],
        ['cleared', 'held', 'pending'],
    ];

    private const CLEARANCE_HOLD_REMARKS = [
        'organization_treasurer' => 'Unpaid organization membership fee for the semester. Please settle it with the organization treasurer.',
        'adviser' => 'The committee accomplishment report has not been submitted to the adviser yet.',
    ];

    private User $sao;

    /** @var Collection<string, Organization> keyed by acronym */
    private Collection $organizations;

    /** @var array<int, Collection<int, User>> ADMIN and SBO_OFFICER users per organization id */
    private array $staffByOrganization = [];

    public function run(): void
    {
        if (app()->isProduction()) {
            return;
        }

        $this->sao = User::where('role', 'SUPER_ADMIN')->orderBy('school_id')->firstOrFail();
        $this->organizations = Organization::where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')->get()->keyBy('acronym');

        $this->seedAcademicYear();
        $this->seedCompliance();
        $this->seedVenues();
        $this->seedGrievances();
        $this->seedClearances();
        $this->seedEventRegistrations();
    }

    private function seedAcademicYear(): void
    {
        $start = now()->month >= 6 ? now()->year : now()->year - 1;
        $this->findOrCreate(AcademicYear::class, ['label' => $this->academicYear()], [
            'starts_on' => Carbon::create($start, 6, 1)->toDateString(),
            'ends_on' => Carbon::create($start + 1, 5, 31)->toDateString(),
            'is_current' => ! AcademicYear::where('is_current', true)->exists(),
            'created_by' => $this->sao->school_id,
            ...$this->stamp(now()),
        ]);
    }

    private function seedCompliance(): void
    {
        $academicYear = $this->academicYear();
        $previousYear = $this->academicYear(1);

        $requirements = [
            'Constitution and By-Laws' => [
                'description' => 'Current constitution and by-laws, with the ratification page signed by the officers and the adviser.',
                'deadline' => $this->at(-14, 17),
                'document' => "Constitution and By-Laws {$academicYear}",
            ],
            'List of Officers' => [
                'description' => "Officers for A.Y. {$academicYear} with their year level, program and contact number, and the adviser's conforme.",
                'deadline' => $this->at(-7, 17),
                'document' => "Officers List {$academicYear}",
            ],
            'Accomplishment Report' => [
                'description' => "Report of the activities held in A.Y. {$previousYear}, signed by the president and the adviser.",
                'deadline' => $this->at(10, 17),
                'document' => "Accomplishment Report {$previousYear}",
            ],
            'Financial Statement' => [
                'description' => "Statement of income and expenses for A.Y. {$previousYear}, signed by the treasurer and the auditor, with the official receipts attached.",
                'deadline' => $this->at(17, 17),
                'document' => "Financial Statement {$previousYear}",
            ],
        ];

        $types = [];
        foreach ($requirements as $name => $requirement) {
            $types[$name] = $this->findOrCreate(ComplianceRequirementType::class, [
                'academic_year' => $academicYear,
                'name' => $name,
            ], [
                'description' => $requirement['description'],
                'deadline_at' => $requirement['deadline'],
                'is_active' => true,
                'created_by' => $this->sao->school_id,
                ...$this->stamp($this->at(-35, 9)),
            ]);
        }

        // organization, requirement, status, days since it was submitted, SAO remarks
        $submissions = [
            ['PSITS-CCS', 'Constitution and By-Laws', 'approved', 20, null],
            ['PSITS-CCS', 'List of Officers', 'approved', 18, null],
            ['PSITS-CCS', 'Accomplishment Report', 'approved', 9, null],
            ['PSITS-CCS', 'Financial Statement', 'returned', 8, 'The financial statement is missing the signatures of the treasurer and the auditor, and the official receipts for the Tech Summit expenses are not attached. Please complete both and resubmit.'],
            ['JPIA-CBE', 'Constitution and By-Laws', 'approved', 19, null],
            ['JPIA-CBE', 'List of Officers', 'approved', 15, null],
            ['JPIA-CBE', 'Accomplishment Report', 'submitted', 4, null],
            ['JPIA-CBE', 'Financial Statement', 'submitted', 2, null],
            ['FES-CTE', 'Constitution and By-Laws', 'approved', 16, null],
            ['FES-CTE', 'List of Officers', 'submitted', 5, null],
            ['NSC-CHS', 'Constitution and By-Laws', 'approved', 22, null],
            ['NSC-CHS', 'List of Officers', 'approved', 17, null],
            ['NSC-CHS', 'Accomplishment Report', 'approved', 11, null],
            ['NSC-CHS', 'Financial Statement', 'approved', 10, null],
            ['EIG-COE', 'Constitution and By-Laws', 'submitted', 6, null],
        ];

        foreach ($submissions as [$acronym, $requirement, $status, $daysAgo, $remarks]) {
            $organization = $this->organizations[$acronym];
            $document = $requirements[$requirement]['document'];
            $path = $this->storePlaceholderPdf($organization, $requirement, $document);
            $submittedAt = $this->at(-$daysAgo, 10, 30);
            $reviewedAt = $status !== 'submitted' ? $submittedAt->copy()->addDays(2)->setTime(14, 0) : null;

            $this->findOrCreate(OrganizationComplianceSubmission::class, [
                'organization_id' => $organization->id,
                'requirement_type_id' => $types[$requirement]->id,
            ], [
                'status' => $status,
                'file_path' => $path,
                'file_original_name' => "{$organization->acronym} {$document}.pdf",
                'mime_type' => 'application/pdf',
                'file_size' => Storage::disk('local')->size($path),
                'remarks' => $remarks,
                'submitted_by' => $this->representative($organization->id)->school_id,
                'submitted_at' => $submittedAt,
                'reviewed_by' => $reviewedAt ? $this->sao->school_id : null,
                'reviewed_at' => $reviewedAt,
                ...$this->stamp($submittedAt, $reviewedAt),
            ]);
        }
    }

    private function seedVenues(): void
    {
        $venues = [];
        foreach ([
            ['University Gymnasium', 'Sports Complex, Main Campus', 1200],
            ['Audio-Visual Room', '3rd Floor, Main Building', 120],
            ['Covered Court', 'Beside the Student Center', 600],
            ['Function Hall', '2nd Floor, Student Center', 250],
        ] as [$name, $location, $capacity]) {
            $venues[$name] = $this->findOrCreate(Venue::class, ['name' => $name], [
                'location' => $location,
                'capacity' => $capacity,
                'is_active' => true,
                ...$this->stamp($this->at(-60, 9)),
            ]);
        }

        // An event already held on a campus venue carries the booking SAO approved for it.
        $events = Event::whereIn('status', ['approved', 'ongoing', 'completed'])
            ->whereNotNull('approved_at')
            ->orderBy('start_time')
            ->get();

        foreach ($events as $event) {
            $venue = collect($venues)->first(fn (Venue $candidate) => str_starts_with((string) $event->location, $candidate->name));
            $requester = User::where('school_id', $event->created_by)->first();

            if (! $venue || ! $requester) {
                continue;
            }

            $reviewedAt = $event->approved_at->copy()->addHours(4);

            $this->findOrCreate(VenueBooking::class, [
                'venue_id' => $venue->id,
                'organization_id' => $requester->organization_id,
                'requested_by' => $requester->school_id,
            ], [
                'event_id' => $event->id,
                'start_time' => $event->start_time,
                'end_time' => $event->end_time,
                'status' => 'approved',
                'reviewed_by' => $this->sao->school_id,
                'reviewed_at' => $reviewedAt,
                ...$this->stamp($reviewedAt->copy()->subDay(), $reviewedAt),
            ]);
        }

        // venue, organization, start, end, status, SAO remarks, days since requested, days since SAO reviewed it
        $requests = [
            ['Audio-Visual Room', 'JPIA-CBE', $this->at(5, 13), $this->at(5, 16), 'approved', null, 8, 6],
            ['Covered Court', 'NSC-CHS', $this->at(-9, 8), $this->at(-9, 12), 'approved', null, 20, 18],
            ['Audio-Visual Room', 'EIG-COE', $this->at(5, 14), $this->at(5, 17), 'rejected', 'The Audio-Visual Room is already reserved for another activity at this time. Please file a new request for a different schedule.', 7, 5],
            ['Function Hall', 'FES-CTE', $this->at(19, 14), $this->at(19, 18), 'pending', null, 1, null],
            ['University Gymnasium', 'JPIA-CBE', $this->at(23, 8), $this->at(23, 17), 'pending', null, 3, null],
        ];

        foreach ($requests as [$venueName, $acronym, $start, $end, $status, $remarks, $requestedDaysAgo, $reviewedDaysAgo]) {
            $organization = $this->organizations[$acronym];
            $requestedAt = $this->at(-$requestedDaysAgo, 9, 40);
            $reviewedAt = $reviewedDaysAgo !== null ? $this->at(-$reviewedDaysAgo, 15) : null;

            $this->findOrCreate(VenueBooking::class, [
                'venue_id' => $venues[$venueName]->id,
                'organization_id' => $organization->id,
                'requested_by' => $this->representative($organization->id)->school_id,
            ], [
                'start_time' => $start,
                'end_time' => $end,
                'status' => $status,
                'remarks' => $remarks,
                'reviewed_by' => $reviewedAt ? $this->sao->school_id : null,
                'reviewed_at' => $reviewedAt,
                ...$this->stamp($requestedAt, $reviewedAt),
            ]);
        }
    }

    private function seedGrievances(): void
    {
        // Urgency, category and confidence are what GrievanceController::localClassification() computes
        // for each text; the engine is php-fallback because no AI service call is made while seeding.
        $grievances = [
            [
                'student' => 2200055, // Pia Torres
                'addressed_to' => 'organization',
                'anonymous' => false,
                'title' => 'Official receipt not issued for the Tech Summit shirt payment',
                'description' => 'I paid 350 pesos for the Tech Summit organization shirt at the CCS lobby last week. The officer only wrote my name in a notebook and did not give me an official receipt. I would like an official receipt and a clear list of what the collected money will be used for.',
                'urgency' => 'Low',
                'category' => 'Financial Integrity',
                'confidence' => 0.5,
                'status' => 'submitted',
                'remarks' => null,
                'filed' => 1,
                'updated' => null,
            ],
            [
                'student' => 2200134, // Luis Ramos
                'addressed_to' => 'organization',
                'anonymous' => true,
                'title' => 'Sports Fest registration money not turned over to the treasurer',
                'description' => 'Several members paid their Sports Fest registration fee directly to one officer. After three weeks the treasurer still has no record of it. I believe this is a breach of the collection rules and it should be checked. Please do not reveal my name because the officer is in my committee.',
                'urgency' => 'High',
                'category' => 'Financial Integrity',
                'confidence' => 0.85,
                'status' => 'under_review',
                'remarks' => 'The organization adviser has been informed. The treasurer will present the Sports Fest collection records to the adviser this week.',
                'filed' => 6,
                'updated' => 4,
            ],
            [
                'student' => 2400118, // Nico Valdez
                'addressed_to' => 'sao',
                'anonymous' => false,
                'title' => 'Broken aircon in the Function Hall',
                'description' => 'The aircon in the Function Hall has been broken since the last assembly. The room gets very hot and some students felt dizzy during the program. Please have it repaired before the next activity.',
                'urgency' => 'Medium',
                'category' => 'Facilities & Maintenance',
                'confidence' => 0.75,
                'status' => 'resolved',
                'remarks' => 'SAO coordinated with the Physical Plant Office and the Function Hall aircon unit was repaired and tested. Please file a new report if the problem comes back.',
                'filed' => 12,
                'updated' => 8,
            ],
            [
                'student' => 2400133, // Paolo Marquez
                'addressed_to' => 'sao',
                'anonymous' => false,
                'title' => 'Emergency exit chained during basketball practice',
                'description' => 'During basketball practice last Saturday the emergency exit beside the University Gymnasium stage was chained and the guard on duty did not have the key. This is a danger if a fire or a crowd rush happens during an event. Please have the exit checked before the next activity.',
                'urgency' => 'Critical',
                'category' => 'Safety & Security',
                'confidence' => 0.95,
                'status' => 'submitted',
                'remarks' => null,
                'filed' => 2,
                'updated' => null,
            ],
            [
                'student' => 2100389, // Carlo Mendoza
                'addressed_to' => 'organization',
                'anonymous' => false,
                'title' => 'Absence recorded for a mandatory assembly that clashed with my laboratory class',
                'description' => 'The organization assembly was on the same day as my laboratory class and I was marked absent. I think this is unfair because the schedule was posted only two days before. Please remove the absence from my record.',
                'urgency' => 'Medium',
                'category' => 'Academic / Faculty',
                'confidence' => 0.75,
                'status' => 'dismissed',
                'remarks' => 'The assembly was announced two weeks in advance, so the absence stands under the organization attendance policy. For future conflicts, file an excuse letter with the secretary before the assembly.',
                'filed' => 15,
                'updated' => 11,
            ],
        ];

        foreach ($grievances as $grievance) {
            $student = User::where('school_id', $grievance['student'])->firstOrFail();
            $filedAt = $this->at(-$grievance['filed'], 16, 20);
            $updatedAt = $grievance['updated'] !== null ? $this->at(-$grievance['updated'], 10, 5) : $filedAt;

            $this->findOrCreate(Grievance::class, [
                'submitted_by' => $student->school_id,
                'title' => $grievance['title'],
            ], [
                'organization_id' => $grievance['addressed_to'] === 'organization' ? $student->organization_id : null,
                'is_anonymous' => $grievance['anonymous'],
                'description' => $grievance['description'],
                'category' => $grievance['category'],
                'urgency' => $grievance['urgency'],
                'classification_confidence' => $grievance['confidence'],
                'classification_reasoning' => "Determined {$grievance['urgency']} urgency and the '{$grievance['category']}' category from keyword analysis.",
                'classification_engine' => 'php-fallback',
                'status' => $grievance['status'],
                'remarks' => $grievance['remarks'],
                'resolved_at' => in_array($grievance['status'], ['resolved', 'dismissed'], true) ? $updatedAt : null,
                ...$this->stamp($filedAt, $updatedAt),
            ]);
        }
    }

    private function seedClearances(): void
    {
        $academicYear = $this->academicYear();
        $semester = now()->month >= 6 ? 'First Semester' : 'Second Semester';
        $roles = ['organization_treasurer', 'adviser', 'sao'];
        $openedAt = $this->at(-14, 9);

        $period = $this->findOrCreate(ClearancePeriod::class, [
            'academic_year' => $academicYear,
            'title' => "{$semester} Clearance {$academicYear}",
        ], [
            'description' => 'Required before the release of final grades. Settle any organization obligations, then secure each signature listed for your organization and the Student Affairs Office.',
            'required_roles' => $roles,
            'deadline_at' => $this->at(28, 17),
            'created_by' => $this->sao->school_id,
            ...$this->stamp($openedAt),
        ]);

        $students = User::where('role', 'STUDENT')->where('account_status', 'active')->orderBy('school_id')->get();

        foreach ($students as $index => $student) {
            $outcomes = self::CLEARANCE_OUTCOMES[$index % count(self::CLEARANCE_OUTCOMES)];

            foreach ($roles as $roleIndex => $role) {
                $status = $outcomes[$roleIndex];
                // Signing dates are spread over the last ten days or so, treasurer first, then adviser, then SAO.
                $signedAt = $status !== 'pending' ? $this->at(-(11 - $index % 5 - $roleIndex), 10 + $roleIndex) : null;
                $signer = $signedAt ? match ($role) {
                    'sao' => $this->sao,
                    'adviser' => $this->signatory($student->organization_id, 'Adviser'),
                    default => $this->signatory($student->organization_id, 'Treasurer'),
                } : null;

                $this->findOrCreate(ClearanceSignature::class, [
                    'clearance_period_id' => $period->id,
                    'student_id' => $student->school_id,
                    'required_role' => $role,
                ], [
                    'organization_id' => $student->organization_id,
                    'status' => $status,
                    'remarks' => $status === 'held' ? self::CLEARANCE_HOLD_REMARKS[$role] : null,
                    'signed_by' => $signer?->school_id,
                    'signed_at' => $signedAt,
                    ...$this->stamp($openedAt, $signedAt),
                ]);
            }
        }
    }

    private function seedEventRegistrations(): void
    {
        $upcoming = Event::where('status', 'approved')
            ->whereNotNull('approved_at')
            ->where('start_time', '>', now())
            ->orderBy('start_time')
            ->get();

        foreach ($upcoming as $event) {
            $organizationId = $this->organizationIdOf($event);
            // The first student stays unregistered so registering can be shown live.
            $students = $this->students($organizationId)->skip(1)->take(8)->values();
            $minutesOpen = (int) $event->approved_at->diffInMinutes(now());

            foreach ($students as $position => $student) {
                $registeredAt = $event->approved_at->copy()->addMinutes((int) ($minutesOpen * ($position + 1) / ($students->count() + 1)));

                $this->findOrCreate(EventRegistration::class, [
                    'event_id' => $event->id,
                    'user_id' => $student->school_id,
                ], [
                    'organization_id' => $organizationId,
                    'status' => 'registered',
                    'registered_at' => $registeredAt,
                    ...$this->stamp($registeredAt),
                ]);
            }
        }

        foreach (Event::where('status', 'completed')->orderBy('start_time')->get() as $event) {
            $organizationId = $this->organizationIdOf($event);
            $students = $this->students($organizationId);
            $attendance = Attendance::where('event_id', $event->id)->orderBy('check_in_time')->get();

            // Attendance::created() flips a registration to attended only for a present or late check-in,
            // and a registration with no check-in at all is what events:mark-no-shows turns into no_show.
            $attended = $attendance->whereIn('status', ['present', 'late'])->pluck('user_id')
                ->filter(fn (int $userId) => $students->contains('school_id', $userId))
                ->take(3);
            $noShows = $students->pluck('school_id')->diff($attendance->pluck('user_id'))->take(1);

            $outcomes = $attended->map(fn (int $userId) => [$userId, 'attended'])
                ->concat($noShows->map(fn (int $userId) => [$userId, 'no_show']))
                ->values();

            foreach ($outcomes as $position => [$userId, $status]) {
                $registeredAt = $event->start_time->copy()->subDays(5)->setTime(9 + $position, 0);

                $this->findOrCreate(EventRegistration::class, [
                    'event_id' => $event->id,
                    'user_id' => $userId,
                ], [
                    'organization_id' => $organizationId,
                    'status' => $status,
                    'registered_at' => $registeredAt,
                    ...$this->stamp($registeredAt),
                ]);
            }
        }
    }

    /**
     * forceFill rather than firstOrCreate(): created_at and updated_at are not mass assignable
     * and are back-dated here.
     *
     * @param  class-string<Model>  $model
     */
    private function findOrCreate(string $model, array $key, array $attributes): Model
    {
        $record = $model::query()->where($key)->first();

        if ($record) {
            return $record;
        }

        $record = new $model;
        $record->forceFill([...$key, ...$attributes])->save();

        return $record;
    }

    private function at(int $daysFromNow, int $hour, int $minute = 0): Carbon
    {
        return now()->addDays($daysFromNow)->setTime($hour, $minute);
    }

    /** created_at and updated_at for a row whose history is back-dated, so they never contradict its own dates. */
    private function stamp(Carbon $createdAt, ?Carbon $updatedAt = null): array
    {
        return ['created_at' => $createdAt, 'updated_at' => $updatedAt ?? $createdAt];
    }

    private function academicYear(int $yearsBack = 0): string
    {
        $start = (now()->month >= 6 ? now()->year : now()->year - 1) - $yearsBack;

        return $start.'-'.($start + 1);
    }

    // DatabaseSeeder backfills events.organization_id only after its whole call list has run, so it is
    // still NULL here. The seeded events are all created by a PSITS-CCS officer, which is the
    // organization that backfill assigns them.
    private function organizationIdOf(Event $event): int
    {
        return $event->organization_id ?? User::where('school_id', $event->created_by)->value('organization_id');
    }

    /**
     * @return Collection<int, User>
     */
    private function students(int $organizationId): Collection
    {
        return User::where('organization_id', $organizationId)
            ->where('role', 'STUDENT')
            ->where('account_status', 'active')
            ->orderBy('school_id')
            ->get();
    }

    /**
     * @return Collection<int, User>
     */
    private function staff(int $organizationId): Collection
    {
        return $this->staffByOrganization[$organizationId] ??= User::where('organization_id', $organizationId)
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER'])
            ->orderBy('school_id')
            ->get();
    }

    /** The ADMIN an organization files documents and booking requests as: an officer when it has one, otherwise the SAO-assigned Adviser. */
    private function representative(int $organizationId): User
    {
        return $this->staff($organizationId)
            ->where('role', 'ADMIN')
            ->sortBy(fn (User $user) => $user->position_title === 'Adviser')
            ->firstOrFail();
    }

    /** Whoever may sign a clearance line for this organization (ADMIN or SBO_OFFICER of it): the officer holding the position, else its representative. */
    private function signatory(int $organizationId, string $position): User
    {
        return $this->staff($organizationId)->firstWhere('position_title', $position) ?? $this->representative($organizationId);
    }

    private function storePlaceholderPdf(Organization $organization, string $requirement, string $document): string
    {
        $path = "compliance-submissions/{$organization->id}/".substr(sha1("{$organization->acronym}|{$document}"), 0, 40).'.pdf';
        $disk = Storage::disk('local');

        if (! $disk->exists($path)) {
            $disk->put($path, $this->placeholderPdf($requirement, [
                $organization->name,
                $document,
                'Submitted to the Student Affairs Office for organization accreditation.',
                'Placeholder file for the HIUSA demonstration.',
            ]));
        }

        return $path;
    }

    /**
     * A one page PDF, so the document the SAO opens from the review queue is a real PDF
     * and matches the application/pdf type and .pdf name recorded on the submission.
     *
     * @param  array<int, string>  $lines
     */
    private function placeholderPdf(string $heading, array $lines): string
    {
        $escape = fn (string $text): string => strtr($text, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)']);

        $stream = "BT /F2 16 Tf 72 720 Td ({$escape($heading)}) Tj ET\n";
        foreach ($lines as $position => $line) {
            $stream .= 'BT /F1 10 Tf 72 '.(690 - $position * 16)." Td ({$escape($line)}) Tj ET\n";
        }

        $objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
            '<< /Length '.strlen($stream)." >>\nstream\n{$stream}endstream",
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
        ];

        $pdf = "%PDF-1.4\n";
        $offsets = [];
        foreach ($objects as $number => $body) {
            $offsets[] = strlen($pdf);
            $pdf .= ($number + 1)." 0 obj\n{$body}\nendobj\n";
        }

        $xrefOffset = strlen($pdf);
        $entries = count($objects) + 1;
        $pdf .= "xref\n0 {$entries}\n0000000000 65535 f \n";
        foreach ($offsets as $offset) {
            $pdf .= sprintf("%010d 00000 n \n", $offset);
        }

        return $pdf."trailer\n<< /Size {$entries} /Root 1 0 R >>\nstartxref\n{$xrefOffset}\n%%EOF\n";
    }
}
