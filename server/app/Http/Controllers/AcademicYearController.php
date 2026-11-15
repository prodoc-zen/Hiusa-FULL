<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ClearancePeriod;
use App\Models\ComplianceRequirementType;
use App\Services\Records\SemesterSnapshotService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The SAO's academic calendar. Exactly one year is current; accreditation is
 * measured against the current year's requirements, and new requirement sets
 * and clearance periods default to it. A year the SAO archives leaves every current view and every check
 * against the calendar, and keeps all of its records; restoring it brings it back as a past year.
 */
class AcademicYearController extends Controller
{
    public function index()
    {
        return response()->json(AcademicYear::with('semesters')->orderByDesc('starts_on')->get()->map(function (AcademicYear $year) {
            $blocker = $this->removalBlocker($year);

            return [...$year->toArray(), 'can_be_removed' => $blocker === null, 'removal_blocker' => $blocker];
        }));
    }

    public function store(Request $request)
    {
        $data = $this->validated($request);
        $year = DB::transaction(function () use ($request, $data) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $this->assertNoOverlap($data);
            $year = AcademicYear::create([...$data, 'is_current' => ! AcademicYear::notArchived()->exists(), 'created_by' => $request->user()->school_id]);
            $this->audit($request, 'academic_year_created', $year);

            return $year;
        });

