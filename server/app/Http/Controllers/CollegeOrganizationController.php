<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * A Department Head registers the student organizations of their own college.
 * The college always comes from the head's account, never from input. A new
 * organization stays pending and inactive until the SAO approves it, and the
 * registration documents are the same compliance submissions the SAO reviews
 * for renewal, stored on the private local disk.
 */
class CollegeOrganizationController extends Controller
{
    private const PENDING_LIMIT = 10;

    private const NO_REQUIREMENTS = 'No registration requirements are open. The SAO must activate a semester first.';

    public function index(Request $request)
    {
        $filters = $request->validate([
            'lifecycle_status' => ['nullable', 'in:pending,returned,active,archived,all'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $college = $this->college($request->user());

        $page = $this->query($college)
            ->when(($filters['lifecycle_status'] ?? 'all') !== 'all', fn ($query) => $query->where('lifecycle_status', $filters['lifecycle_status']))
            ->orderBy('name')
            ->paginate($filters['per_page'] ?? 50);

        $checklists = $this->checklists($page->getCollection()->whereIn('lifecycle_status', ['pending', 'returned'])->pluck('id'));
        $page->getCollection()->transform(fn (Organization $organization) => $this->row($organization, $checklists));

        return response()->json($page);
    }

    public function requirements(Request $request)
    {
        $this->college($request->user());
        [$semester, $types] = $this->registrationRequirements();

        return response()->json([
            'academic_semester' => $semester ? ['id' => $semester->id, 'number' => $semester->number, 'academic_year' => $semester->academicYear->label] : null,
            'requirements' => $types->map(fn (ComplianceRequirementType $type) => $type->only(['id', 'name', 'description', 'deadline_at']))->values(),
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        $college = $this->college($user);
        [$semester, $types] = $this->registrationRequirements();
        if (! $semester || $types->isEmpty()) {
            return response()->json(['message' => self::NO_REQUIREMENTS], 422);
        }

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('organizations', 'name')],
            'acronym' => ['required', 'string', 'max:50', Rule::unique('organizations', 'acronym')],
            'description' => ['nullable', 'string', 'max:3000'],
            'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'files' => ['required', 'array'],
            ...$types->mapWithKeys(fn (ComplianceRequirementType $type) => ["files.{$type->id}" => ['required', 'file', 'mimes:pdf', 'max:10240']])->all(),
        ]);
        $slug = $this->slugFor($data['name']);

        $stored = [];
        try {
            $organization = DB::transaction(function () use ($request, $user, $college, $types, $data, $slug, &$stored) {
                College::whereKey($college->id)->lockForUpdate()->first();
                if (Organization::student()->where('college_id', $college->id)->where('lifecycle_status', 'pending')->count() >= self::PENDING_LIMIT) {
                    throw ValidationException::withMessages(['name' => ['Too many registrations are waiting for SAO review. Wait for a decision before registering more.']]);
                }

                $organization = Organization::create([
                    'name' => $data['name'],
                    'slug' => $slug,
                    'acronym' => $data['acronym'],
                    'description' => $data['description'] ?? null,
                    'color' => $data['color'] ?? null,
                    'organization_type' => 'STUDENT_ORGANIZATION',
                    'college_id' => $college->id,
                    'college' => $college->name,
                    'lifecycle_status' => 'pending',
                    'is_active' => false,
                    'submitted_by' => $user->school_id,
                    'submitted_at' => now(),
                ]);
                foreach ($types as $type) {
                    $file = $request->file("files.{$type->id}");
                    $stored[] = $path = $file->store('compliance-submissions/'.$organization->id, 'local');
                    OrganizationComplianceSubmission::create([
                        'organization_id' => $organization->id,
                        'requirement_type_id' => $type->id,
                        ...$this->fileAttributes($path, $file, $user),
                    ]);
                }
                $this->audit($request, 'organization_registration_submitted', $organization, ['name' => $organization->name, 'college_id' => $college->id], 'A Department Head submitted a new organization for registration.');

                return $organization;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($stored);
            throw $error;
        }

        $this->notifyDirectors($organization, 'New organization registration', "{$college->name} submitted {$organization->name} for registration.");

        return response()->json($this->present($college, $organization->id), 201);
    }

    public function update(Request $request, Organization $organization)
    {
        $user = $request->user();
        $college = $this->college($user);
        abort_unless($organization->organization_type === 'STUDENT_ORGANIZATION' && (int) $organization->college_id === $college->id, 404);
        if ($organization->lifecycle_status !== 'returned') {
            return response()->json(['message' => 'Only a returned registration can be edited.'], 409);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255', Rule::unique('organizations', 'name')->ignore($organization->id)],
            'acronym' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('organizations', 'acronym')->ignore($organization->id)],
            'description' => ['nullable', 'string', 'max:3000'],
            'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'files' => ['sometimes', 'array:'.OrganizationComplianceSubmission::where('organization_id', $organization->id)->pluck('requirement_type_id')->implode(',')],
            'files.*' => ['file', 'mimes:pdf', 'max:10240'],
        ]);
        $changes = Arr::only($data, ['name', 'acronym', 'description', 'color']);
        if (isset($changes['name'])) {
            $changes['slug'] = $this->slugFor($changes['name'], $organization->id);
        }

        $stored = [];
        $replaced = [];
        try {
            $conflict = DB::transaction(function () use ($request, $user, $organization, $changes, $data, &$stored, &$replaced) {
                $locked = Organization::whereKey($organization->id)->lockForUpdate()->first();
                if ($locked->lifecycle_status !== 'returned') {
                    return true;
                }
                foreach ($data['files'] ?? [] as $typeId => $file) {
                    $submission = OrganizationComplianceSubmission::where('organization_id', $organization->id)->where('requirement_type_id', $typeId)->firstOrFail();
                    $replaced[] = $submission->file_path;
                    $stored[] = $path = $file->store('compliance-submissions/'.$organization->id, 'local');
                    $submission->update($this->fileAttributes($path, $file, $user));
                }
                $locked->update([
                    ...$changes,
                    'lifecycle_status' => 'pending',
                    'review_remarks' => null,
                    'submitted_by' => $user->school_id,
                    'submitted_at' => now(),
                    'reviewed_by' => null,
                    'reviewed_at' => null,
                ]);
                $this->audit($request, 'organization_registration_resubmitted', $locked, ['changes' => array_keys($changes), 'replaced_files' => count($replaced)], 'A Department Head resubmitted a returned organization registration.');

                return false;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($stored);
            throw $error;
        }
        if ($conflict) {
            return response()->json(['message' => 'Only a returned registration can be edited.'], 409);
        }
        Storage::disk('local')->delete($replaced);

        $this->notifyDirectors($organization, 'Organization registration resubmitted', "{$college->name} resubmitted ".($changes['name'] ?? $organization->name).' for registration.');

        return response()->json($this->present($college, $organization->id));
    }

    private function college(User $user): College
    {
        $home = Organization::whereKey($user->organization_id)->first(['id', 'organization_type', 'college_id']);
        $college = $home && $home->organization_type === 'COLLEGE' && $home->college_id ? College::find($home->college_id) : null;
        abort_if(! $college, 403, 'Your account is not assigned to a college.');

        return $college;
    }

    private function query(College $college)
    {
        return Organization::student()->where('college_id', $college->id)->withCount([
            'accountProfiles as members_count' => fn ($query) => $query->where('account_status', 'active'),
            'accountProfiles as administrators_count' => fn ($query) => $query->where('account_status', 'active')->where('role', 'ADMIN'),
        ]);
    }

    private function present(College $college, int $organizationId): array
    {
        $organization = $this->query($college)->findOrFail($organizationId);

        return $this->row($organization, $this->checklists(collect([$organization->id])));
    }

    private function row(Organization $organization, Collection $checklists): array
    {
        return [
            ...$organization->only(['id', 'name', 'acronym', 'slug', 'description', 'color', 'logo_url', 'college', 'college_id', 'lifecycle_status', 'is_active', 'review_remarks', 'submitted_at', 'reviewed_at', 'archived_at']),
            'members_count' => $organization->members_count,
            'administrators_count' => $organization->administrators_count,
            'registration_requirements' => $checklists->get($organization->id),
        ];
    }

    /** One checklist per organization id: every requirement it was asked for, with the file it submitted or null. */
    private function checklists(Collection $organizationIds): Collection
    {
        if ($organizationIds->isEmpty()) {
            return collect();
        }
        $submissions = OrganizationComplianceSubmission::whereIn('organization_id', $organizationIds)->get()->groupBy('organization_id');
        [, $current] = $this->registrationRequirements();
        $types = ComplianceRequirementType::whereIn('id', $current->pluck('id')->merge($submissions->flatten(1)->pluck('requirement_type_id')))->orderBy('id')->get();

        return $organizationIds->mapWithKeys(function ($organizationId) use ($submissions, $types) {
            $byType = ($submissions->get($organizationId) ?? collect())->keyBy('requirement_type_id');

            return [$organizationId => $types->map(fn (ComplianceRequirementType $type) => [
                'requirement_type_id' => $type->id,
                'requirement_name' => $type->name,
                'file_name' => $byType->get($type->id)?->file_original_name,
                'status' => $byType->get($type->id)?->status ?? 'not_submitted',
                'submission_id' => $byType->get($type->id)?->id,
            ])->values()];
        });
    }

    /** The registration set is every active requirement attached to the current semester. */
    private function registrationRequirements(): array
    {
        $semester = AcademicSemester::active();
        $types = $semester
            ? ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('is_active', true)->where('name', '!=', ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT)->orderBy('id')->get()
            : collect();

        return [$semester, $types];
    }

    private function fileAttributes(string $path, $file, User $user): array
    {
        return [
            'status' => 'submitted',
            'file_path' => $path,
            'file_original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getClientMimeType(),
            'file_size' => $file->getSize(),
            'remarks' => null,
            'submitted_by' => $user->school_id,
            'submitted_at' => now(),
            'reviewed_by' => null,
            'reviewed_at' => null,
        ];
    }

    private function slugFor(string $name, ?int $ignoreId = null): string
    {
        $slug = Str::slug($name);
        if (Organization::where('slug', $slug)->when($ignoreId, fn ($query) => $query->whereKeyNot($ignoreId))->exists()) {
            throw ValidationException::withMessages(['name' => ['An organization with a similar name already exists.']]);
        }

        return $slug;
    }

    private function notifyDirectors(Organization $organization, string $title, string $message): void
    {
        User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get(['school_id', 'organization_id'])
            ->each(fn (User $sao) => Notification::create([
                'organization_id' => $sao->organization_id,
                'user_id' => $sao->school_id,
                'notification_type' => 'general',
                'title' => $title,
                'message' => $message,
                'reference_type' => 'organization',
                'reference_id' => $organization->id,
                'is_read' => false,
                'sent_at' => now(),
            ]));
    }

    private function audit(Request $request, string $action, Organization $organization, array $values, string $description): void
    {
        AuditLog::create(['organization_id' => $organization->id, 'user_id' => $request->user()->school_id, 'actor_role' => $request->user()->role, 'module' => 'organizations', 'action' => $action, 'description' => $description, 'record_type' => Organization::class, 'record_id' => $organization->id, 'new_values' => $values, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
