<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\SboPosition;
use App\Models\User;
use App\Services\PasswordResetService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class OrganizationApplicationController extends Controller
{
    public function colleges()
    {
        return response()->json(College::where('is_active', true)->orderBy('name')->get(['id', 'name']));
    }

    public function store(Request $request)
    {
        $request->merge(['email' => Str::lower(trim((string) $request->input('email')))]);
        $data = $request->validate([
            'college_id' => ['required', Rule::exists('colleges', 'id')->where('is_active', true)],
            'name' => ['required', 'string', 'max:255', 'unique:organizations,name'],
            'acronym' => ['required', 'string', 'max:50', 'unique:organizations,acronym'],
            'description' => ['nullable', 'string', 'max:3000'],
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'email', 'max:255'],
            'position_title' => ['required', 'string', 'max:100'],
        ]);
        $existing = User::whereKey($data['school_id'])->orWhere('email', $data['email'])->first();
        if ($existing && ($existing->school_id !== (int) $data['school_id'] || Str::lower($existing->email) !== $data['email'] || $existing->role === 'SUPER_ADMIN' || $existing->account_status !== 'active')) {
            throw ValidationException::withMessages(['email' => 'Use the school ID and email belonging to the same applicant account.']);
        }
        $application = DB::transaction(function () use ($data) {
            College::whereKey($data['college_id'])->where('is_active', true)->lockForUpdate()->firstOrFail();
            OrganizationApplication::where('status', 'pending_verification')->where('created_at', '<=', now()->subDays(2))->update(['status' => 'expired']);
            if (OrganizationApplication::whereNotIn('status', ['rejected', 'approved', 'expired'])
                ->where(fn ($q) => $q->where('name', $data['name'])->orWhere('acronym', $data['acronym']))->exists()) {
                throw ValidationException::withMessages(['name' => 'An application for this organization is already being reviewed.']);
            }

            return OrganizationApplication::create($data);
        });
        try {
            $url = URL::temporarySignedRoute('organization-applications.verify', now()->addDays(2), ['application' => $application->id]);
            Mail::raw("Hello {$application->first_name} {$application->last_name},\n\nVerify your HIUSA organization application using this link within 48 hours:\n{$url}\n\nYour department head will then review it for endorsement before SAO approval.", fn ($mail) => $mail->to($application->email)->subject('Verify your HIUSA organization application'));
        } catch (\Throwable $error) {
            $application->delete();
            report($error);

            return response()->json(['message' => 'The verification email could not be sent. Please submit again later.'], 503);
        }

        return response()->json(['message' => 'Check your email to verify the application. The link expires in 48 hours.'], 201);
    }

    public function verify(OrganizationApplication $application)
    {
        DB::transaction(function () use ($application) {
            $application = OrganizationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
            if ($application->status !== 'pending_verification') {
                return;
            }
            abort_unless($application->college?->is_active, 409, 'This application’s college is no longer active.');
            $application->update(['status' => 'pending_endorsement', 'email_verified_at' => now()]);
            $college = $application->college;
            User::where('role', 'DEPARTMENT_HEAD')->where('account_status', 'active')
                ->where(fn ($q) => $q->where('department', $college->name)->orWhereHas('organization', fn ($org) => $org->where('college', $college->name)))
                ->get()->each(fn ($user) => $this->notify($user, $application, 'Organization application awaiting endorsement'));
        });

        return redirect(rtrim(config('app.frontend_url'), '/').'/register-organization?verified=1');
    }

    private function scopeForHead($query, User $user)
    {
        $collegeName = $user->organization?->college ?: $user->department;

        return $query->whereHas('college', fn ($q) => $q->where('name', $collegeName ?: '__unassigned__'));
    }

    public function index(Request $request)
    {
        $data = $request->validate(['status' => ['nullable', 'in:pending_endorsement,endorsed,approved,rejected'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = OrganizationApplication::with('college:id,name')->whereNotNull('email_verified_at');
        if ($request->user()->role === 'DEPARTMENT_HEAD') {
            $this->scopeForHead($query, $request->user());
        }
        if (! empty($data['status'])) {
            $query->where('status', $data['status']);
        }

        return response()->json($query->latest()->paginate($data['per_page'] ?? 10));
    }

    public function review(Request $request, OrganizationApplication $application, PasswordResetService $passwords)
    {
        $actor = $request->user();
        if ($actor->role === 'DEPARTMENT_HEAD' && ! $this->scopeForHead(OrganizationApplication::whereKey($application->id), $actor)->exists()) {
            abort(404);
        }
        $data = $request->validate(['action' => ['required', Rule::in($actor->role === 'DEPARTMENT_HEAD' ? ['endorse', 'reject'] : ['approve', 'reject'])], 'remarks' => ['nullable', 'string', 'max:2000', 'required_if:action,reject']]);
        $newUser = false;
        $admin = DB::transaction(function () use ($application, $data, $actor, &$newUser) {
            $application = OrganizationApplication::whereKey($application->id)->lockForUpdate()->firstOrFail();
            $expected = $actor->role === 'DEPARTMENT_HEAD' ? 'pending_endorsement' : 'endorsed';
            abort_if($application->status !== $expected, 409, 'This application is not awaiting your review. Refresh the queue.');
            abort_unless($application->email_verified_at, 409, 'The applicant must verify their email before review.');
            $college = College::whereKey($application->college_id)->where('is_active', true)->lockForUpdate()->first();
            abort_unless($college, 409, 'The college is no longer active.');
            $admin = null;
            if ($data['action'] === 'approve') {
                abort_if(Organization::where('name', $application->name)->orWhere('acronym', $application->acronym)->exists(), 409, 'This organization is already registered.');
                $organization = Organization::create(['name' => $application->name, 'slug' => Str::slug($application->name).'-'.Str::lower(Str::random(6)), 'acronym' => $application->acronym, 'college' => $college->name, 'description' => $application->description, 'organization_type' => 'STUDENT_ORGANIZATION', 'is_active' => true]);
                $admin = User::whereKey($application->school_id)->lockForUpdate()->first();
                abort_if($admin && (Str::lower($admin->email) !== $application->email || $admin->role === 'SUPER_ADMIN' || $admin->account_status !== 'active'), 409, 'The applicant account has changed or is inactive.');
                SboPosition::firstOrCreate(['organization_id' => $organization->id, 'role' => 'ADMIN', 'title' => $application->position_title], ['is_active' => true]);
                if ($admin) {
                    AccountProfile::create(['user_school_id' => $admin->school_id, 'organization_id' => $organization->id, 'role' => 'ADMIN', 'account_status' => 'active', 'position_title' => $application->position_title]);
                } else {
                    abort_if(User::where('email', $application->email)->exists(), 409, 'The applicant email is already assigned to another school ID.');
                    $admin = User::create(['school_id' => $application->school_id, 'organization_id' => $organization->id, 'first_name' => $application->first_name, 'last_name' => $application->last_name, 'email' => $application->email, 'position_title' => $application->position_title, 'department' => $college->name, 'role' => 'ADMIN', 'account_status' => 'active', 'is_member' => true, 'password_hash' => Str::random(64)]);
                    $newUser = true;
                }
                $application->organization_id = $organization->id;
            }
            $application->status = match ($data['action']) {
                'endorse' => 'endorsed', 'approve' => 'approved', default => 'rejected'
            };
            $application->remarks = $data['remarks'] ?? null;
            if ($data['action'] === 'endorse') {
                $application->endorsed_by = $actor->school_id;
                $application->endorsed_at = now();
                User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get()->each(fn ($user) => $this->notify($user, $application, 'Endorsed organization application for SAO review'));
            } else {
                $application->reviewed_by = $actor->school_id;
                $application->reviewed_at = now();
            }
            $application->save();
            AuditLog::create(['organization_id' => $actor->organization_id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role, 'module' => 'organization_applications', 'action' => $application->status, 'record_type' => OrganizationApplication::class, 'record_id' => $application->id, 'new_values' => ['status' => $application->status], 'created_at' => now(), 'ip_address' => request()->ip()]);

            return $admin;
        });
        $application->refresh();
        try {
            if ($newUser) {
                $passwords->issue($admin);
            }
            Mail::raw("Hello {$application->first_name} {$application->last_name},\n\nYour application for {$application->name} is now {$application->status}.\n".($application->remarks ?: '').($admin ? "\nYou are the organization's first administrator. Sign in at ".rtrim(config('app.frontend_url'), '/').'/login'.($newUser ? '. A separate email contains your password setup link.' : ' using your existing account.') : ''), fn ($mail) => $mail->to($application->email)->subject('HIUSA organization application update'));
            $application->setAttribute('email_sent', true);
        } catch (\Throwable $error) {
            report($error);
            $application->setAttribute('email_sent', false);
        }

        return response()->json($application);
    }

    private function notify(User $user, OrganizationApplication $application, string $title): void
    {
        Notification::create(['organization_id' => $user->organization_id, 'user_id' => $user->school_id, 'notification_type' => 'general', 'title' => $title, 'message' => $application->name, 'reference_type' => 'organization_application', 'reference_id' => $application->id, 'is_read' => false, 'sent_at' => now()]);
    }
}
