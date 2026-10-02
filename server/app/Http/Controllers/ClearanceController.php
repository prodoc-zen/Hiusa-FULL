<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\ClearancePeriod;
use App\Models\ClearanceSignature;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Digital clearances. SUPER_ADMIN opens a clearance period with a list of
 * required signatory roles. The special role "sao" is university-wide and
 * may only be signed by SUPER_ADMIN; every other role is organization-scoped
 * and may only be signed by an ADMIN or SBO_OFFICER of that student's own
 * organization (see canSign()). A clearance_signatures row exists per
 * (period, student, required role) from the moment the period is created,
 * so progress can always be read directly without recomputing membership.
 */
class ClearanceController extends Controller
{
    private const SAO_ROLE = 'sao';

    public function periodsIndex(Request $request)
    {
        $filters = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        return response()->json(ClearancePeriod::orderByDesc('id')->paginate($filters['per_page'] ?? 20));
    }

    public function periodsStore(Request $request)
    {
        $data = $request->validate([
            'academic_year' => ['required', 'string', 'max:20'],
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:3000'],
            'required_roles' => ['required', 'array', 'min:1', 'max:10'],
            'required_roles.*' => ['required', 'string', 'max:50'],
            'deadline_at' => ['nullable', 'date'],
        ]);
        $requiredRoles = array_values(array_unique($data['required_roles']));

        $period = DB::transaction(function () use ($data, $requiredRoles, $request) {
            $period = ClearancePeriod::create([
                'academic_year' => $data['academic_year'],
                'title' => $data['title'],
                'description' => $data['description'] ?? null,
                'required_roles' => $requiredRoles,
                'deadline_at' => $data['deadline_at'] ?? null,
                'created_by' => $request->user()->school_id,
            ]);

            // clearance_signatures has one row per (period, student, role) -
            // a student cannot owe the same required role twice, so this
            // must resolve to exactly one organization per student. Reading
            // only users.role/organization_id misses a student whose active
            // STUDENT standing exists solely through an account profile
            // (their home role is something else, e.g. an officer elsewhere)
            // - so read every active STUDENT profile instead and, ordering
            // by id, keep each user's earliest one, which is always their
            // home profile (created at account creation) when they have one.
            $studentMemberships = AccountProfile::where('role', 'STUDENT')
                ->where('account_status', 'active')
                ->orderBy('id')
                ->get(['user_school_id', 'organization_id'])
                ->unique('user_school_id');
            $now = now();
            $rows = [];
            foreach ($studentMemberships as $membership) {
                foreach ($requiredRoles as $role) {
                    $rows[] = [
                        'clearance_period_id' => $period->id,
                        'student_id' => $membership->user_school_id,
                        'organization_id' => $membership->organization_id,
                        'required_role' => $role,
                        'status' => 'pending',
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
            }
            foreach (array_chunk($rows, 500) as $chunk) {
                ClearanceSignature::insert($chunk);
            }

            AuditLog::create([
                'organization_id' => null,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'clearances',
                'action' => 'clearance_period_created',
                'record_type' => ClearancePeriod::class,
                'record_id' => $period->id,
                'new_values' => ['academic_year' => $period->academic_year, 'required_roles' => $requiredRoles, 'student_count' => $studentMemberships->count()],
                'ip_address' => $request->ip(),
                'created_at' => $now,
            ]);

            Notification::insert($studentMemberships->map(fn (AccountProfile $membership) => [
                'organization_id' => $membership->organization_id,
                'user_id' => $membership->user_school_id,
                'notification_type' => 'general',
                'title' => 'New clearance period opened',
                'message' => "A new clearance period is open: \"{$period->title}\". Check your clearance progress.",
                'reference_type' => 'clearance_period',
                'reference_id' => $period->id,
                'is_read' => false,
                'sent_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all());

            return $period;
        });

        return response()->json($period, 201);
    }

    public function studentsIndex(Request $request, ClearancePeriod $clearancePeriod)
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:150'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $studentIdsQuery = ClearanceSignature::where('clearance_period_id', $clearancePeriod->id)
            ->select('student_id')
            ->distinct();

        if ($request->user()->role !== 'SUPER_ADMIN') {
            $studentIdsQuery->where('organization_id', $request->user()->organization_id);
        }

        if (! empty($filters['q'])) {
            $search = $filters['q'];
            $studentIdsQuery->whereHas('student', fn ($q) => $q->where('school_id', 'like', "%{$search}%")
                ->orWhere('first_name', 'like', "%{$search}%")
                ->orWhere('last_name', 'like', "%{$search}%"));
        }

        // Eloquent counts pages with count(*), which ignores DISTINCT and would count one row per
        // required signature, so the distinct student total is computed and passed in.
        $total = (clone $studentIdsQuery)->count('student_id');
        $page = $studentIdsQuery->orderBy('student_id')->paginate($filters['per_page'] ?? 20, ['student_id'], 'page', null, $total);

        $rows = ClearanceSignature::where('clearance_period_id', $clearancePeriod->id)
            ->whereIn('student_id', $page->pluck('student_id'))
            ->with(['student:school_id,first_name,last_name,organization_id'])
            ->get();

        $byStudent = $rows->groupBy('student_id')->map(function ($studentRows) {
            $first = $studentRows->first();

            return [
                'student_id' => $first->student_id,
                'student_name' => trim(($first->student->first_name ?? '').' '.($first->student->last_name ?? '')),
                'organization_id' => $first->organization_id,
                'is_complete' => $studentRows->every(fn (ClearanceSignature $row) => $row->status === 'cleared'),
                'signatures' => $studentRows->map(fn (ClearanceSignature $row) => [
                    'id' => $row->id,
                    'required_role' => $row->required_role,
                    'status' => $row->status,
                ])->values(),
            ];
        })->values();

        $page->setCollection($byStudent);

        return response()->json($page);
    }

    public function mine(Request $request)
    {
        $signatures = ClearanceSignature::where('student_id', $request->user()->school_id)
            ->with(['clearancePeriod:id,academic_year,title,deadline_at'])
            ->get()
            ->groupBy('clearance_period_id');

        $result = $signatures->map(function ($rows) {
            $period = $rows->first()->clearancePeriod;

            return [
                'clearance_period_id' => $period->id,
                'academic_year' => $period->academic_year,
                'title' => $period->title,
                'deadline_at' => $period->deadline_at,
                'is_complete' => $rows->every(fn (ClearanceSignature $row) => $row->status === 'cleared'),
                'signatures' => $rows->map(fn (ClearanceSignature $row) => [
                    'id' => $row->id,
                    'required_role' => $row->required_role,
                    'status' => $row->status,
                    'remarks' => $row->remarks,
                ])->values(),
            ];
        })->values();

        return response()->json($result);
    }

    public function signaturesIndex(Request $request)
    {
        $filters = $request->validate([
            'clearance_period_id' => ['nullable', 'integer', 'exists:clearance_periods,id'],
            'status' => ['nullable', 'in:pending,cleared,held'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = ClearanceSignature::with(['student:school_id,first_name,last_name', 'clearancePeriod:id,title,academic_year']);
        if ($request->user()->role === 'SUPER_ADMIN') {
            $query->where('required_role', self::SAO_ROLE);
        } else {
            $query->where('required_role', '!=', self::SAO_ROLE)->where('organization_id', $request->user()->organization_id);
        }
        $query
            ->when($filters['clearance_period_id'] ?? null, fn ($q, $id) => $q->where('clearance_period_id', $id))
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status));

        return response()->json($query->orderBy('id')->paginate($filters['per_page'] ?? 20));
    }

    public function sign(Request $request, ClearanceSignature $clearanceSignature)
    {
        if (! $this->canSign($clearanceSignature, $request->user())) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $data = $request->validate([
            'status' => ['required', 'in:cleared,held'],
            'remarks' => ['nullable', 'string', 'max:2000', 'required_if:status,held'],
        ]);

        $result = DB::transaction(function () use ($request, $clearanceSignature, $data) {
            $signature = ClearanceSignature::whereKey($clearanceSignature->id)->lockForUpdate()->first();
            if ($signature->status === 'cleared') {
                return ['conflict' => 'This clearance line has already been cleared.'];
            }
            if ($signature->status === 'held' && $data['status'] !== 'cleared') {
                return ['conflict' => 'This clearance line is already held.'];
            }

            $signature->update([
                'status' => $data['status'],
                'remarks' => $data['remarks'] ?? null,
                'signed_by' => $request->user()->school_id,
                'signed_at' => now(),
            ]);

            AuditLog::create([
                'organization_id' => $signature->organization_id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'clearances',
                'action' => $data['status'] === 'cleared' ? 'signature_cleared' : 'signature_held',
                'record_type' => ClearanceSignature::class,
                'record_id' => $signature->id,
                'new_values' => ['required_role' => $signature->required_role, 'status' => $data['status'], 'remarks' => $data['remarks'] ?? null],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            $isComplete = ClearanceSignature::where('clearance_period_id', $signature->clearance_period_id)
                ->where('student_id', $signature->student_id)
                ->where('status', '!=', 'cleared')
                ->doesntExist();

            return ['signature' => $signature->fresh(), 'is_complete' => $isComplete];
        });

        if (isset($result['conflict'])) {
            return response()->json(['message' => $result['conflict']], 409);
        }

        $signature = $result['signature'];
        $student = User::find($signature->student_id);
        if ($student) {
            Notification::create([
                'organization_id' => $student->organization_id,
                'user_id' => $student->school_id,
                'notification_type' => 'general',
                'title' => $result['is_complete'] ? 'Your clearance is complete' : 'Your clearance was updated',
                'message' => $data['status'] === 'cleared'
                    ? ($result['is_complete'] ? 'All required signatures are complete.' : "Your \"{$signature->required_role}\" clearance signature was cleared.")
                    : "Your \"{$signature->required_role}\" clearance signature is on hold: ".$data['remarks'],
                'reference_type' => 'clearance_signature',
                'reference_id' => $signature->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }

        return response()->json($signature);
    }

    private function canSign(ClearanceSignature $signature, User $user): bool
    {
        if ($signature->required_role === self::SAO_ROLE) {
            return $user->role === 'SUPER_ADMIN';
        }

        return in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true)
            && $user->organization_id === $signature->organization_id;
    }
}
