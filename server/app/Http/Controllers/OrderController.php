<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use App\Services\OrderFulfillmentService;
use DomainException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class OrderController extends Controller
{
    public function __construct(private readonly OrderFulfillmentService $fulfillmentService) {}

    public function index(Request $request)
    {
        $user = $request->user();

        $query = Order::with([
            'merchandise:id,name,price,image_url',
            'student:school_id,first_name,last_name,department,program,year_level',
            'processor:school_id,first_name,last_name',
            'approver:school_id,first_name,last_name',
            'claimVerifier:school_id,first_name,last_name',
            'transaction:id,receipt_reference,receipt_number',
        ])
            ->where('organization_id', $user->organization_id)
            ->orderBy('created_at', 'desc');

        $personalView = ! in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true) || $request->boolean('mine');

        if ($personalView) {
            $query->where('student_id', $user->id);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }
        if ($request->filled('search') && ! $personalView) {
            $search = trim($request->search);
            $query->where(fn ($q) => $q->where('id', 'like', "%{$search}%")
                ->orWhereHas('student', fn ($student) => $student->where('school_id', 'like', "%{$search}%")->orWhere('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%")->orWhere('department', 'like', "%{$search}%")->orWhere('program', 'like', "%{$search}%")->orWhere('year_level', 'like', "%{$search}%")));
        }

        $orders = $query->paginate(20);

        if ($personalView) {
            $orders->getCollection()->each(function (Order $order) {
                if (! in_array($order->status, ['paid', 'claimed'], true)) {
                    $order->setAttribute('claim_token', null);
                }
            });
        } else {
            $orders->getCollection()->each(fn (Order $order) => $order->setAttribute('claim_token', null));
        }

        return response()->json($orders);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'merchandise_id' => ['required', 'exists:merchandise,id'],
            'quantity' => ['required', 'integer', 'min:1'],
            'payment_method' => ['nullable', 'in:cash,gcash,other'],
            'payment_reference' => [
                'nullable',
                'string',
                'regex:/^\d{13}$/',
                Rule::unique('orders', 'payment_reference')->where(
                    fn ($query) => $query->where('organization_id', $request->user()->organization_id)
                ),
            ],
            'payment_proof' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        if (($data['payment_method'] ?? null) === 'gcash'
            && (empty($data['payment_reference']) xor ! $request->hasFile('payment_proof'))) {
            return response()->json(['message' => 'Submit both the GCash reference and payment proof, or submit both later from My Orders.'], 422);
        }

        if (($data['payment_method'] ?? null) === 'gcash' && ! $this->organizationHasGcashQr($request->user()->organization_id)) {
            return response()->json(['message' => 'GCash payment is unavailable until an administrator uploads the official QR code.'], 422);
        }

        unset($data['payment_proof']);

        return DB::transaction(function () use ($data, $request) {
            $item = Merchandise::where('organization_id', $request->user()->organization_id)
                ->lockForUpdate()
                ->find($data['merchandise_id']);

            if (! $item) {
                return response()->json(['message' => 'Item is no longer available.'], 422);
            }

            if (! $item->is_active) {
                return response()->json(['message' => 'This item is no longer available.'], 422);
            }

            if ($item->stock_quantity < $data['quantity']) {
                return response()->json([
                    'message' => "Insufficient stock. Only {$item->stock_quantity} unit(s) available.",
                ], 422);
            }

            $item->decrement('stock_quantity', $data['quantity']);

            $paymentProofUrl = $request->hasFile('payment_proof') ? $this->storePaymentProof($request) : null;

            try {
                $order = Order::create([
                    'student_id' => $request->user()->id,
                    'merchandise_id' => $item->id,
                    'quantity' => $data['quantity'],
                    'total_price' => $item->price * $data['quantity'],
                    'payment_method' => $data['payment_method'] ?? null,
                    'payment_reference' => $data['payment_reference'] ?? null,
                    'payment_reference_key' => ! empty($data['payment_reference'])
                        ? $this->paymentReferenceKey($request->user()->organization_id, $data['payment_reference'])
                        : null,
                    'payment_proof_url' => $paymentProofUrl,
                    'officer_review_status' => 'pending',
                    'admin_review_status' => 'pending',
                    'status' => 'pending',
                    'claim_token' => strtoupper(Str::random(16)),
                    'organization_id' => $request->user()->organization_id,
                ]);

                $this->notifyFulfillmentTeam($order);
                $this->audit($request, 'created', $order);
            } catch (\Throwable $exception) {
                $this->deletePaymentProof($paymentProofUrl);
                throw $exception;
            }

            $order->load('merchandise:id,name,price,image_url');
            $order->setAttribute('claim_token', null);

            return response()->json($order, 201);
        });
    }

    public function submitPayment(Request $request, $id)
    {
        $data = $request->validate([
            'payment_reference' => [
                'required',
                'string',
                'regex:/^\d{13}$/',
                Rule::unique('orders', 'payment_reference')
                    ->where(fn ($query) => $query->where('organization_id', $request->user()->organization_id))
                    ->ignore($id),
            ],
            'payment_proof' => ['required', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        if (! $this->organizationHasGcashQr($request->user()->organization_id)) {
            return response()->json(['message' => 'GCash payment is unavailable until an administrator uploads the official QR code.'], 422);
        }

        $paymentProofUrl = $this->storePaymentProof($request);
        $oldPaymentProofUrl = null;

        try {
            $order = DB::transaction(function () use ($request, $id, $data, $paymentProofUrl, &$oldPaymentProofUrl) {
                $order = Order::where('organization_id', $request->user()->organization_id)
                    ->lockForUpdate()
                    ->find($id);

                if (! $order) {
                    return null;
                }

                if ($order->student_id !== $request->user()->id) {
                    abort(403, 'You can only submit payment for your own order.');
                }

                if ($order->status !== 'pending' || $order->officer_review_status !== 'pending') {
                    abort(409, 'Payment can only be submitted while the order is awaiting review.');
                }

                $oldPaymentProofUrl = $order->payment_proof_url;
                $order->update([
                    'payment_method' => 'gcash',
                    'payment_reference' => $data['payment_reference'],
                    'payment_reference_key' => $this->paymentReferenceKey($order->organization_id, $data['payment_reference']),
                    'payment_proof_url' => $paymentProofUrl,
                    'review_remarks' => null,
                ]);
                $this->notifyFulfillmentTeam($order);
                $this->audit($request, 'payment_submitted', $order);

                return $order->fresh();
            });
        } catch (\Throwable $exception) {
            $this->deletePaymentProof($paymentProofUrl);
            throw $exception;
        }

        if (! $order) {
            $this->deletePaymentProof($paymentProofUrl);

            return response()->json(['message' => 'Order not found.'], 404);
        }

        $this->deletePaymentProof($oldPaymentProofUrl);

        return response()->json($order->load('merchandise:id,name,price,image_url'));
    }

    public function updateStatus(Request $request, $id)
    {
        $order = Order::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $data = $request->validate([
            'status' => ['required', 'in:paid,cancelled'],
            'review_remarks' => ['nullable', 'string', 'required_if:status,cancelled'],
            'verified_amount' => ['nullable', 'numeric', 'min:0.01'],
        ]);

        if ($data['status'] === 'paid' && $request->user()->role === 'SBO_OFFICER' && ! isset($data['verified_amount'])) {
            return response()->json(['message' => 'Enter the payment amount shown on the proof before submitting it for approval.'], 422);
        }

        if ($data['status'] === 'paid' && isset($data['verified_amount']) && abs((float) $data['verified_amount'] - (float) $order->total_price) >= 0.01) {
            return response()->json(['message' => 'The verified payment amount must exactly match the order total.'], 422);
        }

        if ($data['status'] === 'paid' && $order->payment_method === 'gcash'
            && (! $order->payment_reference || ! $order->payment_proof_url)) {
            return response()->json(['message' => 'A valid GCash reference and payment proof are required before verification.'], 422);
        }

        $pendingApproval = ApprovalRequest::where('organization_id', $order->organization_id)
            ->where('entity_type', 'payment')
            ->where('entity_id', $order->id)
            ->where('status', 'pending')
            ->exists();

        if ($data['status'] === 'paid' && $order->status !== 'pending') {
            return response()->json(['message' => "Only pending orders can be reviewed. Current status: {$order->status}."], 422);
        }

        try {
            if ($data['status'] === 'cancelled') {
                if ($pendingApproval) {
                    return response()->json(['message' => 'Review this payment from the Approvals module.'], 422);
                }
                $order = $this->fulfillmentService->rejectPayment($order, $request->user(), $data['review_remarks']);
            } elseif ($request->user()->role === 'SBO_OFFICER') {
                $order = DB::transaction(function () use ($request, $order) {
                    $lockedOrder = Order::where('organization_id', $request->user()->organization_id)
                        ->whereKey($order->id)
                        ->lockForUpdate()
                        ->firstOrFail();
                    $alreadyPending = ApprovalRequest::where('organization_id', $lockedOrder->organization_id)
                        ->where('entity_type', 'payment')
                        ->where('entity_id', $lockedOrder->id)
                        ->where('status', 'pending')
                        ->exists();

                    if ($lockedOrder->status !== 'pending' || $lockedOrder->officer_review_status === 'approved' || $alreadyPending) {
                        throw new DomainException('This payment has already been submitted for admin approval.');
                    }

                    $lockedOrder->update([
                        'officer_review_status' => 'approved',
                        'processed_by' => $request->user()->id,
                        'review_remarks' => null,
                    ]);
                    ApprovalRequest::create([
                        'organization_id' => $lockedOrder->organization_id,
                        'entity_type' => 'payment',
                        'entity_id' => $lockedOrder->id,
                        'requested_by' => $request->user()->id,
                        'required_role' => 'ADMIN',
                        'status' => 'pending',
                        'active_key' => 'payment:'.$lockedOrder->organization_id.':'.$lockedOrder->id,
                    ]);

                    return $lockedOrder->fresh();
                });
            } else {
                if ($pendingApproval) {
                    return response()->json(['message' => 'Review this payment from the Approvals module.'], 422);
                }

                return response()->json(['message' => 'An SBO Officer must verify and submit this payment before admin approval.'], 422);
            }
        } catch (DomainException $exception) {
            $status = str_contains($exception->getMessage(), 'already been submitted') ? 409 : 422;

            return response()->json(['message' => $exception->getMessage()], $status);
        }

        return response()->json($order->load([
            'merchandise:id,name,price',
            'student:school_id,first_name,last_name',
            'processor:school_id,first_name,last_name',
            'approver:school_id,first_name,last_name',
            'transaction:id,receipt_reference,receipt_number',
        ]));
    }

    public function auditHistory(Request $request, $id)
    {
        $order = Order::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        return response()->json(AuditLog::with('user:school_id,first_name,last_name,role')
            ->where('organization_id', $order->organization_id)->where('record_type', Order::class)->where('record_id', $order->id)->latest('created_at')->get());
    }

    public function claimByToken(Request $request)
    {
        $data = $request->validate([
            'claim_token' => ['required', 'string'],
        ]);

        $result = DB::transaction(function () use ($request, $data) {
            $order = Order::where('organization_id', $request->user()->organization_id)
                ->where('claim_token', strtoupper($data['claim_token']))
                ->lockForUpdate()
                ->first();

            if (! $order) {
                return ['error' => 'Invalid claim token.', 'status' => 404];
            }

            if ($order->status === 'claimed') {
                return ['error' => 'This token has already been used.', 'status' => 409];
            }

            if ($order->status !== 'paid') {
                return ['error' => "Order cannot be claimed. Current status: {$order->status}.", 'status' => 422];
            }

            $order->update([
                'status' => 'claimed',
                'claimed_at' => now(),
                'claim_verified_by' => $request->user()->id,
                'claim_verified_at' => now(),
                'processed_by' => $request->user()->id,
            ]);

            return ['order' => $order->fresh()];
        });

        if (isset($result['error'])) {
            return response()->json(['message' => $result['error']], $result['status']);
        }

        $order = $result['order'];

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

    private function deletePaymentProof(?string $paymentProofUrl): void
    {
        if (! $paymentProofUrl || ! str_starts_with($paymentProofUrl, '/uploads/payments/')) {
            return;
        }

        $path = public_path(ltrim($paymentProofUrl, '/'));
        if (is_file($path)) {
            @unlink($path);
        }
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

    private function paymentReferenceKey(int $organizationId, string $reference): string
    {
        return hash('sha256', $organizationId.':'.trim($reference));
    }

    private function organizationHasGcashQr(int $organizationId): bool
    {
        return Organization::whereKey($organizationId)->whereNotNull('gcash_qr_url')->where('gcash_qr_url', '!=', '')->exists();
    }

    private function audit(Request $request, string $action, Order $order): void
    {
        AuditLog::create(['organization_id' => $order->organization_id, 'user_id' => $request->user()->school_id, 'module' => 'orders', 'action' => $action, 'record_type' => Order::class, 'record_id' => $order->id, 'new_values' => $order->only(['status', 'total_price', 'student_id', 'transaction_id']), 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
