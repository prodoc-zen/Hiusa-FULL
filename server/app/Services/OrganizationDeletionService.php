<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class OrganizationDeletionService
{
    // Children precede parents, including tables whose organization FK normally sets null.
    private const TABLES = [
        'event_requirement_files', 'organization_compliance_submissions', 'task_recommendations',
        'task_progress_updates', 'fingerprint_verifications', 'fingerprints', 'clearance_signatures',
        'evaluation_responses', 'event_registrations', 'venue_bookings', 'approval_requests',
        'announcement_recipients', 'grievances', 'notifications', 'orders', 'invoices',
        'cash_advances', 'collections', 'transactions', 'financial_reports', 'budgets',
        'financial_forecasts', 'financial_semesters', 'tasks', 'events', 'elections',
        'partylists', 'merchandise_variants', 'merchandise', 'announcements', 'ai_outputs',
        'academic_programs', 'sbo_positions', 'password_reset_tokens', 'account_profiles', 'audit_logs',
    ];

    private const FILES = [
        'organizations' => ['public' => ['logo_url', 'gcash_qr_url'], 'uploads' => ['logo_url', 'gcash_qr_url']],
        'announcements' => ['public' => ['image_url'], 'uploads' => ['image_url']],
        'events' => ['public' => ['image_url'], 'uploads' => ['image_url']],
        'elections' => ['public' => ['image_url'], 'uploads' => ['image_url'], 'local' => ['informative_letter_path']],
        'candidates' => ['public' => ['image_url'], 'uploads' => ['image_url']],
        'partylists' => ['public' => ['banner_url'], 'uploads' => ['banner_url']],
        'merchandise' => ['public' => ['image_url'], 'uploads' => ['image_url']],
        'merchandise_variants' => ['public' => ['image_url'], 'uploads' => ['image_url']],
        'orders' => ['public' => ['payment_proof_url'], 'uploads' => ['payment_proof_url'], 'local' => ['payment_proof_url']],
        'transactions' => ['public' => ['receipt_file_url']],
        'financial_reports' => ['public' => ['pdf_url', 'excel_url'], 'local' => ['letterhead_path', 'supporting_documents']],
        'organization_compliance_submissions' => ['local' => ['file_path']],
        'event_requirement_files' => ['local' => ['path']],
        'organization_application_documents' => ['local' => ['file_path']],
        'users' => ['public' => ['photo_path']],
        'colleges' => ['public' => ['logo_url']],
    ];

    public function deleteOrganization(Organization $organization, User $actor, ?string $ip): void
    {
        $this->delete([$organization->id], null, $organization->name, $actor, $ip);
    }

    public function deleteCollege(College $college, User $actor, ?string $ip): void
    {
        $this->delete([], $college, $college->name, $actor, $ip);
    }

    private function delete(array $ids, ?College $college, string $name, User $actor, ?string $ip): void
    {
        $pendingIds = DB::transaction(function () use ($ids, $college, $name, $actor, $ip) {
            if ($college) {
                $college = College::whereKey($college->id)->lockForUpdate()->firstOrFail();
                $ids = Organization::where(fn ($query) => $query->where('college_id', $college->id)->orWhere('college', $college->name))->pluck('id')->all();
            }
            $organizations = Organization::whereIn('id', $ids)->lockForUpdate()->get();
            abort_if(! $college && $organizations->count() !== count($ids), 404);
            abort_if(($college?->name ?? $organizations->first()?->name) !== $name, 409, 'The name changed. Refresh and confirm the current name before deleting.');
            abort_if($organizations->contains('organization_type', 'SYSTEM_ADMINISTRATION') || in_array($actor->organization_id, $ids), 409, 'The SAO department cannot be deleted.');
            abort_if(! $college && $organizations->contains(fn ($org) => $org->organization_type !== 'STUDENT_ORGANIZATION'), 404);
            abort_if(Organization::whereIn('parent_organization_id', $ids)->whereNotIn('id', $ids)->exists(), 409, 'Move or delete the suborganizations first.');
            $users = User::where(fn ($query) => $query->whereIn('organization_id', $ids)
                ->orWhereHas('accountProfiles', fn ($profiles) => $profiles->whereIn('organization_id', $ids)))->lockForUpdate()->get();
            abort_if($users->contains(fn ($user) => $user->getRawOriginal('role') === 'SUPER_ADMIN'), 409, 'The SAO account cannot be deleted.');
            abort_if(DB::table('account_profiles')->whereIn('organization_id', $ids)->where('role', 'SUPER_ADMIN')->exists(), 409, 'The SAO account cannot be deleted.');
            $orphanIds = collect();
            $files = collect();
            $electionIds = DB::table('elections')->whereIn('organization_id', $ids)->pluck('id');
            $applicationIds = DB::table('organization_applications')->where(function ($query) use ($ids, $college) {
                $query->whereIn('organization_id', $ids);
                if ($college) {
                    $query->orWhere('college_id', $college->id);
                }
            })->pluck('id');
            foreach (self::FILES as $table => $disks) {
                $query = DB::table($table);
                if ($table === 'candidates') {
                    $query->whereIn('election_id', $electionIds);
                } elseif ($table === 'organization_application_documents') {
                    $query->whereIn('organization_application_id', $applicationIds);
                } elseif (in_array($table, ['users', 'colleges'], true)) {
                    continue;
                } elseif ($table === 'organizations') {
                    $query->whereIn('id', $ids);
                } else {
                    $query->whereIn('organization_id', $ids);
                }
                $this->collectFiles($table, $query->get(), $files);
            }
            foreach ($users as $user) {
                $remaining = $user->accountProfiles()->whereNotIn('organization_id', $ids)->orderBy('id')->first();
                if (! in_array((int) $user->getRawOriginal('organization_id'), $ids, true)) {
                    continue;
                }
                if ($remaining) {
                    DB::table('users')->where('school_id', $user->school_id)->update([
                        'organization_id' => $remaining->organization_id, 'role' => $remaining->role,
                        'account_status' => $remaining->account_status, 'position_title' => $remaining->position_title,
                        'department' => $remaining->organization?->getRawOriginal('college'),
                    ]);
                } else {
                    $orphanIds->push($user->school_id);
                    $this->collectFiles('users', collect([$user]), $files);
                }
            }
            if ($college) {
                $this->collectFiles('colleges', collect([$college]), $files);
            }
            $profileIds = DB::table('account_profiles')->whereIn('organization_id', $ids)->pluck('id');
            DB::table('personal_access_tokens')->where(fn ($query) => $query->whereIn('account_profile_id', $profileIds)->orWhereIn('tokenable_id', $users->pluck('school_id')))->delete();
            DB::table('organization_applications')->whereIn('id', $applicationIds)->delete();
            foreach (self::TABLES as $table) {
                DB::table($table)->whereIn('organization_id', $ids)->delete();
            }
            // University-wide settings survive deletion of their original author.
            foreach (['compliance_requirement_types', 'clearance_periods'] as $table) {
                DB::table($table)->whereIn('created_by', $orphanIds)->update(['created_by' => $actor->school_id]);
            }
            // A shared identity's surviving profiles and records belong to their other organizations.
            // Orphan accounts with external restricted records require those records to be reassigned first.
            foreach (['transactions' => 'recorded_by', 'collections' => 'collected_by', 'cash_advances' => 'borrower_id',
                'invoices' => 'student_id', 'event_requirement_files' => 'uploaded_by', 'remittances' => 'remitted_by',
                'cash_advance_repayments' => 'recorded_by', 'invoice_payments' => 'recorded_by',
                'events' => 'created_by', 'tasks' => 'created_by', 'orders' => 'student_id',
                'venue_bookings' => 'requested_by', 'organization_compliance_submissions' => 'submitted_by',
                'grievances' => 'submitted_by', 'fingerprints' => 'user_id', 'evaluation_responses' => 'user_id',
                'approval_requests' => 'requested_by', 'clearance_signatures' => 'student_id',
                'event_registrations' => 'user_id'] as $table => $column) {
                abort_if(DB::table($table)->whereIn($column, $orphanIds)->exists(), 409, 'A college user has records in another organization. Reassign those records or give the user a surviving profile before deleting.');
            }
            foreach (['votes' => 'voter_id', 'candidates' => 'user_id', 'attendance' => 'user_id'] as $table => $column) {
                abort_if(DB::table($table)->whereIn($column, $orphanIds)->exists(), 409, 'A college user has participation records in another organization. Give the user a surviving profile before deleting.');
            }
            DB::table('sessions')->whereIn('user_id', $orphanIds)->delete();
            DB::table('password_reset_tokens')->whereIn('email', $users->whereIn('school_id', $orphanIds)->pluck('email'))->delete();
            DB::table('users')->whereIn('school_id', $orphanIds)->delete();
            Organization::whereIn('id', $ids)->update(['parent_organization_id' => null]);
            Organization::whereIn('id', $ids)->delete();
            if ($college) {
                $college->forceDelete();
            }
            $files = $files->unique(fn ($file) => $file['disk'].':'.$file['path']);
            $candidatePaths = $files->mapWithKeys(fn ($file) => [$file['disk'].':'.$file['path'] => true]);
            $retainedFiles = collect();
            foreach (self::FILES as $table => $disks) {
                $columns = array_unique(array_merge(...array_values($disks)));
                $this->collectFiles($table, DB::table($table)->select($columns)->cursor(), $retainedFiles, $candidatePaths);
            }
            $retainedPaths = $retainedFiles->mapWithKeys(fn ($file) => [$file['disk'].':'.$file['path'] => true]);
            $files = $files->reject(fn ($file) => isset($retainedPaths[$file['disk'].':'.$file['path']]));
            AuditLog::create([
                'organization_id' => $actor->organization_id, 'user_id' => $actor->school_id, 'actor_role' => 'SUPER_ADMIN',
                'module' => $college ? 'colleges' : 'system_administration', 'action' => $college ? 'college_permanently_deleted' : 'organization_deleted',
                'description' => 'SAO permanently deleted '.$name.'.', 'record_type' => $college ? College::class : Organization::class,
                'record_id' => $college?->id ?? ($ids[0] ?? null), 'new_values' => ['organization_ids' => $ids, 'deleted_users' => $orphanIds->count()],
                'ip_address' => $ip, 'created_at' => now(),
            ]);

            return $files->unique(fn ($file) => $file['disk'].':'.$file['path'])->map(fn ($file) => DB::table('pending_file_deletions')->insertGetId($file))->all();
        });
        // Never remove physical files until every database change has committed.
        $this->cleanup($pendingIds);
    }

    private function collectFiles(string $table, iterable $rows, Collection $files, ?Collection $candidatePaths = null): void
    {
        foreach ($rows as $row) {
            foreach (self::FILES[$table] as $disk => $columns) {
                foreach ($columns as $column) {
                    $values = $column === 'supporting_documents'
                        ? array_column(is_array($row->$column ?? null) ? $row->$column : (json_decode($row->$column ?? '[]', true) ?: []), 'path')
                        : [$row->$column ?? null];
                    foreach ($values as $value) {
                        if (! is_string($value) || $value === '') {
                            continue;
                        }
                        $path = $value;
                        if (in_array($disk, ['public', 'uploads'], true) && (str_starts_with($value, '/') || str_contains($value, '://'))) {
                            $host = parse_url($value, PHP_URL_HOST);
                            if ($host && strcasecmp($host, (string) parse_url(config('app.url'), PHP_URL_HOST)) !== 0) {
                                continue;
                            }
                            $urlPath = parse_url($value, PHP_URL_PATH);
                            $prefix = $disk === 'uploads' ? '/uploads/' : '/storage/';
                            if (! is_string($urlPath) || ! str_starts_with($urlPath, $prefix)) {
                                continue;
                            }
                            $path = substr($urlPath, strlen($prefix));
                        } elseif ($disk === 'uploads') {
                            continue;
                        }
                        if ($path !== '' && ! str_starts_with($path, '/') && ! str_contains($path, '..') && ! str_contains($path, '\\') && ! str_contains($path, ':')
                            && ($candidatePaths === null || isset($candidatePaths[$disk.':'.$path]))) {
                            $files->push(['disk' => $disk, 'path' => $path]);
                        }
                    }
                }
            }
        }
    }

    public function cleanup(?array $ids = null): void
    {
        DB::table('pending_file_deletions')->when($ids !== null, fn ($query) => $query->whereIn('id', $ids))
            ->orderBy('id')->chunkById(100, function ($files) {
                foreach ($files as $file) {
                    try {
                        $disk = Storage::disk($file->disk);
                        if (! $disk->exists($file->path) || $disk->delete($file->path)) {
                            DB::table('pending_file_deletions')->where('id', $file->id)->delete();
                        }
                    } catch (\Throwable $error) {
                        report($error);
                    }
                }
            });
    }
}
