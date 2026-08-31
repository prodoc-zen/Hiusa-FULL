<?php

namespace App\Http\Controllers;

use App\Models\AcademicProgram;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AcademicStructureController extends Controller
{
    public function index(Request $request)
    {
        $organization = $request->user()->organization;

        return response()->json([
            'department' => $organization?->college ?: 'College of Computer Studies',
            'programs' => AcademicProgram::where('organization_id', $request->user()->organization_id)
                ->with('sections')
                ->orderBy('name')
                ->get(),
        ]);
    }

    public function store(Request $request)
    {
        $organizationId = $request->user()->organization_id;
        $data = $request->validate([
            'name' => [
                'required', 'string', 'max:120',
                Rule::unique('academic_programs', 'name')->where(fn ($query) => $query->where('organization_id', $organizationId)),
            ],
            'sections' => ['required', 'array:1,2,3,4'],
            'sections.1' => ['required', 'integer', 'min:0', 'max:26'],
            'sections.2' => ['required', 'integer', 'min:0', 'max:26'],
            'sections.3' => ['required', 'integer', 'min:0', 'max:26'],
            'sections.4' => ['required', 'integer', 'min:0', 'max:26'],
        ]);

        $program = DB::transaction(function () use ($data, $organizationId) {
            $program = AcademicProgram::create(['organization_id' => $organizationId, 'name' => trim($data['name'])]);
            $this->syncSections($program, $data['sections']);

            return $program->load('sections');
        });

        AuditLog::create([
            'organization_id' => $organizationId,
            'user_id' => $request->user()->school_id,
            'module' => 'academic_structure',
            'action' => 'created',
            'record_type' => AcademicProgram::class,
            'record_id' => $program->id,
            'new_values' => $program->toArray(),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return response()->json($program, 201);
    }

    public function update(Request $request, $programId)
    {
        $organizationId = $request->user()->organization_id;
        $program = AcademicProgram::where('organization_id', $organizationId)->find($programId);

        if (! $program) {
            return response()->json(['message' => 'Program not found.'], 404);
        }

        $data = $this->validateProgram($request, $organizationId, $program->id);
        $oldValues = $program->load('sections')->toArray();
        $oldName = $program->name;

        $program = DB::transaction(function () use ($program, $data, $organizationId, $oldName) {
            $this->ensureSectionsCanBeRemoved($program, $data['sections']);
            $program->update(['name' => trim($data['name'])]);

            if ($oldName !== $program->name) {
                DB::table('users')
                    ->where('organization_id', $organizationId)
                    ->where('program', $oldName)
                    ->update(['program' => $program->name, 'updated_at' => now()]);
            }

            $this->syncSections($program, $data['sections']);

            return $program->fresh()->load('sections');
        });

        $this->recordAudit($request, 'updated', $program, $oldValues, $program->toArray());

        return response()->json($program);
    }

    public function destroy(Request $request, $programId)
    {
        $program = AcademicProgram::where('organization_id', $request->user()->organization_id)->find($programId);

        if (! $program) {
            return response()->json(['message' => 'Program not found.'], 404);
        }

        $assignedUsers = DB::table('users')
            ->where('organization_id', $request->user()->organization_id)
            ->where('program', $program->name)
            ->count();

        if ($assignedUsers > 0) {
            return response()->json([
                'message' => "Cannot delete this program while {$assignedUsers} user account(s) are assigned to it.",
            ], 409);
        }

        $oldValues = $program->load('sections')->toArray();
        $program->delete();
        $this->recordAudit($request, 'deleted', $program, $oldValues, null);

        return response()->json(['message' => 'Program and its sections were deleted successfully.']);
    }

    private function validateProgram(Request $request, int $organizationId, ?int $ignoreId = null): array
    {
        return $request->validate([
            'name' => [
                'required', 'string', 'max:120',
                Rule::unique('academic_programs', 'name')
                    ->where(fn ($query) => $query->where('organization_id', $organizationId))
                    ->ignore($ignoreId),
            ],
            'sections' => ['required', 'array:1,2,3,4'],
            'sections.1' => ['required', 'integer', 'min:0', 'max:26'],
            'sections.2' => ['required', 'integer', 'min:0', 'max:26'],
            'sections.3' => ['required', 'integer', 'min:0', 'max:26'],
            'sections.4' => ['required', 'integer', 'min:0', 'max:26'],
        ]);
    }

    private function desiredSectionNames(array $counts): array
    {
        $names = [];
        foreach ([1, 2, 3, 4] as $yearLevel) {
            $names[$yearLevel] = ["{$yearLevel} - Non Block"];
            for ($index = 0; $index < $counts[$yearLevel]; $index++) {
                $names[$yearLevel][] = sprintf('%d-%s', $yearLevel, chr(65 + $index));
            }
        }

        return $names;
    }

    private function syncSections(AcademicProgram $program, array $counts): void
    {
        $desired = $this->desiredSectionNames($counts);
        $desiredFlat = collect($desired)->flatten()->all();

        $program->sections()->whereNotIn('name', $desiredFlat)->delete();

        foreach ($desired as $yearLevel => $names) {
            foreach ($names as $name) {
                $program->sections()->firstOrCreate(['year_level' => $yearLevel, 'name' => $name]);
            }
        }
    }

    private function ensureSectionsCanBeRemoved(AcademicProgram $program, array $counts): void
    {
        $desired = collect($this->desiredSectionNames($counts))->flatten();
        $removed = $program->sections()->whereNotIn('name', $desired)->get();

        foreach ($removed as $section) {
            $yearLabel = match ((int) $section->year_level) {
                1 => '1st Year', 2 => '2nd Year', 3 => '3rd Year', 4 => '4th Year',
            };
            $isAssigned = DB::table('users')
                ->where('organization_id', $program->organization_id)
                ->where('program', $program->name)
                ->where('year_level', $yearLabel)
                ->where('section', $section->name)
                ->exists();

            if ($isAssigned) {
                throw ValidationException::withMessages([
                    "sections.{$section->year_level}" => ["Section {$section->name} cannot be removed while users are assigned to it."],
                ]);
            }
        }
    }

    private function recordAudit(Request $request, string $action, AcademicProgram $program, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'module' => 'academic_structure',
            'action' => $action,
            'record_type' => AcademicProgram::class,
            'record_id' => $program->id,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
