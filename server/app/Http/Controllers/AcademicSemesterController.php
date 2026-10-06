<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ComplianceRequirementType;
use App\Models\EventRequirement;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AcademicSemesterController extends Controller
{
    private const RENEWAL_REQUIREMENTS = [
        'Letter of Intent',
        'Calendar of Activities (1st & 2nd Sem)',
        'Organizational Profile',
        'Constitutional By-Laws',
        'VMGO',
        'Official List of Officers',
        'Officers Data Sheets',
        "Faculty Adviser's Data Sheet / Certificate of Appointment",
        'Endorsement Letter',
        'List of Members',
    ];

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
            ->when($request->user()->role !== 'SUPER_ADMIN', fn ($query) => $query->where('status', '!=', 'upcoming'))
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
            foreach (self::RENEWAL_REQUIREMENTS as $name) {
                ComplianceRequirementType::create([
                    'academic_year' => $academicYear->label,
                    'academic_semester_id' => $semester->id,
                    'name' => $name,
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
                $currentYear = AcademicYear::where('is_current', true)->lockForUpdate()->first();
                if ($currentYear && $currentYear->id !== $semester->academic_year_id
                    && ($currentYear->semesters()->count() !== 2 || $currentYear->semesters()->where('status', 'upcoming')->exists())) {
                    throw ValidationException::withMessages(['semester' => ['Complete both semesters in the current academic year before starting a new year.']]);
                }
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
            if ($semester->status !== 'active') {
                throw ValidationException::withMessages(['semester' => ['Only the active semester can be closed.']]);
            }
            $semester->update(['status' => 'completed']);
            $this->audit($request, 'academic_semester_closed', $semester);
        });

        return response()->json($academicSemester->load('academicYear:id,label'));
    }

    private function validateDates(AcademicYear $year, array $data): void
    {
        if ($data['starts_on'] < $year->starts_on->toDateString() || $data['ends_on'] > $year->ends_on->toDateString()) {
            throw ValidationException::withMessages(['starts_on' => ['Semester dates must fall within the academic year.']]);
        }
        if ($year->semesters()->where('starts_on', '<=', $data['ends_on'])
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
