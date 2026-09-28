<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Merchandise;
use App\Models\MerchandiseVariant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class MerchandiseController extends Controller
{
    private function storeMerchandiseImage(Request $request): string
    {
        $file = $request->file('image');
        return $this->storeImageFile($file);
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
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = Merchandise::with('variants')->withCount('orders')
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('name', 'asc')
            ->orderBy('id');

        if ($request->user()->role !== 'ADMIN') {
            $query->where('is_active', true);
        }

        $items = $query->paginate($paging['per_page'] ?? 20);
        $items->getCollection()->each(fn (Merchandise $item) => $this->decorate($item, $request->user()->school_id));

        return response()->json($items);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'category' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string'],
            'price' => ['required', 'numeric', 'min:0'],
            'stock_quantity' => ['required', 'integer', 'min:0'],
            'is_active' => ['boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
            ...$this->catalogRules(),
        ]);

        $variants = $this->parseVariants($request);
        $this->validatePromotion($data);
        if ($variants !== []) {
            $data['stock_quantity'] = array_sum(array_column($variants, 'stock_quantity'));
        }

        if ($request->hasFile('image')) {
            $data['image_url'] = $this->storeMerchandiseImage($request);
        }
        unset($data['image'], $data['variants'], $data['variant_images']);

        try {
            $item = DB::transaction(function () use ($data, $variants, $request) {
                $item = Merchandise::create([...$data, 'organization_id' => $request->user()->organization_id]);
                $this->saveVariants($request, $item, $variants);
                $this->recordMerchandiseAudit($request, 'created', $item, null, $this->auditableMerchandiseValues($item));

                return $item;
            });
        } catch (\Throwable $exception) {
            $this->deleteMerchandiseImage($data['image_url'] ?? null);
            throw $exception;
        }

        return response()->json($this->decorate($item->fresh()->load('variants'), $request->user()->school_id), 201);
    }

    public function update(Request $request, $id)
    {
        $item = Merchandise::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'category' => ['sometimes', 'required', 'string', 'max:100'],
            'description' => ['nullable', 'string'],
            'price' => ['sometimes', 'required', 'numeric', 'min:0'],
            'stock_quantity' => ['sometimes', 'required', 'integer', 'min:0'],
            'is_active' => ['boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
            ...$this->catalogRules(),
        ]);
        $variants = $request->exists('variants') ? $this->parseVariants($request) : null;
        $this->validatePromotion($data, $item);
        if ($variants !== null && ($variants !== [] || $item->variants()->exists())) {
            $data['stock_quantity'] = array_sum(array_column($variants, 'stock_quantity'));
        } elseif ($item->variants()->exists() && array_key_exists('stock_quantity', $data)) {
            return response()->json(['message' => 'Change stock for each variant.'], 422);
        }

        $oldImageUrl = $item->image_url;
        $newImageUrl = $request->hasFile('image') ? $this->storeMerchandiseImage($request) : null;
        if ($newImageUrl) {
            $data['image_url'] = $newImageUrl;
        }
        unset($data['image'], $data['variants'], $data['variant_images']);

        $oldValues = $this->auditableMerchandiseValues($item);

        try {
            DB::transaction(function () use ($item, $data, $variants, $request, $oldValues) {
                $item->update($data);
                if ($variants !== null) {
                    $this->saveVariants($request, $item, $variants);
                }
                $action = array_key_exists('is_active', $data) && $oldValues['is_active'] !== (bool) $data['is_active']
                    ? ($data['is_active'] ? 'reactivated' : 'deactivated') : 'updated';
                $this->recordMerchandiseAudit($request, $action, $item, $oldValues, $this->auditableMerchandiseValues($item->fresh()));
            });
        } catch (\Throwable $exception) {
            $this->deleteMerchandiseImage($newImageUrl);
            throw $exception;
        }

        if ($newImageUrl) {
            $this->deleteMerchandiseImage($oldImageUrl);
        }

        return response()->json($this->decorate($item->fresh()->load('variants'), $request->user()->school_id));
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
        $data = $request->validate([
            'stock_delta' => ['required', 'integer', 'min:1', 'max:1000000'],
            'note' => ['required', 'string', 'max:500'],
            'variant_id' => ['nullable', 'integer'],
        ]);

        $item = DB::transaction(function () use ($request, $id, $data) {
            $item = Merchandise::where('organization_id', $request->user()->organization_id)
                ->lockForUpdate()
                ->find($id);

            if (! $item) {
                return null;
            }

            $variant = null;
            if ($item->variants()->exists()) {
                $variant = $item->variants()->where('organization_id', $item->organization_id)
                    ->whereKey($data['variant_id'] ?? 0)->lockForUpdate()->first();
                if (! $variant) {
                    throw ValidationException::withMessages(['variant_id' => 'Select a valid variant for this product.']);
                }
            } elseif (! empty($data['variant_id'])) {
                throw ValidationException::withMessages(['variant_id' => 'This product has no variants.']);
            }

            $oldValues = $this->auditableMerchandiseValues($item);
            $oldValues['variant_stock_quantity'] = $variant?->stock_quantity;
            if ($variant) {
                $variant->increment('stock_quantity', $data['stock_delta']);
            }
            $item->increment('stock_quantity', $data['stock_delta']);
            $item->refresh();
            $newValues = $this->auditableMerchandiseValues($item);
            $newValues['variant_stock_quantity'] = $variant?->fresh()->stock_quantity;
            $newValues['variant_id'] = $variant?->id;
            $newValues['variant_name'] = $variant?->name;
            $newValues['note'] = $data['note'];
            $this->recordMerchandiseAudit($request, 'stock_adjusted', $item, $oldValues, $newValues);

            return $item;
        });

        if (! $item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        return response()->json($this->decorate($item->fresh()->load('variants'), $request->user()->school_id));
    }

    public function auditHistory(Request $request, $id)
    {
        $item = Merchandise::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        return response()->json(AuditLog::with('user:school_id,first_name,last_name,role,position_title')
            ->where('organization_id', $item->organization_id)
            ->where('record_type', Merchandise::class)->where('record_id', $item->id)
            ->orderByDesc('created_at')->orderByDesc('id')->limit(100)->get());
    }

    private function catalogRules(): array
    {
        return [
            'low_stock_threshold' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'promotion_price' => ['nullable', 'numeric', 'min:0'],
            'promotion_buyer_limit' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'variants' => ['nullable', 'string'],
            'variant_images' => ['nullable', 'array'],
            'variant_images.*' => ['image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ];
    }

    private function validatePromotion(array $data, ?Merchandise $item = null): void
    {
        $price = array_key_exists('promotion_price', $data) ? $data['promotion_price'] : $item?->promotion_price;
        $limit = array_key_exists('promotion_buyer_limit', $data) ? $data['promotion_buyer_limit'] : $item?->promotion_buyer_limit;
        if (($price === null) !== ($limit === null)) {
            throw ValidationException::withMessages(['promotion_price' => 'Set both the promotion price and buyer limit.']);
        }
        if ($price !== null && (float) $price >= (float) ($data['price'] ?? $item?->price)) {
            throw ValidationException::withMessages(['promotion_price' => 'Promotion price must be lower than the regular price.']);
        }
    }

    private function parseVariants(Request $request): array
    {
        $raw = $request->input('variants');
        if ($raw === null || $raw === '') {
            return [];
        }
        $variants = json_decode($raw, true);
        if (! is_array($variants) || ! array_is_list($variants) || count($variants) > 50) {
            throw ValidationException::withMessages(['variants' => 'Provide a list of up to 50 variants.']);
        }
        $names = [];
        foreach ($variants as $variant) {
            if (! is_array($variant) || ! is_string($variant['name'] ?? null)
                || trim($variant['name']) === '' || mb_strlen($variant['name']) > 100
                || filter_var($variant['stock_quantity'] ?? null, FILTER_VALIDATE_INT) === false
                || (int) $variant['stock_quantity'] < 0) {
                throw ValidationException::withMessages(['variants' => 'Each variant needs a name and nonnegative whole number stock.']);
            }
            $key = mb_strtolower(trim($variant['name']));
            if (in_array($key, $names, true)) {
                throw ValidationException::withMessages(['variants' => 'Variant names must be unique.']);
            }
            $names[] = $key;
        }

        return $variants;
    }

    private function saveVariants(Request $request, Merchandise $item, array $variants): void
    {
        $kept = [];
        foreach ($variants as $index => $row) {
            $variant = isset($row['id'])
                ? $item->variants()->where('organization_id', $item->organization_id)->find($row['id']) : null;
            if (isset($row['id']) && ! $variant) {
                throw ValidationException::withMessages(['variants' => 'Variant does not belong to this product.']);
            }
            $image = $request->file("variant_images.$index");
            $values = ['name' => trim($row['name']), 'stock_quantity' => (int) $row['stock_quantity']];
            if ($image) {
                $values['image_url'] = $this->storeImageFile($image);
            }
            if ($variant) {
                $variant->update($values);
            } else {
                $variant = $item->variants()->create([...$values, 'organization_id' => $item->organization_id]);
            }
            $kept[] = $variant->id;
        }
        $removed = $item->variants()->whereNotIn('id', $kept);
        if ($removed->whereHas('orders')->exists()) {
            throw ValidationException::withMessages(['variants' => 'A variant with orders cannot be removed.']);
        }
        $item->variants()->whereNotIn('id', $kept)->delete();
    }

    private function storeImageFile($file): string
    {
        $filename = Str::uuid()->toString().'.'.strtolower($file->extension() ?: 'jpg');
        $directory = public_path('uploads/merchandise');
        if (! is_dir($directory)) {
            mkdir($directory, 0755, true);
        }
        $file->move($directory, $filename);

        return '/uploads/merchandise/'.$filename;
    }

    private function decorate(Merchandise $item, int $viewerId): Merchandise
    {
        $used = $item->orders()->where('promotion_applied', true)
            ->where('status', '!=', 'cancelled')->distinct()->count('student_id');
        $remaining = $item->promotion_buyer_limit === null ? null : max(0, $item->promotion_buyer_limit - $used);
        $alreadyQualified = $item->orders()->where('student_id', $viewerId)->where('promotion_applied', true)
            ->where('status', '!=', 'cancelled')->exists();
        $item->setAttribute('promotion_remaining', $remaining);
        $item->setAttribute('promotion_available_to_viewer', $item->promotion_price !== null && ($remaining > 0 || $alreadyQualified));
        $item->setAttribute('effective_price', $item->promotion_price !== null && ($remaining > 0 || $alreadyQualified) ? $item->promotion_price : $item->price);
        $item->setAttribute('is_low_stock', $item->stock_quantity > 0 && $item->stock_quantity <= $item->low_stock_threshold);

        return $item;
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
            'low_stock_threshold' => $item->low_stock_threshold,
            'promotion_price' => $item->promotion_price,
            'promotion_buyer_limit' => $item->promotion_buyer_limit,
            'variants' => $item->variants()->get(['id', 'name', 'stock_quantity', 'image_url'])->toArray(),
        ];
    }

    private function recordMerchandiseAudit(Request $request, string $action, Merchandise $item, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $request->user()?->organization_id,
            'user_id' => $request->user()?->school_id,
            'module' => 'merchandise',
            'actor_role' => $request->user()?->role,
            'description' => $action.' merchandise '.$item->name,
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
