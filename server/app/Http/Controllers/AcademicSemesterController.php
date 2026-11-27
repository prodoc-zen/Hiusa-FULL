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
use App\Services\Records\SemesterSnapshotService;
use App\Services\RequirementSampleService;
use App\Services\SemesterDefaults;
use Carbon\Carbon;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AcademicSemesterController extends Controller
{
    public function index(Request $request)
    {
        // Semesters of archived years stay in the picker, marked archived: they are completed, so choosing one is read only.
        return response()->json(AcademicSemester::with('academicYear:id,label,archived_at')
            ->when(! in_array($request->user()->role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'], true), fn ($query) => $query->where('status', '!=', 'upcoming'))
            ->orderByDesc('academic_year_id')->orderBy('number')->get()
            ->each(fn (AcademicSemester $semester) => $semester->setAttribute('archived', $semester->academicYear?->archived_at !== null)));
    }

    public function active()
    {
        return response()->json(AcademicSemester::active());
    }

    public function store(Request $request, AcademicYear $academicYear, SemesterDefaults $defaults)
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

        $semester = DB::transaction(function () use ($academicYear, $data, $request, $defaults) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $this->assertNotArchived(AcademicYear::findOrFail($academicYear->id));
            $semester = $academicYear->semesters()->create([
                ...$data,
                'status' => 'upcoming',
                'created_by' => $request->user()->school_id,
            ]);
            $defaults->create($semester, $request->user()->school_id);
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
            ComplianceRequirementType::where('academic_semester_id', $semester->id)
                ->whereBetween('deadline_at', [$semester->ends_on->copy()->startOfDay(), $semester->ends_on->copy()->endOfDay()])
                ->update(['deadline_at' => Carbon::parse($data['ends_on'])->endOfDay()]);
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
            $this->assertNotArchived($semester->academicYear);
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
                    $this->refuseForElections($openElections, 'The current semester still has an election that is upcoming or open: ');
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
                $this->refuseForElections($openElections, 'This semester still has an election that is upcoming or open: ');
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
            $this->assertNotArchived($semester->academicYear);
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

    /** An archived year is read only until the SAO restores it, so none of its semesters can start, reopen or grow. */
    private function assertNotArchived(AcademicYear $year): void
    {
        if ($year->archived_at !== null) {
            throw ValidationException::withMessages(['semester' => ['Restore this year first.']]);
        }
    }

    public function openElections($semesterIds)
    {
        return Election::with('organization:id,name')->whereIn('academic_semester_id', $semesterIds)
            ->where(fn ($query) => $query->where('status', 'active')->orWhere(fn ($upcoming) => $upcoming->where('status', 'upcoming')->whereNotNull('approved_at')))
            ->orderBy('id')->get();
    }

    /**
     * Refuses with the elections named in the message and listed beside it, so the page can say which organization owns each one.
     * Only that organization's Admin can cancel an election, so the SAO is pointed to the organization, never to a screen it cannot open.
     */
    public function refuseForElections($elections, string $before): never
    {
        $names = $elections->map(fn (Election $election) => $election->title.' ('.($election->organization?->name ?? 'no organization').')')->implode(', ');
        $message = $before.$names.'. The Admin of each organization can cancel its election, or you can wait for it to close.';

        throw new HttpResponseException(response()->json([
            'message' => $message,
            'errors' => ['semester' => [$message]],
            'elections' => $elections->map(fn (Election $election) => [
                'id' => $election->id,
                'title' => $election->title,
                'status' => $election->status,
                'organization_id' => $election->organization_id,
                'organization_name' => $election->organization?->name,
            ])->values()->all(),
        ], 422));
    }

    public function destroy(Request $request, AcademicSemester $academicSemester)
    {
        $reasons = DB::transaction(fn () => $this->remove($request, $academicSemester));

        if ($reasons !== []) {
            return response()->json(['message' => 'This semester cannot be deleted because of: '.implode(', ', $reasons).'.', 'reasons' => $reasons], 409);
        }

        return response()->noContent();
    }

    /**
     * Removes a semester and its requirements when nothing depends on it, otherwise says what does.
     * Call inside a transaction.
     *
     * @return array<int, string>
     */
    public function remove(Request $request, AcademicSemester $academicSemester): array
    {
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
    }

    /** @return array<int, string> */
    public function deletionBlockers(AcademicSemester $semester): array
    {
        $requirementTypes = ComplianceRequirementType::where('academic_semester_id', $semester->id)->select('id');
        $eventRequirements = EventRequirement::where('academic_semester_id', $semester->id)->select('id');

        return array_keys(array_filter([
            'the active semester' => $semester->status === 'active',
            'an archived academic year' => $semester->academicYear->archived_at !== null,
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
