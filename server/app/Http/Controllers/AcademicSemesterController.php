<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\OrganizationApplicationDocument;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Task;
use App\Services\Compliance\RegistrationRequirementCatalog;
use App\Services\Records\SemesterSnapshotService;
use App\Services\RequirementSampleService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AcademicSemesterController extends Controller
{
    private const EVENT_REQUIREMENTS = [
        'on_campus' => [
            'Venue Reservation Letter',
            'Request Letter',
            'Equipment & Technical Request Forms',
        ],
        'off_campus' => [
            'Approved Letter of Intent for the Proposed Activity',
            'Document Tracking Slip',
            'Student Activity Clearance/Permit Form',
            'Modified Checklist Requirements for Off-Campus Activity',
            'Report of Compliance',
            'Designation Letter for Personnel In Charge',
            "Participants' Parents Consent Form",
            'Minutes of the Meeting (Planning Stage)',
            'Curriculum Requirement',
            'Journal',
            'Sanitary Permit (If Applicable)',
            'Emergency Preparedness Plan',
            'Mobility of Students',
            'LGU/NGO',
            'Gate Pass from PCO (If Applicable)',
        ],
    ];

    public function index(Request $request)
    {
        return response()->json(AcademicSemester::with('academicYear:id,label')
            ->when(! in_array($request->user()->role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'], true), fn ($query) => $query->where('status', '!=', 'upcoming'))
            ->orderByDesc('academic_year_id')->orderBy('number')->get());
    }

    public function active()
    {
        return response()->json(AcademicSemester::active());
    }

    public function store(Request $request, AcademicYear $academicYear)
    {
        $data = $request->validate([
            'number' => ['required', 'integer', 'in:1,2'],
            'starts_on' => ['required', 'date'],
            'ends_on' => ['required', 'date', 'after:starts_on'],
        ]);
        $this->validateDates($academicYear, $data);
        if ($academicYear->semesters()->where('number', $data['number'])->exists()) {
            throw ValidationException::withMessages(['number' => ['This semester already exists for the academic year.']]);
        }

        $semester = DB::transaction(function () use ($academicYear, $data, $request) {
            $semester = $academicYear->semesters()->create([
                ...$data,
                'status' => 'upcoming',
                'created_by' => $request->user()->school_id,
            ]);
            foreach (RegistrationRequirementCatalog::NAMES as $name) {
                ComplianceRequirementType::create([
                    'category' => 'organization',
                    'academic_year' => $academicYear->label,
                    'academic_semester_id' => $semester->id,
                    'name' => $name,
                    'allowed_extensions' => ['pdf'],
                    'deadline_at' => $semester->ends_on->endOfDay(),
                    'is_active' => true,
                    'created_by' => $request->user()->school_id,
                ]);
                ComplianceRequirementType::create([
                    'category' => 'renewal',
                    'academic_year' => $academicYear->label,
                    'academic_semester_id' => $semester->id,
                    'name' => $name,
                    'allowed_extensions' => ['pdf'],
                    'deadline_at' => $semester->ends_on->endOfDay(),
                    'is_active' => true,
                    'created_by' => $request->user()->school_id,
                ]);
            }
            foreach (ComplianceRequirementType::SEMESTRAL_REPORT_NAMES as $name) {
                ComplianceRequirementType::create([
                    'category' => 'semestral_report',
                    'academic_year' => $academicYear->label,
                    'academic_semester_id' => $semester->id,
                    'name' => $name,
                    'allowed_extensions' => ['pdf'],
                    'deadline_at' => $semester->ends_on->endOfDay(),
                    'is_active' => true,
                    'created_by' => $request->user()->school_id,
                ]);
            }
            $sortOrder = 0;
            foreach (self::EVENT_REQUIREMENTS as $venueType => $names) {
                foreach ($names as $name) {
                    EventRequirement::create([
                        'name' => $name,
                        'venue_type' => $venueType,
                        'academic_semester_id' => $semester->id,
                        'allowed_extensions' => ['pdf'],
                        'is_active' => true,
                        'is_optional' => str_contains($name, '(If Applicable)'),
                        'sort_order' => ++$sortOrder,
                    ]);
                }
            }
            $this->audit($request, 'academic_semester_created', $semester);

            return $semester;
        });

        return response()->json($semester->load('academicYear:id,label'), 201);
    }

    public function updateDates(Request $request, AcademicSemester $academicSemester)
    {
        $data = $request->validate([
            'starts_on' => ['required', 'date'],
            'ends_on' => ['required', 'date', 'after:starts_on'],
        ]);

        $semester = DB::transaction(function () use ($request, $academicSemester, $data) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $semester = AcademicSemester::whereKey($academicSemester->id)->lockForUpdate()->firstOrFail();
            if ($semester->status !== 'upcoming') {
                throw ValidationException::withMessages(['semester' => ['Only a semester that has not started can have its dates changed.']]);
            }
            $this->validateDates($semester->academicYear, $data, $semester->id);
            $outside = ComplianceRequirementType::where('academic_semester_id', $semester->id)
                ->where(fn ($query) => $query->where('deadline_at', '<', Carbon::parse($data['starts_on'])->startOfDay())
                    ->orWhere('deadline_at', '>', Carbon::parse($data['ends_on'])->endOfDay()))
                ->count();
            if ($outside > 0) {
                $message = $outside === 1
                    ? '1 requirement deadline in this semester falls outside these dates. Change that deadline first, or pick dates that include it.'
                    : "{$outside} requirement deadlines in this semester fall outside these dates. Change those deadlines first, or pick dates that include them.";
                throw ValidationException::withMessages(['semester' => [$message]]);
            }
            $semester->update($data);
            $this->audit($request, 'academic_semester_dates_changed', $semester);

            return $semester;
        });

        return response()->json($semester->load('academicYear:id,label'));
    }

    public function activate(Request $request, AcademicSemester $academicSemester)
    {
        $semester = DB::transaction(function () use ($request, $academicSemester) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $semester = AcademicSemester::whereKey($academicSemester->id)->lockForUpdate()->firstOrFail();
            if ($semester->status === 'completed') {
                throw ValidationException::withMessages(['semester' => ['A completed semester cannot be reopened.']]);
            }
            if ($semester->academicYear->closed_at) {
                throw ValidationException::withMessages(['semester' => ['A completed academic year cannot be reopened.']]);
            }
            if ($semester->status !== 'active') {
                if ($semester->starts_on->isFuture()) {
                    throw ValidationException::withMessages(['semester' => ['This semester starts on '.$semester->starts_on->format('M j, Y').'. It cannot be made active before then.']]);
                }
                $openElections = $this->openElections(AcademicSemester::where('status', 'active')->select('id'));
                if ($openElections->isNotEmpty()) {
                    throw ValidationException::withMessages(['semester' => ['The current semester still has an election that is upcoming or open: '.$openElections->implode(', ').'. Wait for it to close before starting the next semester.']]);
                }
                $currentYear = AcademicYear::where('is_current', true)->lockForUpdate()->first();
                if ($currentYear && $currentYear->id !== $semester->academic_year_id
                    && ($currentYear->semesters()->count() !== 2 || $currentYear->semesters()->where('status', 'upcoming')->exists())) {
                    throw ValidationException::withMessages(['semester' => ['Complete both semesters in the current academic year before starting a new year.']]);
                }
                $snapshots = app(SemesterSnapshotService::class);
                AcademicSemester::where('status', 'active')->get()->each(fn (AcademicSemester $closing) => $snapshots->snapshot($closing));
                AcademicSemester::where('status', 'active')->update(['status' => 'completed']);
                if ($currentYear && $currentYear->id !== $semester->academic_year_id) {
                    $currentYear->update(['closed_at' => now()]);
                }
                AcademicYear::where('is_current', true)->update(['is_current' => false]);
                $semester->academicYear()->update(['is_current' => true]);
                $semester->update(['status' => 'active']);
                $this->audit($request, 'academic_semester_activated', $semester);
            }

            return $semester;
        });

        return response()->json($semester->load('academicYear:id,label'));
    }

    public function close(Request $request, AcademicSemester $academicSemester)
    {
        DB::transaction(function () use ($request, $academicSemester) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $semester = AcademicSemester::whereKey($academicSemester->id)->lockForUpdate()->firstOrFail();
            $name = $this->name($semester);
            if (trim((string) $request->input('confirmation')) !== $name) {
                throw ValidationException::withMessages(['confirmation' => ["Type the semester name exactly as shown to close it: {$name}."]]);
            }
            if ($semester->status !== 'active') {
                throw ValidationException::withMessages(['semester' => ['Only the active semester can be closed.']]);
            }
            $openElections = $this->openElections([$semester->id]);
            if ($openElections->isNotEmpty()) {
                throw ValidationException::withMessages(['semester' => ['This semester still has an election that is upcoming or open: '.$openElections->implode(', ').'. Wait for it to close before closing the semester.']]);
            }
            app(SemesterSnapshotService::class)->snapshot($semester);
            $semester->update(['status' => 'completed']);
            $this->audit($request, 'academic_semester_closed', $semester);
        });

        return response()->json($academicSemester->load('academicYear:id,label'));
    }

    public function reopen(Request $request, AcademicSemester $academicSemester)
    {
        $semester = DB::transaction(function () use ($request, $academicSemester) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $semester = AcademicSemester::whereKey($academicSemester->id)->lockForUpdate()->firstOrFail();
            if ($semester->status !== 'completed') {
                throw ValidationException::withMessages(['semester' => ['Only a completed semester can be reopened.']]);
            }
            if ($semester->academicYear->closed_at) {
                throw ValidationException::withMessages(['semester' => ['A completed academic year cannot be reopened.']]);
            }
            if (AcademicSemester::where('status', 'active')->exists()) {
                throw ValidationException::withMessages(['semester' => ['A semester is already active. Close it before reopening another one.']]);
            }
            AcademicYear::where('is_current', true)->update(['is_current' => false]);
            $semester->academicYear()->update(['is_current' => true]);
            $semester->update(['status' => 'active']);
            $this->audit($request, 'academic_semester_reopened', $semester);

            return $semester;
        });

        return response()->json($semester->load('academicYear:id,label'));
    }

    private function name(AcademicSemester $semester): string
    {
        return ($semester->number === 1 ? '1st' : '2nd').' semester, AY '.$semester->academicYear->label;
    }

    private function openElections($semesterIds)
    {
        return Election::with('organization:id,name')->whereIn('academic_semester_id', $semesterIds)
            ->where(fn ($query) => $query->where('status', 'active')->orWhere(fn ($upcoming) => $upcoming->where('status', 'upcoming')->whereNotNull('approved_at')))
            ->orderBy('id')->get()
            ->map(fn (Election $election) => $election->title.' ('.($election->organization?->name ?? 'no organization').')');
    }

    public function destroy(Request $request, AcademicSemester $academicSemester)
    {
        $reasons = DB::transaction(function () use ($request, $academicSemester) {
            $semester = AcademicSemester::whereKey($academicSemester->id)->lockForUpdate()->firstOrFail();
            $compliance = ComplianceRequirementType::where('academic_semester_id', $semester->id)->lockForUpdate()->get();
            $events = EventRequirement::where('academic_semester_id', $semester->id)->lockForUpdate()->get();
            $reasons = $this->deletionBlockers($semester);

            if ($reasons === []) {
                $this->audit($request, 'academic_semester_deleted', $semester);
                ComplianceRequirementType::where('academic_semester_id', $semester->id)->delete();
                EventRequirement::where('academic_semester_id', $semester->id)->delete();
                $semester->delete();
                foreach ($compliance->concat($events) as $requirement) {
                    app(RequirementSampleService::class)->deleteAfterCommit($requirement->template_path);
                }
            }

            return $reasons;
        });

        if ($reasons !== []) {
            return response()->json(['message' => 'This semester cannot be deleted because of: '.implode(', ', $reasons).'.', 'reasons' => $reasons], 409);
        }

        return response()->noContent();
    }

    /** @return array<int, string> */
    private function deletionBlockers(AcademicSemester $semester): array
    {
        $requirementTypes = ComplianceRequirementType::where('academic_semester_id', $semester->id)->select('id');
        $eventRequirements = EventRequirement::where('academic_semester_id', $semester->id)->select('id');

        return array_keys(array_filter([
            'the active semester' => $semester->status === 'active',
            'events' => Event::where('academic_semester_id', $semester->id)->exists(),
            'elections' => Election::where('academic_semester_id', $semester->id)->exists(),
            'tasks' => Task::where('academic_semester_id', $semester->id)->exists(),
            'event requirement files' => EventRequirementFile::whereIn('requirement_id', $eventRequirements)->exists(),
            'compliance submissions' => OrganizationComplianceSubmission::whereIn('requirement_type_id', $requirementTypes)->exists(),
            'application documents' => OrganizationApplicationDocument::whereIn('requirement_type_id', $requirementTypes)->exists(),
        ]));
    }

    private function validateDates(AcademicYear $year, array $data, ?int $exceptId = null): void
    {
        if ($data['starts_on'] < $year->starts_on->toDateString() || $data['ends_on'] > $year->ends_on->toDateString()) {
            throw ValidationException::withMessages(['starts_on' => ['Semester dates must fall within the academic year.']]);
        }
        if ($year->semesters()->when($exceptId, fn ($query) => $query->whereKeyNot($exceptId))
            ->where('starts_on', '<=', $data['ends_on'])
            ->where('ends_on', '>=', $data['starts_on'])->exists()) {
            throw ValidationException::withMessages(['starts_on' => ['Semester dates cannot overlap.']]);
        }
    }

    private function audit(Request $request, string $action, AcademicSemester $semester): void
    {
        AuditLog::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'system_administration',
            'action' => $action,
            'description' => "SAO {$action} for academic year {$semester->academicYear->label}, semester {$semester->number}.",
            'record_type' => AcademicSemester::class,
            'record_id' => $semester->id,
            'new_values' => $semester->only(['academic_year_id', 'number', 'starts_on', 'ends_on', 'status']),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
