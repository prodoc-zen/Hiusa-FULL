<?php

namespace App\Http\Controllers;

use App\Models\AcademicProgram;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ClassListImportController extends Controller
{
    private const HEADERS = ['school_id', 'program', 'year_level', 'section'];

    public function preview(Request $request)
    {
        $file = $this->validatedFile($request);
        $hash = hash_file('sha256', $file->getRealPath());
        $token = Str::random(40);
        $rows = $this->classify($file->getRealPath(), $request->user()->organization_id);
        Cache::put('class-list-preview:'.$token, [
            'hash' => $hash,
            'user_id' => $request->user()->school_id,
            'organization_id' => $request->user()->organization_id,
        ], now()->addMinutes(15));

        return response()->json([
            'hash' => $hash,
            'preview_token' => $token,
            'rows' => $rows,
        ]);
    }

    public function apply(Request $request)
    {
        $request->validate(['hash' => ['required', 'string', 'size:64'], 'preview_token' => ['required', 'string'], 'confirm' => ['required', 'accepted']]);
        $file = $this->validatedFile($request);
        $token = $request->input('preview_token');
        $preview = Cache::get('class-list-preview:'.$token);
        if (! $preview || $preview['user_id'] !== $request->user()->school_id
            || $preview['organization_id'] !== $request->user()->organization_id
            || ! hash_equals($preview['hash'], $request->input('hash'))
            || ! hash_equals($preview['hash'], hash_file('sha256', $file->getRealPath()))) {
            throw ValidationException::withMessages(['file' => ['The file changed since preview. Preview it again.']]);
        }

        $organizationId = $request->user()->organization_id;
        $rows = $this->classify($file->getRealPath(), $organizationId);
        $results = DB::transaction(function () use ($rows, $organizationId, $request) {
            $updated = 0;
            $created = 0;
            foreach ($rows as $row) {
                if (! in_array($row['status'], ['update', 'new'], true)) {
                    continue;
                }
                if ($row['status'] === 'new') {
                    if (User::where('school_id', $row['school_id'])->orWhere('email', $row['email'])->exists()) {
                        throw ValidationException::withMessages(['file' => ['An account was created since preview. Preview the file again.']]);
                    }
                    $user = User::create([
                        'organization_id' => $organizationId,
                        'school_id' => (int) $row['school_id'],
                        'first_name' => $row['first_name'],
                        'last_name' => $row['last_name'],
                        'email' => $row['email'],
                        'password_hash' => substr(str_pad($row['school_id'], 4, '0', STR_PAD_LEFT), -4).'-uclm',
                        'must_change_password' => true,
                        'role' => 'STUDENT',
                        'account_status' => 'active',
                        'is_member' => true,
                        'department' => $request->user()->organization?->college ?: 'College of Computer Studies',
                        'program' => $row['program'],
                        'year_level' => $row['year_level'],
                        'section' => $row['section'],
                    ]);
                    AuditLog::create([
                        'organization_id' => $organizationId, 'user_id' => $request->user()->school_id,
                        'module' => 'users', 'action' => 'class_list_created', 'record_type' => User::class,
                        'record_id' => $user->school_id, 'new_values' => $user->only(['school_id', 'first_name', 'last_name', 'email', 'program', 'year_level', 'section']),
                        'ip_address' => $request->ip(), 'created_at' => now(),
                    ]);
                    $created++;

                    continue;
                }
                $user = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $organizationId)->where('role', 'STUDENT'))
                    ->where('school_id', $row['school_id'])->lockForUpdate()->first();
                if (! $user) {
                    throw ValidationException::withMessages(['file' => ['A student account changed since preview. Preview the file again.']]);
                }
                $before = $user->only(['program', 'year_level', 'section']);
                $after = ['program' => $row['program'], 'year_level' => $row['year_level'], 'section' => $row['section']];
                $user->update($after);
                AuditLog::create([
                    'organization_id' => $organizationId,
                    'user_id' => $request->user()->school_id,
                    'module' => 'users',
                    'action' => 'class_list_updated',
                    'record_type' => User::class,
                    'record_id' => $user->school_id,
                    'old_values' => $before,
                    'new_values' => $after,
                    'ip_address' => $request->ip(),
                    'created_at' => now(),
                ]);
                $updated++;
            }

            return ['updated' => $updated, 'created' => $created];
        });
        Cache::forget('class-list-preview:'.$token);

        return response()->json([
            ...$results,
            'unchanged' => collect($rows)->where('status', 'unchanged')->count(),
            'invalid' => collect($rows)->where('status', 'invalid')->count(),
            'duplicate' => collect($rows)->where('status', 'duplicate')->count(),
        ]);
    }

    private function validatedFile(Request $request)
    {
        $request->validate(['file' => ['required', 'file', 'max:2048']]);
        $file = $request->file('file');
        if (strtolower($file->getClientOriginalExtension()) !== 'csv') {
            throw ValidationException::withMessages(['file' => ['Choose a .csv class list.']]);
        }

        return $file;
    }

    private function classify(string $path, int $organizationId): array
    {
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            throw ValidationException::withMessages(['file' => ['The CSV could not be read.']]);
        }
        try {
            $headers = fgetcsv($handle);
            if (! $headers) {
                throw ValidationException::withMessages(['file' => ['The CSV is empty.']]);
            }
            $headers = array_map(fn ($header) => strtolower(trim(str_replace("\xef\xbb\xbf", '', $header))), $headers);
            if (count($headers) !== count(array_unique($headers)) || array_diff(self::HEADERS, $headers)) {
                throw ValidationException::withMessages(['file' => ['Required columns: school_id, program, year_level, section. New accounts also need first_name, last_name, and email.']]);
            }
            $rows = [];
            $line = 1;
            while (($cells = fgetcsv($handle)) !== false) {
                $line++;
                if ($line > 1001) {
                    throw ValidationException::withMessages(['file' => ['A class list may contain at most 1,000 rows.']]);
                }
                if ($cells === [null]) {
                    continue;
                }
                $row = count($cells) === count($headers) ? array_combine($headers, array_map('trim', $cells)) : [];
                $rows[] = ['line' => $line, 'school_id' => $row['school_id'] ?? '', 'program' => $row['program'] ?? '',
                    'year_level' => $row['year_level'] ?? '', 'section' => $row['section'] ?? '',
                    'first_name' => $row['first_name'] ?? '', 'last_name' => $row['last_name'] ?? '', 'email' => $row['email'] ?? '',
                    'status' => 'invalid', 'reason' => $row ? '' : 'Column count does not match the header.'];
            }
        } finally {
            fclose($handle);
        }
        if (! $rows) {
            throw ValidationException::withMessages(['file' => ['The CSV has no student rows.']]);
        }

        $programs = AcademicProgram::where('organization_id', $organizationId)->with('sections')->get()->keyBy('name');
        $ids = collect($rows)->pluck('school_id')->filter(fn ($id) => ctype_digit((string) $id))->all();
        $users = User::with('accountProfiles')->whereIn('school_id', $ids)->get()->keyBy('school_id');
        $existingEmails = User::whereIn('email', array_filter(array_column($rows, 'email')))
            ->pluck('email')->map(fn ($email) => strtolower($email))->flip();
        $idCounts = array_count_values(array_filter(array_column($rows, 'school_id'), fn ($id) => $id !== ''));
        $seenEmails = [];
        foreach ($rows as &$row) {
            $id = $row['school_id'];
            if ($row['reason']) {
                continue;
            }
            if (! ctype_digit((string) $id) || (int) $id < 1 || (int) $id > 99999999) {
                $row['reason'] = 'School ID must contain 1 to 8 digits.';
            } elseif (($idCounts[$id] ?? 0) > 1) {
                $row['status'] = 'duplicate';
                $row['reason'] = 'School ID occurs more than once in this file.';
            } else {
                $program = $programs->get($row['program']);
                $year = (int) $row['year_level'];
                if (! $program || ! preg_match('/^[1-8]$/', $row['year_level']) || $year > $program->duration_years
                    || ! $program->sections->contains(fn ($section) => $section->year_level === $year && $section->name === $row['section'])) {
                    $row['reason'] = 'Choose a configured program, year number, and section for that year.';
                } else {
                    $row['year_level'] = $year.(in_array($year, [11, 12, 13], true) ? 'th' : ([1 => 'st', 2 => 'nd', 3 => 'rd'][$year % 10] ?? 'th')).' Year';
                    $user = $users->get((int) $id);
                    if (! $user) {
                        $validIdentity = Validator::make($row, [
                            'first_name' => ['required', 'string', 'max:60'],
                            'last_name' => ['required', 'string', 'max:60'],
                            'email' => ['required', 'email', 'max:100'],
                        ])->passes();
                        $email = strtolower($row['email']);
                        if (! $validIdentity || isset($seenEmails[$email]) || $existingEmails->has($email)) {
                            $row['reason'] = 'New students need a unique email, first name, and last name.';
                        } else {
                            $seenEmails[$email] = true;
                            $row['status'] = 'new';
                        }
                    } elseif (! $user->accountProfiles->firstWhere('organization_id', $organizationId)) {
                        $row['reason'] = 'School ID is unavailable for this organization.';
                    } elseif ($user->accountProfiles->firstWhere('organization_id', $organizationId)?->role !== 'STUDENT') {
                        $row['reason'] = 'The matching account is not a student.';
                    } elseif (($row['first_name'] && strcasecmp($row['first_name'], $user->first_name) !== 0)
                        || ($row['last_name'] && strcasecmp($row['last_name'], $user->last_name) !== 0)) {
                        $row['reason'] = 'Name does not match the student account.';
                    } else {
                        $row['status'] = $user->program === $row['program'] && $user->year_level === $row['year_level'] && $user->section === $row['section'] ? 'unchanged' : 'update';
                    }
                }
            }
        }
        unset($row);

        return $rows;
    }
}