        return response()->json($year, 201);
    }

    public function update(Request $request, AcademicYear $academicYear)
    {
        $this->assertNotArchived($academicYear);
        $data = $this->validated($request, $academicYear);
        if ($academicYear->semesters()->where(fn ($query) => $query
            ->where('starts_on', '<', $data['starts_on'])
            ->orWhere('ends_on', '>', $data['ends_on']))->exists()) {
            throw ValidationException::withMessages(['starts_on' => ['Academic year dates must still contain its semesters.']]);
        }

        DB::transaction(function () use ($request, $academicYear, $data) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $year = AcademicYear::whereKey($academicYear->id)->lockForUpdate()->firstOrFail();
            $this->assertNotArchived($year);
            $this->assertNoOverlap($data, $year);
            if ($data['label'] !== $year->label) {
                if ($this->labelIsLocked($year)) {
                    throw ValidationException::withMessages(['label' => ["{$year->label} already labels requirements or clearance periods, so its name stays."]]);
                }
                ComplianceRequirementType::where('academic_year', $year->label)
                    ->whereIn('academic_semester_id', $this->semesterIds($year))
                    ->update(['academic_year' => $data['label']]);
            }
            $year->update($data);
            $this->audit($request, 'academic_year_updated', $year);
        });

        return response()->json($academicYear->fresh());
    }

    public function makeCurrent(Request $request, AcademicYear $academicYear)
    {
        if ($academicYear->closed_at) {
            throw ValidationException::withMessages(['academic_year' => ['A completed academic year cannot be reopened.']]);
        }
        DB::transaction(function () use ($request, $academicYear) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $this->assertNotArchived(AcademicYear::findOrFail($academicYear->id));
            if (AcademicSemester::where('status', 'active')->where('academic_year_id', '!=', $academicYear->id)->exists()) {
                throw ValidationException::withMessages(['academic_year' => ['A semester in another academic year is active. Activate a semester in this year to change the current year.']]);
            }
            AcademicYear::whereKeyNot($academicYear->id)->where('is_current', true)->update(['is_current' => false]);
            $academicYear->update(['is_current' => true]);
            $this->audit($request, 'academic_year_made_current', $academicYear);
        });

        return response()->json($academicYear->fresh());
    }

    public function close(Request $request, AcademicYear $academicYear)
    {
        $this->assertNotArchived($academicYear);
        if (! $academicYear->is_current || $academicYear->closed_at || $academicYear->semesters()->count() !== 2
            || $academicYear->semesters()->where('status', '!=', 'completed')->exists()) {
            throw ValidationException::withMessages(['academic_year' => ['Close both semesters before completing the current academic year.']]);
        }
        DB::transaction(function () use ($academicYear, $request) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $year = AcademicYear::whereKey($academicYear->id)->lockForUpdate()->firstOrFail();
            $this->assertNotArchived($year);
            if (! $year->is_current || $year->closed_at || $year->semesters()->count() !== 2 || $year->semesters()->where('status', '!=', 'completed')->exists()) {
                throw ValidationException::withMessages(['academic_year' => ['This academic year is not ready to close.']]);
            }
            $year->update(['is_current' => false, 'closed_at' => now()]);
            $this->audit($request, 'academic_year_closed', $year);
        });

        return response()->json($academicYear->fresh());
    }

    /**
     * Puts a whole year away so the SAO can set up a new one without wiping the database. The active semester is
     * snapshotted and completed the way starting the next semester does it, semesters that never started are completed,
     * and the year stops being current. Nothing is deleted: every record keeps its semester.
     */
    public function archive(Request $request, AcademicYear $academicYear)
    {
        $year = DB::transaction(function () use ($request, $academicYear) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $year = AcademicYear::whereKey($academicYear->id)->lockForUpdate()->firstOrFail();
            if ($year->archived_at !== null) {
                throw ValidationException::withMessages(['academic_year' => ["{$year->label} is already archived."]]);
            }
            $semesters = AcademicSemester::where('academic_year_id', $year->id)->lockForUpdate()->get();
            $semesterController = app(AcademicSemesterController::class);
            $openElections = $semesterController->openElections($semesters->pluck('id'));
            if ($openElections->isNotEmpty()) {
                $semesterController->refuseForElections($openElections, "{$year->label} still has an election that is upcoming or open: ");
            }

            $snapshots = app(SemesterSnapshotService::class);
            $semesters->where('status', 'active')->each(fn (AcademicSemester $closing) => $snapshots->snapshot($closing));
            AcademicSemester::where('academic_year_id', $year->id)->whereIn('status', ['active', 'upcoming'])->update(['status' => 'completed']);
            $year->update(['is_current' => false, 'archived_at' => now(), 'archived_by' => $request->user()->school_id]);
            $this->audit($request, 'academic_year_archived', $year);

            return $year;
        });

        return response()->json($year->fresh('semesters'));
    }

    /** Brings an archived year back as a past year. It does not become current and no semester is reopened; the SAO does that with the usual buttons. */
    public function restore(Request $request, AcademicYear $academicYear)
    {
        $year = DB::transaction(function () use ($request, $academicYear) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $year = AcademicYear::whereKey($academicYear->id)->lockForUpdate()->firstOrFail();
            if ($year->archived_at === null) {
                throw ValidationException::withMessages(['academic_year' => ["{$year->label} is not archived."]]);
            }
            $overlap = AcademicYear::notArchived()->whereKeyNot($year->id)
                ->where('starts_on', '<', $year->ends_on->toDateString())
                ->where('ends_on', '>', $year->starts_on->toDateString())
                ->value('label');
            if ($overlap) {
                throw ValidationException::withMessages(['academic_year' => ["{$year->label} cannot be restored because its dates overlap {$overlap}. Remove or change {$overlap} first."]]);
            }
            $year->update(['archived_at' => null, 'archived_by' => null]);
            $this->audit($request, 'academic_year_restored', $year);

            return $year;
        });

        return response()->json($year->fresh('semesters'));
    }

    public function destroy(Request $request, AcademicYear $academicYear)
    {
        $blocker = DB::transaction(function () use ($request, $academicYear) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $year = AcademicYear::whereKey($academicYear->id)->lockForUpdate()->firstOrFail();
            $blocker = $this->removalBlocker($year);
            if ($blocker !== null) {
                return $blocker;
            }
            foreach ($year->semesters as $semester) {
                abort_if(app(AcademicSemesterController::class)->remove($request, $semester) !== [], 409, "{$year->label} was not removed because a semester changed while it was being removed. Try again.");
            }
            $year->delete();
            $this->audit($request, 'academic_year_deleted', $year);

            return null;
        });
        if ($blocker !== null) {
            return response()->json(['message' => $blocker], 409);
        }

        return response()->json(['message' => 'Academic year removed.']);
    }

    /**
     * Why a year cannot be removed, or null when it can. Current or not, a year goes when none of its
     * semesters ever started and nothing but those semesters' own default requirements carries its label.
     */
    private function removalBlocker(AcademicYear $year): ?string
    {
        $semesters = $year->semesters;
        if ($year->archived_at) {
            return "{$year->label} is archived. Restore it first if it should change.";
        }
        if ($year->closed_at || $semesters->contains(fn (AcademicSemester $semester) => $semester->status !== 'upcoming')) {
            return "{$year->label} has a semester that has started, so it stays on the calendar.";
        }
        if ($this->hasLooseRecords($year)) {
            return "{$year->label} already has accreditation requirements or clearance periods, so it stays on the calendar.";
        }
        foreach ($semesters as $semester) {
            $reasons = app(AcademicSemesterController::class)->deletionBlockers($semester);
            if ($reasons !== []) {
                return 'The '.($semester->number === 1 ? '1st' : '2nd')." semester of {$year->label} has ".implode(', ', $reasons).', so the year stays on the calendar.';
            }
        }

        return null;
    }

    private function labelIsLocked(AcademicYear $year): bool
    {
        return AcademicSemester::where('academic_year_id', $year->id)->where('status', '!=', 'upcoming')->exists()
            || $this->hasLooseRecords($year);
    }

    /** Requirements and clearance periods that carry the label but are not a semester's own. */
    private function hasLooseRecords(AcademicYear $year): bool
    {
        return ComplianceRequirementType::where('academic_year', $year->label)
            ->where(fn ($query) => $query->whereNull('academic_semester_id')->orWhereNotIn('academic_semester_id', $this->semesterIds($year)))->exists()
            || ClearancePeriod::where('academic_year', $year->label)->exists();
    }

    /** @return array<int, int> */
    private function semesterIds(AcademicYear $year): array
    {
        return AcademicSemester::where('academic_year_id', $year->id)->pluck('id')->all();
    }

    private function validated(Request $request, ?AcademicYear $existing = null): array
    {
        $data = $request->validate([
            'label' => ['required', 'string', 'max:20', 'regex:/^\d{4}-\d{4}$/', function (string $attribute, mixed $value, \Closure $fail) use ($existing) {
                $taken = AcademicYear::where('label', $value)->when($existing, fn ($query) => $query->whereKeyNot($existing->id))->first();
                if ($taken) {
                    $fail($taken->archived_at ? "{$taken->label} is archived. Restore it, or use a different label." : 'The label has already been taken.');
                }
            }],
            'starts_on' => ['required', 'date'],
            'ends_on' => ['required', 'date', 'after:starts_on'],
        ], ['label.regex' => 'Use the form 2026-2027.']);

        [$first, $second] = array_map('intval', explode('-', $data['label']));
        if ($second !== $first + 1) {
            throw ValidationException::withMessages(['label' => ['Use two consecutive years, like 2026-2027.']]);
        }

        $this->assertNoOverlap($data, $existing);

        return $data;
    }

    /** Archived years are put away, so their dates may be used again. */
    private function assertNoOverlap(array $data, ?AcademicYear $existing = null): void
    {
        $overlap = AcademicYear::notArchived()->when($existing, fn ($query) => $query->whereKeyNot($existing->id))
            ->where('starts_on', '<', $data['ends_on'])
            ->where('ends_on', '>', $data['starts_on'])
            ->value('label');
        if ($overlap) {
            throw ValidationException::withMessages(['starts_on' => ["These dates overlap {$overlap}."]]);
        }
    }

    private function assertNotArchived(AcademicYear $year): void
    {
        if ($year->archived_at !== null) {
            throw ValidationException::withMessages(['academic_year' => ['Restore this year first.']]);
        }
    }

    private function audit(Request $request, string $action, AcademicYear $year): void
    {
        AuditLog::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'system_administration',
            'action' => $action,
            'description' => match ($action) {
                'academic_year_created' => "SAO added academic year {$year->label}.",
                'academic_year_made_current' => "SAO made {$year->label} the current academic year.",
                'academic_year_deleted' => "SAO removed academic year {$year->label}.",
                'academic_year_archived' => "SAO archived academic year {$year->label}.",
                'academic_year_restored' => "SAO restored academic year {$year->label}.",
                default => "SAO updated academic year {$year->label}.",
            },
            'record_type' => AcademicYear::class,
            'record_id' => $year->id,
            'new_values' => $year->only(['label', 'starts_on', 'ends_on', 'is_current', 'archived_at']),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
