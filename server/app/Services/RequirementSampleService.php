<?php

namespace App\Services;

use App\Models\AcademicSemester;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class RequirementSampleService
{
    public function validate(Request $request, ?Model $requirement, array $extensions): array
    {
        $hasSample = $requirement && ($requirement->template_url
            || ($requirement->template_path && Storage::disk('local')->exists($requirement->template_path)));
        $required = ! $requirement || ($request->boolean('is_active', $requirement->is_active) && ! $hasSample);
        $types = implode(',', $extensions);

        return $request->validate([
            'template' => [Rule::requiredIf($required && ! $request->filled('template_url')), 'nullable', 'file', 'mimes:'.$types, 'extensions:'.$types, 'max:10240', 'prohibits:template_url'],
            'template_url' => [Rule::requiredIf($required && ! $request->hasFile('template')), 'nullable', 'string', 'max:2048', 'url:http,https', 'prohibits:template'],
        ], [
            'template.required' => 'The requirement publisher must attach a sample format or provide a sample link.',
            'template_url.required' => 'The requirement publisher must attach a sample format or provide a sample link.',
        ]);
    }

    public function save(Model $requirement, array $data, Request $request, array $extensions, string $directory): Model
    {
        $oldPath = null;
        $newPath = null;
        try {
            DB::transaction(function () use ($requirement, $data, $request, $extensions, $directory, &$newPath, &$oldPath) {
                if ($requirement->exists) {
                    $locked = $requirement->newQuery()->whereKey($requirement->getKey())->lockForUpdate()->firstOrFail();
                    $requirement->setRawAttributes($locked->getAttributes(), true);
                    abort_if($locked->academic_semester_id && $locked->academic_semester_id !== AcademicSemester::active()?->id, 409, 'Completed semester requirements are read only.');
                }
                $oldPath = $requirement->template_path;
                $sample = $this->validate($request, $requirement->exists ? $requirement : null, $extensions);
                $requirement->fill($data)->save();
                if ($file = $sample['template'] ?? null) {
                    $newPath = $file->store($directory.'/'.$requirement->getKey(), 'local');
                    abort_unless($newPath, 500, 'Could not save the sample format. Try again.');
                    $requirement->update(['template_path' => $newPath, 'template_original_name' => mb_substr($file->getClientOriginalName(), 0, 255), 'template_url' => null]);
                } elseif (! empty($sample['template_url'])) {
                    $requirement->update(['template_url' => $sample['template_url'], 'template_path' => null, 'template_original_name' => null]);
                }
                if ($oldPath && $oldPath !== $requirement->template_path) {
                    $this->deleteAfterCommit($oldPath);
                }
            });
        } catch (\Throwable $error) {
            if ($newPath) {
                Storage::disk('local')->delete($newPath);
            }
            throw $error;
        }

        return $requirement->refresh();
    }

    public function remove(Model $requirement): Model
    {
        DB::transaction(function () use ($requirement) {
            $locked = $requirement->newQuery()->whereKey($requirement->getKey())->lockForUpdate()->firstOrFail();
            abort_if($locked->academic_semester_id && $locked->academic_semester_id !== AcademicSemester::active()?->id, 409, 'Completed semester requirements are read only.');
            abort_if($locked->is_active, 409, 'Active requirements must keep a sample format. Replace the sample, or deactivate the requirement first.');
            $oldPath = $locked->template_path;
            $locked->update(['template_path' => null, 'template_original_name' => null, 'template_url' => null]);
            if ($oldPath) {
                $this->deleteAfterCommit($oldPath);
            }
        });

        return $requirement->refresh();
    }

    public function deleteAfterCommit(?string $path): void
    {
        if (! $path) {
            return;
        }
        $id = DB::table('pending_file_deletions')->insertGetId(['disk' => 'local', 'path' => $path]);
        DB::afterCommit(function () use ($id) {
            try {
                app(OrganizationDeletionService::class)->cleanup([$id]);
            } catch (\Throwable $error) {
                report($error);
            }
        });
    }
}
