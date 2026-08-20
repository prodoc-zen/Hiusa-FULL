<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Merchandise;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class MerchandiseController extends Controller
{
    private function storeMerchandiseImage(Request $request): string
    {
        $file = $request->file('image');
        $ext = strtolower($file->extension() ?: 'jpg');
        $filename = Str::uuid()->toString().'.'.$ext;
        $destDir = public_path('uploads/merchandise');

        if (! is_dir($destDir)) {
            mkdir($destDir, 0755, true);
        }

        $file->move($destDir, $filename);

        return '/uploads/merchandise/'.$filename;
    }

    private function deleteMerchandiseImage(?string $imageUrl): void
    {
        if (! $imageUrl) {
            return;
        }

        if (str_starts_with($imageUrl, '/storage/')) {
            Storage::delete('public/'.ltrim(str_replace('/storage/', '', $imageUrl), '/'));

            return;
        }

        if (str_starts_with($imageUrl, '/uploads/')) {
            $fullPath = public_path(ltrim($imageUrl, '/'));
            if (is_file($fullPath)) {
                @unlink($fullPath);
            }
        }
    }

    public function index(Request $request)
    {
        $query = Merchandise::withCount('orders')
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('name', 'asc');

        if ($request->user()->role !== 'ADMIN') {
            $query->where('is_active', true);
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'category' => ['nullable', 'string', 'max:100'],
            'description' => ['nullable', 'string'],
            'price' => ['required', 'numeric', 'min:0'],
            'stock_quantity' => ['required', 'integer', 'min:0'],
            'is_active' => ['boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        if ($request->hasFile('image')) {
            $data['image_url'] = $this->storeMerchandiseImage($request);
        }
        unset($data['image']);

        try {
            $item = Merchandise::create([
                ...$data,
                'organization_id' => $request->user()->organization_id,
            ]);
        } catch (\Throwable $exception) {
            $this->deleteMerchandiseImage($data['image_url'] ?? null);
            throw $exception;
        }

        return response()->json($item, 201);
    }

    public function update(Request $request, $id)
    {
        $item = Merchandise::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'category' => ['nullable', 'string', 'max:100'],
            'description' => ['nullable', 'string'],
            'price' => ['sometimes', 'required', 'numeric', 'min:0'],
            'stock_quantity' => ['sometimes', 'required', 'integer', 'min:0'],
            'is_active' => ['boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        $oldImageUrl = $item->image_url;
        $newImageUrl = $request->hasFile('image') ? $this->storeMerchandiseImage($request) : null;
        if ($newImageUrl) {
            $data['image_url'] = $newImageUrl;
        }
        unset($data['image']);

        try {
            $item->update($data);
        } catch (\Throwable $exception) {
            $this->deleteMerchandiseImage($newImageUrl);
            throw $exception;
        }

        if ($newImageUrl) {
            $this->deleteMerchandiseImage($oldImageUrl);
        }

        return response()->json($item->fresh());
    }

    public function destroy(Request $request, $id)
    {
        $item = Merchandise::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        $blockedStatuses = ['pending', 'paid'];
        if ($item->orders()->whereIn('status', $blockedStatuses)->exists()) {
            return response()->json([
                'message' => 'Cannot delete an item with pending or paid orders.',
            ], 409);
        }

        $oldValues = $this->auditableMerchandiseValues($item);
        $item->update(['is_active' => false]);
        $this->recordMerchandiseAudit($request, 'deactivated', $item, $oldValues, $this->auditableMerchandiseValues($item));

        return response()->json(['message' => 'Item deactivated successfully.']);
    }

    public function adjustStock(Request $request, $id)
    {
        $item = Merchandise::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        $data = $request->validate([
            'stock_quantity' => ['required', 'integer', 'min:0'],
        ]);

        $item->update($data);

        return response()->json($item->fresh());
    }

    private function auditableMerchandiseValues(Merchandise $item): array
    {
        return [
            'id' => $item->id,
            'name' => $item->name,
            'category' => $item->category,
            'price' => $item->price,
            'stock_quantity' => $item->stock_quantity,
            'is_active' => $item->is_active,
            'image_url' => $item->image_url,
        ];
    }

    private function recordMerchandiseAudit(Request $request, string $action, Merchandise $item, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $request->user()?->organization_id,
            'user_id' => $request->user()?->school_id,
            'module' => 'merchandise',
            'action' => $action,
            'record_type' => Merchandise::class,
            'record_id' => $item->id,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
