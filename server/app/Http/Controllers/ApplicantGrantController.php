<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\User;
use App\Support\NotFound;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A Department Head lets one student of their own college apply for a new organization.
 * The college always comes from the head's account and the student is picked from the
 * college's own people, so a head never types an ID and never reaches another college.
 */
class ApplicantGrantController extends Controller
{
    public function index(Request $request)
    {
        $college = $this->college($request->user());

        $grants = OrganizationApplicantGrant::where('college_id', $college->id)
            ->with(['student:school_id,first_name,last_name,email', 'application:id,name,acronym,status'])
            ->latest('id')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => $grants->map(fn (OrganizationApplicantGrant $grant) => $this->present($grant))->values(),
            'applications_open' => $this->applicationsOpen(),
        ]);
    }

    public function store(Request $request)
    {
        $college = $this->college($request->user());
        $data = $request->validate(['school_id' => ['required', 'integer', 'min:1', 'max:99999999']]);

        $grant = DB::transaction(function () use ($request, $college, $data) {
            College::whereKey($college->id)->lockForUpdate()->first();
            $student = $this->studentOf($college, (int) $data['school_id']);
            if (! $student) {
                throw ValidationException::withMessages(['school_id' => 'Pick a student of your college who has an account.']);
            }
            if ($organization = OrganizationApplicantGrant::blockingOrganization($student->school_id)) {
                throw ValidationException::withMessages(['school_id' => "This student already belongs to {$organization->name}."]);
            }
            if (OrganizationApplicantGrant::open()->where('college_id', $college->id)->where('user_school_id', $student->school_id)->exists()) {
                abort(409, "{$student->first_name} {$student->last_name} is already allowed to apply.");
            }

            $grant = OrganizationApplicantGrant::create(['college_id' => $college->id, 'user_school_id' => $student->school_id, 'granted_by' => $request->user()->school_id]);
            Notification::create([
                'organization_id' => $student->organization_id,
                'user_id' => $student->school_id,
                'notification_type' => 'general',
                'title' => 'You can apply for an organization',
                'message' => "{$college->name} allowed you to apply to register a new student organization. Open Apply for an organization in your menu.",
                'reference_type' => 'organization_applicant_grant',
                'reference_id' => $grant->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
            $this->audit($request, 'applicant_grant_created', $grant, $college, "Allowed {$student->first_name} {$student->last_name} to apply for an organization.");

            return $grant;
        });

        return response()->json($this->present($grant->load(['student:school_id,first_name,last_name,email', 'application:id,name,acronym,status'])), 201);
    }

    public function destroy(Request $request, OrganizationApplicantGrant $grant)
    {
        $college = $this->college($request->user());
        NotFound::unless($grant->college_id === $college->id);

        $revoked = DB::transaction(function () use ($request, $grant, $college) {
            $locked = OrganizationApplicantGrant::whereKey($grant->id)->lockForUpdate()->firstOrFail();
            if ($locked->used_application_id || $locked->revoked_at) {
                return null;
            }
            $locked->update(['revoked_at' => now()]);
            $this->audit($request, 'applicant_grant_revoked', $locked, $college, 'Took back permission to apply for an organization.');

            return $locked;
        });
        if (! $revoked) {
            return response()->json(['message' => 'This student already applied or the permission was taken back.'], 409);
        }

        return response()->json($this->present($revoked->load(['student:school_id,first_name,last_name,email', 'application:id,name,acronym,status'])));
    }

    /** The students a head may pick: signed-up students holding a student profile anywhere in the head's college. */
    private function studentOf(College $college, int $schoolId): ?User
    {
        $profile = AccountProfile::where('user_school_id', $schoolId)
            ->where('role', 'STUDENT')
            ->where('account_status', 'active')
            ->whereHas('organization', fn ($organization) => $organization->where('college_id', $college->id))
            ->exists();
        if (! $profile) {
            return null;
        }

        return User::whereKey($schoolId)->where('account_status', 'active')->first();
    }

    /** Students apply in the active semester, and only once the SAO has published its organization requirements. */
    private function applicationsOpen(): bool
    {
        $semester = AcademicSemester::active();

        return $semester !== null
            && ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('is_active', true)->where('category', 'organization')->exists();
    }

    private function college(User $user): College
    {
        $home = Organization::whereKey($user->organization_id)->first(['id', 'organization_type', 'college_id']);
        $college = $home && $home->organization_type === 'COLLEGE' && $home->college_id ? College::find($home->college_id) : null;
        abort_if(! $college, 403, 'Your account is not assigned to a college.');

        return $college;
    }

    private function present(OrganizationApplicantGrant $grant): array
    {
        $student = $grant->student;

        return [
            'id' => $grant->id,
            'state' => $grant->state(),
            'created_at' => $grant->created_at,
            'revoked_at' => $grant->revoked_at,
            'student' => $student ? ['school_id' => $student->school_id, 'name' => trim("{$student->first_name} {$student->last_name}"), 'email' => $student->email] : null,
            'application' => $grant->application ? $grant->application->only(['id', 'name', 'acronym', 'status']) : null,
        ];
    }

    private function audit(Request $request, string $action, OrganizationApplicantGrant $grant, College $college, string $description): void
    {
        AuditLog::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'organizations',
            'action' => $action,
            'description' => $description,
            'record_type' => OrganizationApplicantGrant::class,
            'record_id' => $grant->id,
            'new_values' => ['college_id' => $college->id, 'user_school_id' => $grant->user_school_id],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
