<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Order;
use App\Models\User;
use App\Services\OrderFulfillmentService;
use DomainException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    public function __construct(private readonly OrderFulfillmentService $fulfillmentService)
    {
    }

    public function index(Request $request)
    {
        $user = $request->user();

        $query = Order::with([
            'merchandise:id,name,price,image_url',
            'student:school_id,first_name,last_name',
            'processor:school_id,first_name,last_name',
            'approver:school_id,first_name,last_name',
            'claimVerifier:school_id,first_name,last_name',
            'transaction:id,receipt_reference,receipt_number',
        ])
            ->where('organization_id', $user->organization_id)
            ->orderBy('created_at', 'desc');

        $personalView = $user->role === 'STUDENT' || $request->boolean('mine');

        if ($personalView) {
            $query->where('student_id', $user->id);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        $orders = $query->paginate(20);

        if ($personalView) {
            $orders->getCollection()->each(function (Order $order) {
                if (! in_array($order->status, ['paid', 'claimed'], true)) {
                    $order->setAttribute('claim_token', null);
                }
            });
        }

        return response()->json($orders);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'merchandise_id' => ['required', 'exists:merchandise,id'],
            'quantity' => ['required', 'integer', 'min:1'],
            'payment_method' => ['nullable', 'in:cash,gcash,other'],
            'payment_reference' => ['nullable', 'string', 'max:150', 'required_if:payment_method,gcash'],
            'payment_proof_url' => ['nullable', 'string', 'max:500'],
            'payment_proof' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        if (($data['payment_method'] ?? null) === 'gcash' && ! $request->hasFile('payment_proof') && empty($data['payment_proof_url'])) {
            return response()->json(['message' => 'GCash orders require an uploaded payment proof.'], 422);
        }

        if ($request->hasFile('payment_proof')) {
            $data['payment_proof_url'] = $this->storePaymentProof($request);
        }

        unset($data['payment_proof']);

        return DB::transaction(function () use ($data, $request) {
            $item = Merchandise::where('organization_id', $request->user()->organization_id)
                ->lockForUpdate()
                ->find($data['merchandise_id']);

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
                'student_id' => $request->user()->id,
                'merchandise_id' => $item->id,
                'quantity' => $data['quantity'],
                'total_price' => $item->price * $data['quantity'],
                'payment_method' => $data['payment_method'] ?? null,
                'payment_reference' => $data['payment_reference'] ?? null,
                'payment_proof_url' => $data['payment_proof_url'] ?? null,
                'officer_review_status' => 'pending',
                'admin_review_status' => 'pending',
                'status' => 'pending',
                'claim_token' => strtoupper(Str::random(8)),
                'organization_id' => $request->user()->organization_id,
            ]);

            $this->notifyFulfillmentTeam($order);

            $order->load('merchandise:id,name,price,image_url');
            $order->setAttribute('claim_token', null);

            return response()->json($order, 201);
        });
    }

    public function updateStatus(Request $request, $id)
    {
        $order = Order::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $data = $request->validate([
            'status' => ['required', 'in:paid,cancelled'],
            'review_remarks' => ['nullable', 'string', 'required_if:status,cancelled'],
        ]);

        try {
            if ($data['status'] === 'cancelled') {
                $order = $this->fulfillmentService->rejectPayment($order, $request->user(), $data['review_remarks']);
            } elseif ($request->user()->role === 'SBO_OFFICER') {
                $order->update([
                    'officer_review_status' => 'approved',
                    'processed_by' => $request->user()->id,
                    'review_remarks' => null,
                ]);

                ApprovalRequest::firstOrCreate(
                    [
                        'organization_id' => $order->organization_id,
                        'entity_type' => 'payment',
                        'entity_id' => $order->id,
                        'status' => 'pending',
                    ],
                    [
                        'requested_by' => $request->user()->id,
                        'required_role' => 'ADMIN',
                    ]
                );
                $order = $order->fresh();
            } else {
                $pendingApproval = ApprovalRequest::where('organization_id', $order->organization_id)
                    ->where('entity_type', 'payment')
                    ->where('entity_id', $order->id)
                    ->where('status', 'pending')
                    ->exists();

                if ($pendingApproval) {
                    return response()->json(['message' => 'Review this payment from the Approvals module.'], 422);
                }

                $order = $this->fulfillmentService->approvePayment($order, $request->user());
            }
        } catch (DomainException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json($order->load([
            'merchandise:id,name,price',
            'student:school_id,first_name,last_name',
            'processor:school_id,first_name,last_name',
            'approver:school_id,first_name,last_name',
            'transaction:id,receipt_reference,receipt_number',
        ]));
    }

    public function claimByToken(Request $request)
    {
        $data = $request->validate([
            'claim_token' => ['required', 'string'],
        ]);

        $order = Order::where('organization_id', $request->user()->organization_id)
            ->where('claim_token', strtoupper($data['claim_token']))
            ->first();

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
            'status' => 'claimed',
            'claimed_at' => now(),
            'claim_verified_by' => $request->user()->id,
            'claim_verified_at' => now(),
            'processed_by' => $request->user()->id,
        ]);

        return response()->json($order->fresh()->load([
            'merchandise:id,name,price,image_url',
            'student:school_id,first_name,last_name',
            'claimVerifier:school_id,first_name,last_name',
        ]));
    }

    private function storePaymentProof(Request $request): string
    {
        $file = $request->file('payment_proof');
        $extension = strtolower($file->extension() ?: 'jpg');
        $filename = Str::uuid().'.'.$extension;
        $directory = public_path('uploads/payments');

        if (! is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $file->move($directory, $filename);

        return '/uploads/payments/'.$filename;
    }

    private function notifyFulfillmentTeam(Order $order): void
    {
        $reviewers = User::where('organization_id', $order->organization_id)
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER'])
            ->where('account_status', 'active')
            ->get(['school_id']);

        foreach ($reviewers as $reviewer) {
            Notification::create([
                'organization_id' => $order->organization_id,
                'user_id' => $reviewer->school_id,
                'title' => 'New Merchandise Order',
                'message' => 'Order ORD-'.$order->id.' is awaiting payment verification.',
                'notification_type' => 'merchandise',
                'reference_type' => Order::class,
                'reference_id' => $order->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }
    }
}
