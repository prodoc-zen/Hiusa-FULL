<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Services\SubmissionStoragePolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class FileStorageController extends Controller
{
    public function show(SubmissionStoragePolicy $policy)
    {
        $root = Storage::disk('local')->path('');
        $files = Storage::disk('local')->allFiles();
        $organizations = Organization::student()->orderBy('name')->get(['id', 'name', 'acronym']);

        return response()->json([
            'settings' => $policy->settings(),
            'disk_total_bytes' => disk_total_space($root),
            'disk_free_bytes' => disk_free_space($root),
            'stored_bytes' => array_sum(array_map(fn ($path) => Storage::disk('local')->size($path), $files)),
            'stored_files' => count($files),
            'organizations' => $organizations->map(fn ($organization) => [
                'id' => $organization->id, 'name' => $organization->name, 'acronym' => $organization->acronym,
                'stored_bytes' => $policy->organizationBytes($organization->id),
            ]),
        ]);
    }

    public function update(Request $request)
    {
        $data = $request->validate([
            'max_file_mb' => ['required', 'integer', 'min:1', 'max:10'],
            'max_organization_mb' => ['required', 'integer', 'min:10', 'max:10240'],
        ]);
        DB::table('file_storage_settings')->where('id', 1)->update([...$data, 'updated_at' => now()]);
        AuditLog::create([
            'organization_id' => $request->user()->organization_id, 'user_id' => $request->user()->school_id,
            'actor_role' => 'SUPER_ADMIN', 'module' => 'file_storage', 'action' => 'limits_updated',
            'description' => 'SAO updated file storage limits.', 'new_values' => $data,
            'ip_address' => $request->ip(), 'created_at' => now(),
        ]);

        return response()->json(['settings' => DB::table('file_storage_settings')->where('id', 1)->first()]);
    }
}
