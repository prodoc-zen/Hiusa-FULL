<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ClearancePeriod;
use App\Models\ComplianceRequirementType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The SAO's academic calendar. Exactly one year is current; accreditation is
 * measured against the current year's requirements, and new requirement sets
 * and clearance periods default to it.
 */
class AcademicYearController extends Controller
{
    public function index()
    {
        return response()->json(AcademicYear::with('semesters')->orderByDesc('starts_on')->get());
    }

    public function store(Request $request)
    {
        $data = $this->validated($request);
        $year = DB::transaction(function () use ($request, $data) {
            $year = AcademicYear::create([...$data, 'is_current' => ! AcademicYear::exists(), 'created_by' => $request->user()->school_id]);
            $this->audit($request, 'academic_year_created', $year);

            return $year;
        });

        return response()->json($year, 201);
    }

    public function update(Request $request, AcademicYear $academicYear)
    {
        $data = $this->validated($request, $academicYear);
        if ($academicYear->semesters()->where(fn ($query) => $query
            ->where('starts_on', '<', $data['starts_on'])
            ->orWhere('ends_on', '>', $data['ends_on']))->exists()) {
            throw ValidationException::withMessages(['starts_on' => ['Academic year dates must still contain its semesters.']]);
        }
        if ($data['label'] !== $academicYear->label && $this->isInUse($academicYear)) {
            throw ValidationException::withMessages(['label' => ["{$academicYear->label} already labels requirements or clearance periods, so its name stays."]]);
        }

        $academicYear->update($data);
        $this->audit($request, 'academic_year_updated', $academicYear);

        return response()->json($academicYear->fresh());
    }

    public function makeCurrent(Request $request, AcademicYear $academicYear)
    {
        if ($academicYear->closed_at) {
            throw ValidationException::withMessages(['academic_year' => ['A completed academic year cannot be reopened.']]);
        }
        if (AcademicSemester::where('status', 'active')->exists() && ! $academicYear->is_current) {
            throw ValidationException::withMessages(['academic_year' => ['Activate a semester in this year to change the active academic period.']]);
        }
        DB::transaction(function () use ($request, $academicYear) {
            AcademicYear::whereKeyNot($academicYear->id)->where('is_current', true)->update(['is_current' => false]);
            $academicYear->update(['is_current' => true]);
            $this->audit($request, 'academic_year_made_current', $academicYear);
        });

        return response()->json($academicYear->fresh());
    }

    public function close(Request $request, AcademicYear $academicYear)
    {
        if (! $academicYear->is_current || $academicYear->closed_at || $academicYear->semesters()->count() !== 2
            || $academicYear->semesters()->where('status', '!=', 'completed')->exists()) {
            throw ValidationException::withMessages(['academic_year' => ['Close both semesters before completing the current academic year.']]);
        }
        DB::transaction(function () use ($academicYear, $request) {
            AcademicYear::orderBy('id')->lockForUpdate()->first();
            $year = AcademicYear::whereKey($academicYear->id)->lockForUpdate()->firstOrFail();
            if (! $year->is_current || $year->closed_at || $year->semesters()->count() !== 2 || $year->semesters()->where('status', '!=', 'completed')->exists()) {
                throw ValidationException::withMessages(['academic_year' => ['This academic year is not ready to close.']]);
            }
            $year->update(['is_current' => false, 'closed_at' => now()]);
            $this->audit($request, 'academic_year_closed', $year);
        });

        return response()->json($academicYear->fresh());
    }

    public function destroy(Request $request, AcademicYear $academicYear)
    {
        if ($academicYear->is_current) {
            return response()->json(['message' => 'Make another academic year current before removing this one.'], 409);
        }
        if ($this->isInUse($academicYear)) {
            return response()->json(['message' => "{$academicYear->label} already has accreditation requirements or clearance periods, so it stays on the calendar."], 409);
        }

        $academicYear->delete();
        $this->audit($request, 'academic_year_deleted', $academicYear);

        return response()->json(['message' => 'Academic year removed.']);
    }

    private function isInUse(AcademicYear $year): bool
    {
        return $year->semesters()->exists()
            || ComplianceRequirementType::where('academic_year', $year->label)->exists()
            || ClearancePeriod::where('academic_year', $year->label)->exists();
    }

    private function validated(Request $request, ?AcademicYear $existing = null): array
    {
        $data = $request->validate([
            'label' => ['required', 'string', 'max:20', 'regex:/^\d{4}-\d{4}$/', Rule::unique('academic_years', 'label')->ignore($existing?->id)],
            'starts_on' => ['required', 'date'],
            'ends_on' => ['required', 'date', 'after:starts_on'],
        ], ['label.regex' => 'Use the form 2026-2027.']);

        [$first, $second] = array_map('intval', explode('-', $data['label']));
        if ($second !== $first + 1) {
            throw ValidationException::withMessages(['label' => ['Use two consecutive years, like 2026-2027.']]);
        }

        $overlap = AcademicYear::when($existing, fn ($query) => $query->whereKeyNot($existing->id))
            ->where('starts_on', '<', $data['ends_on'])
            ->where('ends_on', '>', $data['starts_on'])
            ->value('label');
        if ($overlap) {
            throw ValidationException::withMessages(['starts_on' => ["These dates overlap {$overlap}."]]);
        }

        return $data;
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
                default => "SAO updated academic year {$year->label}.",
            },
            'record_type' => AcademicYear::class,
            'record_id' => $year->id,
            'new_values' => $year->only(['label', 'starts_on', 'ends_on', 'is_current']),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
