<?php

namespace App\Http\Controllers;

use App\Models\Order;
use App\Models\Merchandise;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $query = Order::with([
            'merchandise:id,name,price,image_url',
            'student:id,first_name,last_name,school_id',
            'processor:id,first_name,last_name',
        ])->orderBy('created_at', 'desc');

        if ($user->role === 'student') {
            $query->where('student_id', $user->id);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        return response()->json($query->paginate(20));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'merchandise_id' => ['required', 'exists:merchandise,id'],
            'quantity'       => ['required', 'integer', 'min:1'],
        ]);

        return DB::transaction(function () use ($data, $request) {
            $item = Merchandise::lockForUpdate()->find($data['merchandise_id']);

            if (!$item) {
                return response()->json(['message' => 'Item is no longer available.'], 422);
            }

            if (!$item->is_active) {
                return response()->json(['message' => 'This item is no longer available.'], 422);
            }

            if ($item->stock_quantity < $data['quantity']) {
                return response()->json([
                    'message' => "Insufficient stock. Only {$item->stock_quantity} unit(s) available.",
                ], 422);
            }

            $item->decrement('stock_quantity', $data['quantity']);

            $order = Order::create([
                'student_id'     => $request->user()->id,
                'merchandise_id' => $item->id,
                'quantity'       => $data['quantity'],
                'total_price'    => $item->price * $data['quantity'],
                'status'         => 'pending',
                'claim_token'    => strtoupper(Str::random(8)),
            ]);

            return response()->json(
                $order->load('merchandise:id,name,price,image_url'),
                201
            );
        });
    }

    public function updateStatus(Request $request, $id)
    {
        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $data = $request->validate([
            'status' => ['required', 'in:pending,paid,claimed,cancelled'],
        ]);

        $previousStatus = $order->status;

        if ($previousStatus === 'cancelled' && $data['status'] !== 'cancelled') {
            return response()->json(['message' => 'Cancelled orders cannot be reactivated.'], 422);
        }

        $order->update([
            'status'       => $data['status'],
            'processed_by' => $request->user()->id,
        ]);

        if ($data['status'] === 'cancelled' && in_array($previousStatus, ['pending', 'paid'])) {
            $order->merchandise()->increment('stock_quantity', $order->quantity);
        }

        return response()->json($order->fresh()->load([
            'merchandise:id,name,price',
            'student:id,first_name,last_name,school_id',
        ]));
    }

    public function claimByToken(Request $request)
    {
        $data = $request->validate([
            'claim_token' => ['required', 'string'],
        ]);

        $order = Order::where('claim_token', strtoupper($data['claim_token']))->first();

        if (!$order) {
            return response()->json(['message' => 'Invalid claim token.'], 404);
        }

        if ($order->status === 'claimed') {
            return response()->json(['message' => 'This token has already been used.'], 409);
        }

        if ($order->status !== 'paid') {
            return response()->json([
                'message' => "Order cannot be claimed. Current status: {$order->status}.",
            ], 422);
        }

        $order->update([
            'status'       => 'claimed',
            'claimed_at'   => now(),
            'processed_by' => $request->user()->id,
        ]);

        return response()->json($order->fresh()->load([
            'merchandise:id,name,price,image_url',
            'student:id,first_name,last_name,school_id',
        ]));
    }
}
