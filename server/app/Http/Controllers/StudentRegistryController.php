<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class StudentRegistryController extends Controller
{
    private const REQUIRED_HEADERS = ['school_id', 'first_name', 'last_name', 'birth_date'];

    private const OPTIONAL_HEADERS = ['program', 'year_level', 'section', 'college_code', 'record_type', 'position'];

    private const LAST_EMPLOYEE_ID = 94999999;

    private const MAX_ROWS = 5000;

    private const PREVIEW_ROWS = 500;

    public function index(Request $request)
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'college_id' => ['nullable', 'integer', 'min:1'],
            'claimed' => ['nullable', 'in:claimed,unclaimed'],
            'record_type' => ['nullable', 'in:student,employee'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $scopeCollegeId = $this->actorCollegeId($request) ?? ($filters['college_id'] ?? null);

        $scope = StudentRegistryEntry::query()
            ->when($scopeCollegeId, fn ($query) => $query->where('college_id', $scopeCollegeId))
            ->when($filters['record_type'] ?? null, fn ($query, $type) => $query->where('record_type', $type));
        $summary = ['total' => (clone $scope)->count(), 'claimed' => (clone $scope)->whereNotNull('claimed_at')->count()];

        $query = (clone $scope)->with('college:id,name,code')
            ->when(($filters['claimed'] ?? null) === 'claimed', fn ($query) => $query->whereNotNull('claimed_at'))
            ->when(($filters['claimed'] ?? null) === 'unclaimed', fn ($query) => $query->whereNull('claimed_at'));
        foreach (preg_split('/\s+/', trim($filters['q'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $term) {
            $like = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($query) => $query->where('first_name', 'like', $like)
                ->orWhere('last_name', 'like', $like)->orWhere('school_id', 'like', $like));
        }

        $showBirthDate = $request->user()->role === 'SUPER_ADMIN';
        $rows = $query->orderBy('last_name')->orderBy('first_name')->orderBy('school_id')->paginate($filters['per_page'] ?? 20);
        $rows->getCollection()->transform(fn (StudentRegistryEntry $entry) => $this->present($entry, $showBirthDate));

        return response()->json([...$rows->toArray(), 'summary' => $summary]);
    }

    public function update(Request $request, StudentRegistryEntry $entry)
    {
        $this->authorizeEntry($request, $entry);
        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            // Left out, the birth date stays as it is: a dean never sees it, so cannot be asked to retype it.
            'birth_date' => ['nullable', 'date_format:Y-m-d', 'after:1920-01-01', 'before:today'],
        ]);

        $before = ['first_name' => $entry->first_name, 'last_name' => $entry->last_name];
        $birthDateChanged = ! empty($data['birth_date']) && $entry->birth_date?->format('Y-m-d') !== $data['birth_date'];
        $entry->update(array_filter($data, fn ($value) => $value !== null));

        // The birth date proves who is signing up, so the audit row records that it changed, never the date itself.
        AuditLog::create([
            'organization_id' => $request->user()->organization_id, 'user_id' => $request->user()->school_id, 'actor_role' => $request->user()->role,
            'module' => 'student_registry', 'action' => 'updated', 'record_type' => StudentRegistryEntry::class,
            'record_id' => $entry->id, 'old_values' => $before,
            'new_values' => ['first_name' => $data['first_name'], 'last_name' => $data['last_name'], 'birth_date_changed' => $birthDateChanged],
            'ip_address' => $request->ip(), 'created_at' => now(),
        ]);

        return response()->json($this->present($entry->fresh('college'), $request->user()->role === 'SUPER_ADMIN'));
    }

    public function destroy(Request $request, StudentRegistryEntry $entry)
    {
        $this->authorizeEntry($request, $entry);

        AuditLog::create([
            'organization_id' => $request->user()->organization_id, 'user_id' => $request->user()->school_id, 'actor_role' => $request->user()->role,
            'module' => 'student_registry', 'action' => 'deleted', 'record_type' => StudentRegistryEntry::class,
            'record_id' => $entry->id,
            'old_values' => ['school_id' => $entry->school_id, 'first_name' => $entry->first_name, 'last_name' => $entry->last_name, 'record_type' => $entry->record_type, 'college_id' => $entry->college_id],
            'ip_address' => $request->ip(), 'created_at' => now(),
        ]);
        $entry->delete();

        return response()->noContent();
    }

    // A dean reaches only their own college's records, and nobody changes a record that already has an account behind it.
    private function authorizeEntry(Request $request, StudentRegistryEntry $entry): void
    {
        $collegeId = $this->actorCollegeId($request);
        abort_if($collegeId && (int) $entry->college_id !== $collegeId, 404, 'Record not found.');
        abort_if($entry->claimed_at !== null || User::whereKey($entry->school_id)->exists(), 409, 'This record is tied to an account, so it cannot be changed here.');
    }

    private function present(StudentRegistryEntry $entry, bool $showBirthDate): array
    {
        return [
            'id' => $entry->id,
            'school_id' => $entry->school_id,
            'name' => $entry->full_name,
            'first_name' => $entry->first_name,
            'last_name' => $entry->last_name,
            ...($showBirthDate ? ['birth_date' => $entry->birth_date?->format('Y-m-d')] : []),
            'record_type' => $entry->record_type,
            'position' => $entry->position,
            'college' => $entry->college ? ['id' => $entry->college->id, 'name' => $entry->college->name, 'code' => $entry->college->code] : null,
            'program' => $entry->program,
            'year_level' => $entry->year_level,
            'section' => $entry->section,
            'claimed' => $entry->claimed_at !== null,
            'claimed_at' => $entry->claimed_at?->toIso8601String(),
        ];
    }

    public function preview(Request $request)
    {
        $file = $this->validatedFile($request);
        $collegeId = $this->actorCollegeId($request);
        $hash = hash_file('sha256', $file->getRealPath());
        $token = Str::random(40);
        $rows = $this->classify($file->getRealPath(), $collegeId);
        Cache::put('student-registry-preview:'.$token, [
            'hash' => $hash,
            'user_id' => $request->user()->school_id,
            'college_id' => $collegeId,
        ], now()->addMinutes(15));

        return response()->json([
            'hash' => $hash,
            'preview_token' => $token,
            'counts' => $this->counts($rows),
            'rows' => array_map(fn (array $row) => Arr::only($row, ['line', 'school_id', 'first_name', 'last_name', 'college_code', 'record_type', 'position', 'program', 'year_level', 'section', 'status', 'reason']),
                array_slice($rows, 0, self::PREVIEW_ROWS)),
            'truncated' => count($rows) > self::PREVIEW_ROWS,
        ]);
    }

    public function apply(Request $request)
    {
        $request->validate(['hash' => ['required', 'string', 'size:64'], 'preview_token' => ['required', 'string'], 'confirm' => ['required', 'accepted']]);
        $file = $this->validatedFile($request);
        $collegeId = $this->actorCollegeId($request);
        $token = $request->input('preview_token');
        $preview = Cache::get('student-registry-preview:'.$token);
        if (! $preview || $preview['user_id'] !== $request->user()->school_id
            || $preview['college_id'] !== $collegeId
            || ! hash_equals($preview['hash'], $request->input('hash'))
            || ! hash_equals($preview['hash'], hash_file('sha256', $file->getRealPath()))) {
            throw ValidationException::withMessages(['file' => ['The file changed since preview. Preview it again.']]);
        }

        $rows = $this->classify($file->getRealPath(), $collegeId);
        $counts = $this->counts($rows);

        DB::transaction(function () use ($rows, $request, $counts) {
            foreach ($rows as $row) {
                if (! in_array($row['status'], ['new', 'update'], true)) {
                    continue;
                }
                $values = [
                    'record_type' => $row['record_type'],
                    'first_name' => $row['first_name'], 'last_name' => $row['last_name'], 'birth_date' => $row['birth_date'],
                    'college_id' => $row['college_id'], 'program' => $row['program'] ?: null, 'year_level' => $row['year_level'] ?: null,
                    'position' => $row['position'] ?: null,
                    'section' => $row['section'] !== '' ? $row['section'] : null,
                ];
                if ($row['status'] === 'new') {
                    StudentRegistryEntry::create([
                        ...$values,
                        'school_id' => (int) $row['school_id'],
                        'claimed_at' => User::whereKey((int) $row['school_id'])->exists() ? now() : null,
                    ]);

                    continue;
                }
                $updated = StudentRegistryEntry::where('school_id', (int) $row['school_id'])->whereNull('claimed_at')->update($values);
                if ($updated !== 1) {
                    throw ValidationException::withMessages(['file' => ['A student signed up since preview. Preview the file again.']]);
                }
            }

            AuditLog::create([
                'organization_id' => $request->user()->organization_id, 'user_id' => $request->user()->school_id,
                'module' => 'student_registry', 'action' => 'imported', 'record_type' => StudentRegistryEntry::class,
                'record_id' => null, 'new_values' => $counts, 'ip_address' => $request->ip(), 'created_at' => now(),
            ]);
        });
        Cache::forget('student-registry-preview:'.$token);

        return response()->json($counts);
    }

    private function actorCollegeId(Request $request): ?int
    {
        $user = $request->user();
        if ($user->role !== 'DEPARTMENT_HEAD') {
            return null;
        }

        $home = $user->organization;
        if (! $home || $home->organization_type !== 'COLLEGE' || ! $home->college_id) {
            abort(403, 'Your account is not attached to a college.');
        }

        return (int) $home->college_id;
    }

    private function validatedFile(Request $request)
    {
        $request->validate(['file' => ['required', 'file', 'max:4096']]);
        $file = $request->file('file');
        if (strtolower($file->getClientOriginalExtension()) !== 'csv') {
            throw ValidationException::withMessages(['file' => ['Choose a .csv file.']]);
        }

        return $file;
    }

    private function counts(array $rows): array
    {
        $counts = ['new' => 0, 'update' => 0, 'unchanged' => 0, 'claimed' => 0, 'invalid' => 0, 'duplicate' => 0];
        foreach ($rows as $row) {
            $counts[$row['status']]++;
        }

        return ['created' => $counts['new'], 'updated' => $counts['update'], ...Arr::only($counts, ['unchanged', 'claimed', 'invalid', 'duplicate'])];
    }

    private function classify(string $path, ?int $actorCollegeId): array
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
            $headers = array_map(fn ($header) => strtolower(trim(str_replace("\xef\xbb\xbf", '', (string) $header))), $headers);
            $required = $actorCollegeId ? self::REQUIRED_HEADERS : [...self::REQUIRED_HEADERS, 'college_code'];
            if (count($headers) !== count(array_unique($headers)) || array_diff($required, $headers) || array_diff($headers, self::REQUIRED_HEADERS, self::OPTIONAL_HEADERS)) {
                throw ValidationException::withMessages(['file' => ['Columns must be: '.implode(', ', $required).'. Optional: program, year_level, section, record_type, position.']]);
            }
            $rows = [];
            $line = 1;
            while (($cells = fgetcsv($handle)) !== false) {
                $line++;
                if ($line > self::MAX_ROWS + 1) {
                    throw ValidationException::withMessages(['file' => ['A records file may contain at most '.number_format(self::MAX_ROWS).' rows.']]);
                }
                if ($cells === [null]) {
                    continue;
                }
                $row = count($cells) === count($headers) ? array_combine($headers, array_map('trim', $cells)) : [];
                $rows[] = [
                    'line' => $line, 'school_id' => $row['school_id'] ?? '', 'first_name' => $row['first_name'] ?? '',
                    'last_name' => $row['last_name'] ?? '', 'birth_date' => $row['birth_date'] ?? '', 'program' => $row['program'] ?? '',
                    'record_type' => strtolower($row['record_type'] ?? '') ?: StudentRegistryEntry::STUDENT, 'position' => $row['position'] ?? '',
                    'year_level' => $row['year_level'] ?? '', 'section' => $row['section'] ?? '', 'college_code' => $row['college_code'] ?? '',
                    'college_id' => $actorCollegeId, 'status' => 'invalid',
                    'reason' => $row ? '' : 'Column count does not match the header.',
                ];
            }
        } finally {
            fclose($handle);
        }
        if (! $rows) {
            throw ValidationException::withMessages(['file' => ['The CSV has no rows.']]);
        }

        $colleges = College::where('is_active', true)->whereNotNull('code')->where('code', '<>', '')->get()->keyBy(fn ($college) => strtoupper($college->code));
        $ownCode = $actorCollegeId ? strtoupper((string) College::whereKey($actorCollegeId)->value('code')) : null;
        $ids = collect($rows)->pluck('school_id')->filter(fn ($id) => ctype_digit((string) $id))->map(fn ($id) => (int) $id)->all();
        $existing = StudentRegistryEntry::whereIn('school_id', $ids)->get()->keyBy('school_id');
        $idCounts = array_count_values(array_filter(array_column($rows, 'school_id'), fn ($id) => $id !== ''));

        foreach ($rows as &$row) {
            if ($row['reason']) {
                continue;
            }
            $id = $row['school_id'];
            if (! in_array($row['record_type'], [StudentRegistryEntry::STUDENT, StudentRegistryEntry::EMPLOYEE], true)) {
                $row['reason'] = 'Record type must be student or employee.';

                continue;
            }
            $isEmployee = $row['record_type'] === StudentRegistryEntry::EMPLOYEE;
            if (! ctype_digit((string) $id) || (int) $id < 1 || (int) $id > 99999999) {
                $row['reason'] = 'School ID must contain 1 to 8 digits.';

                continue;
            }
            if ($isEmployee && (int) $id > self::LAST_EMPLOYEE_ID) {
                $row['reason'] = 'Employee numbers must be below '.(self::LAST_EMPLOYEE_ID + 1).'.';

                continue;
            }
            if (($idCounts[$id] ?? 0) > 1) {
                $row['status'] = 'duplicate';
                $row['reason'] = 'School ID occurs more than once in this file.';

                continue;
            }
            $code = strtoupper($row['college_code']);
            if ($actorCollegeId) {
                if ($code !== '' && $code !== $ownCode) {
                    $row['reason'] = 'That row is for another college.';

                    continue;
                }
                $row['college_id'] = $actorCollegeId;
            } elseif (! $colleges->has($code)) {
                $row['reason'] = $code === '' ? 'College code is required.' : 'Unknown college code.';

                continue;
            } else {
                $row['college_id'] = $colleges[$code]->id;
            }
            $fields = Validator::make($row, [
                'first_name' => ['required', 'string', 'max:60'],
                'last_name' => ['required', 'string', 'max:60'],
                'birth_date' => ['required', 'date_format:Y-m-d', 'after:1920-01-01', 'before:today'],
                'program' => [$isEmployee ? 'nullable' : 'required', 'string', 'max:120'],
                'section' => ['nullable', 'string', 'max:30'],
                'position' => ['nullable', 'string', 'max:100'],
            ]);
            if ($fields->fails()) {
                $row['reason'] = $fields->errors()->has('birth_date')
                    ? 'Birth date must be a real date written as YYYY-MM-DD.'
                    : 'Names, program, section and position must be filled in where needed and not too long.';

                continue;
            }
            if ($isEmployee) {
                $row['program'] = $row['year_level'] = $row['section'] = '';
            } else {
                $yearLevel = $this->yearLevel($row['year_level']);
                if (! $yearLevel) {
                    $row['reason'] = 'Year level must be 1 to 8, for example 3 or 3rd Year.';

                    continue;
                }
                $row['year_level'] = $yearLevel;
                $row['position'] = '';
            }

            $entry = $existing->get((int) $id);
            if (! $entry) {
                $row['status'] = 'new';
            } elseif ($actorCollegeId && (int) $entry->college_id !== $actorCollegeId) {
                $row['reason'] = "That school ID is in another college's records.";
            } elseif ($entry->record_type !== $row['record_type']) {
                $row['reason'] = 'That school ID is already in the records as a '.$entry->record_type.'.';
            } elseif ($entry->claimed_at) {
                $row['status'] = 'claimed';
                $row['reason'] = 'Already signed up, so it is left as is.';
            } elseif ($this->sameRecord($entry, $row)) {
                $row['status'] = 'unchanged';
            } else {
                $row['status'] = 'update';
            }
        }
        unset($row);

        return $rows;
    }

    private function sameRecord(StudentRegistryEntry $entry, array $row): bool
    {
        return $entry->first_name === $row['first_name'] && $entry->last_name === $row['last_name']
            && $entry->birth_date->format('Y-m-d') === Carbon::parse($row['birth_date'])->format('Y-m-d')
            && (int) $entry->college_id === (int) $row['college_id'] && (string) $entry->program === $row['program']
            && (string) $entry->year_level === $row['year_level'] && (string) $entry->section === $row['section']
            && (string) $entry->position === $row['position'];
    }

    private function yearLevel(string $value): ?string
    {
        if (! preg_match('/^([1-8])(?:\s*(?:st|nd|rd|th))?(?:\s+year)?$/i', trim($value), $match)) {
            return null;
        }
        $year = (int) $match[1];

        return $year.([1 => 'st', 2 => 'nd', 3 => 'rd'][$year] ?? 'th').' Year';
    }
}
