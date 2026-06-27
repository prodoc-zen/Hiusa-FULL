<?php

namespace App\Http\Controllers;

use App\Models\Merchandise;
use Illuminate\Http\Request;

class MerchandiseController extends Controller
{
    public function index(Request $request)
    {
        $query = Merchandise::withCount('orders')->orderBy('name', 'asc');

        if ($request->user()->role === 'student') {
            $query->where('is_active', true);
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name'           => ['required', 'string', 'max:255'],
            'category'       => ['nullable', 'string', 'max:100'],
            'description'    => ['nullable', 'string'],
            'price'          => ['required', 'numeric', 'min:0'],
            'stock_quantity' => ['required', 'integer', 'min:0'],
            'image_url'      => ['nullable', 'string', 'max:500'],
            'is_active'      => ['boolean'],
        ]);

        $item = Merchandise::create($data);

        return response()->json($item, 201);
    }

    public function update(Request $request, $id)
    {
        $item = Merchandise::find($id);

        if (!$item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        $data = $request->validate([
            'name'           => ['sometimes', 'required', 'string', 'max:255'],
            'category'       => ['nullable', 'string', 'max:100'],
            'description'    => ['nullable', 'string'],
            'price'          => ['sometimes', 'required', 'numeric', 'min:0'],
            'stock_quantity' => ['sometimes', 'required', 'integer', 'min:0'],
            'image_url'      => ['nullable', 'string', 'max:500'],
            'is_active'      => ['boolean'],
        ]);

        $item->update($data);

        return response()->json($item->fresh());
    }

    public function destroy($id)
    {
        $item = Merchandise::find($id);

        if (!$item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        $blockedStatuses = ['pending', 'paid'];
        if ($item->orders()->whereIn('status', $blockedStatuses)->exists()) {
            return response()->json([
                'message' => 'Cannot delete an item with pending or paid orders.',
            ], 409);
        }

        $item->delete();

        return response()->json(['message' => 'Item deleted successfully.']);
    }

    public function adjustStock(Request $request, $id)
    {
        $item = Merchandise::find($id);

        if (!$item) {
            return response()->json(['message' => 'Item not found.'], 404);
        }

        $data = $request->validate([
            'stock_quantity' => ['required', 'integer', 'min:0'],
        ]);

        $item->update($data);

        return response()->json($item->fresh());
    }
}
