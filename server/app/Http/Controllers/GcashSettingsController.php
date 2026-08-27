<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class GcashSettingsController extends Controller
{
    public function show(Request $request)
    {
        $organization = Organization::findOrFail($request->user()->organization_id);

        return response()->json(['gcash_qr_url' => $this->publicUrl($request, $organization->gcash_qr_url)]);
    }

    public function update(Request $request)
    {
        $request->validate([
            'qr_code' => ['required', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        $organization = Organization::findOrFail($request->user()->organization_id);
        $oldUrl = $organization->gcash_qr_url;
        $file = $request->file('qr_code');
        $directory = public_path('uploads/gcash');
        if (! is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $url = '/uploads/gcash/'.Str::uuid().'.'.strtolower($file->extension() ?: 'png');
        $file->move($directory, basename($url));
        $organization->update(['gcash_qr_url' => $url]);

        if ($oldUrl && str_starts_with($oldUrl, '/uploads/gcash/')) {
            $oldPath = public_path(ltrim($oldUrl, '/'));
            if (is_file($oldPath)) @unlink($oldPath);
        }

        AuditLog::create([
            'organization_id' => $organization->id,
            'user_id' => $request->user()->school_id,
            'module' => 'merchandise',
            'action' => 'gcash_qr_updated',
            'record_type' => Organization::class,
            'record_id' => $organization->id,
            'old_values' => ['gcash_qr_url' => $oldUrl],
            'new_values' => ['gcash_qr_url' => $url],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return response()->json(['gcash_qr_url' => $this->publicUrl($request, $url)]);
    }

    private function publicUrl(Request $request, ?string $path): ?string
    {
        if (! $path || str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }

        return rtrim($request->getSchemeAndHttpHost(), '/').'/'.ltrim($path, '/');
    }
}
