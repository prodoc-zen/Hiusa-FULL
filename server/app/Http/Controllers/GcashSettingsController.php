<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class GcashSettingsController extends Controller
{
    private const OPEN_URL = '/merchandise/gcash-settings/qr';

    private const PRIVATE_FOLDER = 'gcash-qr/';

    // QR images saved before they moved to the private disk sit here and are still opened through the route.
    private const LEGACY_FOLDER = '/uploads/gcash/';

    private const TYPES = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp'];

    public function show(Request $request)
    {
        $organization = Organization::findOrFail($request->user()->organization_id);

        return response()->json(['gcash_qr_open_url' => $this->openUrl($organization->gcash_qr_url)]);
    }

    public function image(Request $request)
    {
        $organization = Organization::findOrFail($request->user()->organization_id);
        $path = $this->filePath($organization->gcash_qr_url);

        if (! $path) {
            return response()->json(['message' => 'The GCash QR is not available.'], 404);
        }

        return response()->file($path, [
            'Content-Type' => self::TYPES[strtolower(pathinfo($path, PATHINFO_EXTENSION))] ?? 'application/octet-stream',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-cache',
        ]);
    }

    public function update(Request $request)
    {
        $request->validate([
            'qr_code' => ['required', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        $organization = Organization::findOrFail($request->user()->organization_id);
        $oldUrl = $organization->gcash_qr_url;
        $file = $request->file('qr_code');
        $extension = strtolower($file->extension());
        $url = Storage::disk('local')->putFileAs(
            self::PRIVATE_FOLDER.$organization->id,
            $file,
            Str::uuid().'.'.(isset(self::TYPES[$extension]) ? $extension : 'png'),
        );
        $organization->update(['gcash_qr_url' => $url]);

        // The demo-* image is the tracked seed asset shared by every seeded organization, so it is never deleted.
        if ($oldUrl && str_starts_with($oldUrl, self::LEGACY_FOLDER) && ! str_starts_with(basename($oldUrl), 'demo-')) {
            $oldPath = public_path(ltrim($oldUrl, '/'));
            if (is_file($oldPath)) {
                @unlink($oldPath);
            }
        } elseif ($oldUrl && $this->isPrivatePath($oldUrl)) {
            Storage::disk('local')->delete($oldUrl);
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

        return response()->json(['gcash_qr_open_url' => $this->openUrl($url)]);
    }

    private function openUrl(?string $saved): ?string
    {
        return $this->filePath($saved) ? self::OPEN_URL : null;
    }

    private function isPrivatePath(string $saved): bool
    {
        return str_starts_with($saved, self::PRIVATE_FOLDER) && ! str_contains($saved, '..');
    }

    private function filePath(?string $saved): ?string
    {
        if (! $saved) {
            return null;
        }

        if (str_starts_with($saved, self::LEGACY_FOLDER)) {
            $name = substr($saved, strlen(self::LEGACY_FOLDER));
            $path = public_path('uploads/gcash/'.$name);

            return $name === basename($name) && is_file($path) ? $path : null;
        }

        return $this->isPrivatePath($saved) && Storage::disk('local')->exists($saved)
            ? Storage::disk('local')->path($saved)
            : null;
    }
}
