<?php

namespace App\Http\Controllers;

use App\Models\AcademicProgram;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use App\Services\OrderFulfillmentService;
use DomainException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class OrderController extends Controller
{
    public function __construct(private readonly OrderFulfillmentService $fulfillmentService) {}

    public function index(Request $request)
    {
        $user = $request->user();

        $filters = $this->validateOrderFilters($request);

        $query = Order::with([
            'merchandise:id,name,category,price,image_url',
            'student:school_id,first_name,last_name,email,department,program,major,year_level,section,role,position_title,account_status',
            'processor:school_id,first_name,last_name,role,position_title',
            'approver:school_id,first_name,last_name,role,position_title',
            'claimVerifier:school_id,first_name,last_name,role,position_title',
            'transaction:id,receipt_reference,receipt_number,transaction_date,amount',
        ])
            ->where('organization_id', $user->organization_id);

        $personalView = ! in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true) || $request->boolean('mine');

        if ($personalView) {
            $query->where('student_id', $user->id);
        } else {
            $this->applyOrderFilters($query, $filters);
        }

        $this->applyOrderSort($query, $filters['sort'] ?? 'newest');

        $summary = $personalView ? null : $this->orderSummary($request, $filters);
        $orders = $query->paginate(10)->withQueryString();

        if ($personalView) {
            $orders->getCollection()->each(function (Order $order) {
                if (! in_array($order->status, ['paid', 'claimed'], true)) {
                    $order->setAttribute('claim_token', null);
                }
            });
        } else {
            $orders->getCollection()->each(fn (Order $order) => $order->setAttribute('claim_token', null));
        }

        return response()->json([
            ...$orders->toArray(),
            'summary' => $summary,
            'filter_options' => $personalView ? null : $this->orderFilterOptions($request),
            'active_filters' => array_filter($filters, fn ($value) => $value !== null && $value !== ''),
        ]);
    }

    public function analyticsUsers(Request $request)
    {
        $filters = $this->validateOrderFilters($request);
        $group = $request->validate(['group' => ['required', 'in:purchased,not_purchased,paid,pending,claimed,unclaimed']])['group'];

        $users = User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('account_status', 'active');
        $this->applyUserFilters($users, $filters);

        $orderConstraint = function ($query) use ($request, $filters, $group) {
            $query->where('organization_id', $request->user()->organization_id);
            $this->applyOrderRecordFilters($query, $filters);
            match ($group) {
                'paid' => $query->whereIn('status', ['paid', 'claimed']),
                'pending' => $query->where('status', 'pending'),
                'claimed' => $query->where('status', 'claimed'),
                'unclaimed' => $query->where('status', 'paid'),
                default => null,
            };
        };

        if ($group === 'not_purchased') {
            $users->whereDoesntHave('orders', $orderConstraint);
        } else {
            $users->whereHas('orders', $orderConstraint);
        }

        $users->with(['orders' => function ($query) use ($orderConstraint) {
            $orderConstraint($query);
            $query->with([
                'merchandise:id,name,category,price',
                'processor:school_id,first_name,last_name',
                'approver:school_id,first_name,last_name',
                'claimVerifier:school_id,first_name,last_name',
                'transaction:id,receipt_reference,receipt_number,transaction_date,amount',
            ])->latest('created_at');
        }]);

        return response()->json($users->orderBy('last_name')->orderBy('first_name')->paginate(10));
    }

    public function export(Request $request): StreamedResponse
    {
        $filters = $this->validateOrderFilters($request);
        $query = Order::with([
            'merchandise:id,name,category,price',
            'student:school_id,first_name,last_name,email,department,program,major,year_level,section,role,position_title',
            'processor:school_id,first_name,last_name',
            'approver:school_id,first_name,last_name',
            'claimVerifier:school_id,first_name,last_name',
            'transaction:id,receipt_reference,receipt_number,transaction_date,amount',
        ])->where('organization_id', $request->user()->organization_id);
        $this->applyOrderFilters($query, $filters);
        $this->applyOrderSort($query, $filters['sort'] ?? 'newest');

        return response()->streamDownload(function () use ($query) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, ['Order ID', 'Student ID', 'Full Name', 'Email', 'Department', 'Program', 'Major', 'Year Level', 'Section', 'Role', 'SBO Position', 'Item', 'Category', 'Quantity', 'Unit Price', 'Total Amount', 'Payment Method', 'Payment Reference', 'Payment Status', 'Order Status', 'Officer Review', 'Admin Review', 'Order Date', 'Payment Date', 'Claimed Date', 'Processed By', 'Approved By', 'Released By', 'Receipt Reference', 'Remarks']);
            $query->chunk(250, function ($orders) use ($handle) {
                foreach ($orders as $order) {
                    fputcsv($handle, [
                        'ORD-'.$order->id, $order->student_id, trim(($order->student?->first_name ?? '').' '.($order->student?->last_name ?? '')), $order->student?->email,
                        $order->student?->department, $order->student?->program, $order->student?->major, $order->student?->year_level, $order->student?->section,
                        $order->student?->role, $order->student?->position_title, $order->merchandise?->name, $order->merchandise?->category, $order->quantity,
                        $order->merchandise?->price, $order->total_price, $order->payment_method, $order->payment_reference,
                        in_array($order->status, ['paid', 'claimed'], true) ? 'paid' : ($order->status === 'cancelled' ? 'cancelled' : 'pending'),
                        $order->status, $order->officer_review_status, $order->admin_review_status, $order->created_at?->toDateTimeString(),
                        $order->transaction?->transaction_date?->toDateTimeString(), $order->claimed_at?->toDateTimeString(),
                        $order->processor ? trim($order->processor->first_name.' '.$order->processor->last_name) : null,
                        $order->approver ? trim($order->approver->first_name.' '.$order->approver->last_name) : null,
                        $order->claimVerifier ? trim($order->claimVerifier->first_name.' '.$order->claimVerifier->last_name) : null,
                        $order->transaction?->receipt_reference, $order->review_remarks,
                    ]);
                }
            });
            fclose($handle);
        }, 'merchandise-orders-'.now()->format('Y-m-d-His').'.csv', ['Content-Type' => 'text/csv']);
    }

    private function validateOrderFilters(Request $request): array
    {
        return $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'department' => ['nullable', 'string', 'max:120'],
            'program' => ['nullable', 'string', 'max:120'],
            'major' => ['nullable', 'string', 'max:120'],
            'year_level' => ['nullable', 'in:1st Year,2nd Year,3rd Year,4th Year'],
            'section' => ['nullable', 'string', 'max:60'],
            'role' => ['nullable', 'in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'position_title' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:pending,paid,claimed,cancelled'],
            'payment_status' => ['nullable', 'in:pending,paid,cancelled'],
            'payment_method' => ['nullable', 'in:cash,gcash,other'],
            'merchandise_id' => ['nullable', 'integer'],
            'ordered_from' => ['nullable', 'date'],
            'ordered_to' => ['nullable', 'date', 'after_or_equal:ordered_from'],
            'paid_from' => ['nullable', 'date'],
            'paid_to' => ['nullable', 'date', 'after_or_equal:paid_from'],
            'claimed_from' => ['nullable', 'date'],
            'claimed_to' => ['nullable', 'date', 'after_or_equal:claimed_from'],
            'sort' => ['nullable', 'in:newest,oldest,amount_high,amount_low,student,item,status'],
            'per_page' => ['nullable', 'integer', 'in:10'],
        ]);
    }

    private function applyOrderFilters(Builder $query, array $filters): void
    {
        $this->applyOrderRecordFilters($query, $filters);
        $query->whereHas('student', function (Builder $student) use ($filters) {
            $this->applyUserFilters($student, $filters);
        });

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function (Builder $nested) use ($search) {
                $nested->where('orders.id', 'like', "%{$search}%")
                    ->orWhere('orders.payment_reference', 'like', "%{$search}%")
                    ->orWhere('orders.review_remarks', 'like', "%{$search}%")
                    ->orWhereHas('merchandise', fn (Builder $item) => $item->where('name', 'like', "%{$search}%")->orWhere('category', 'like', "%{$search}%"))
                    ->orWhereHas('student', function (Builder $student) use ($search) {
                        $student->where('school_id', 'like', "%{$search}%")
                            ->orWhere('first_name', 'like', "%{$search}%")
                            ->orWhere('last_name', 'like', "%{$search}%")
                            ->orWhere('email', 'like', "%{$search}%")
                            ->orWhere('department', 'like', "%{$search}%")
                            ->orWhere('program', 'like', "%{$search}%")
                            ->orWhere('major', 'like', "%{$search}%")
                            ->orWhere('year_level', 'like', "%{$search}%")
                            ->orWhere('section', 'like', "%{$search}%")
                            ->orWhere('position_title', 'like', "%{$search}%");
                    });
            });
        }
    }

    private function applyOrderRecordFilters($query, array $filters): void
    {
        if (! empty($filters['status'])) {
            $query->where('orders.status', $filters['status']);
        }
        if (! empty($filters['payment_status'])) {
            match ($filters['payment_status']) {
                'paid' => $query->whereIn('orders.status', ['paid', 'claimed']),
                'cancelled' => $query->where('orders.status', 'cancelled'),
                default => $query->where('orders.status', 'pending'),
            };
        }
        if (! empty($filters['payment_method'])) {
            $query->where('orders.payment_method', $filters['payment_method']);
        }
        if (! empty($filters['merchandise_id'])) {
            $query->where('orders.merchandise_id', $filters['merchandise_id']);
        }
        if (! empty($filters['ordered_from'])) {
            $query->whereDate('orders.created_at', '>=', $filters['ordered_from']);
        }
        if (! empty($filters['ordered_to'])) {
            $query->whereDate('orders.created_at', '<=', $filters['ordered_to']);
        }
        if (! empty($filters['claimed_from'])) {
            $query->whereDate('orders.claimed_at', '>=', $filters['claimed_from']);
        }
        if (! empty($filters['claimed_to'])) {
            $query->whereDate('orders.claimed_at', '<=', $filters['claimed_to']);
        }
        if (! empty($filters['paid_from']) || ! empty($filters['paid_to'])) {
            $query->whereHas('transaction', function (Builder $transaction) use ($filters) {
                if (! empty($filters['paid_from'])) {
                    $transaction->whereDate('transaction_date', '>=', $filters['paid_from']);
                }
                if (! empty($filters['paid_to'])) {
                    $transaction->whereDate('transaction_date', '<=', $filters['paid_to']);
                }
            });
        }
    }

    private function applyUserFilters(Builder $query, array $filters): void
    {
        foreach (['department', 'program', 'major', 'year_level', 'section', 'role', 'position_title'] as $field) {
            if (! empty($filters[$field])) {
                $query->where($field, $filters[$field]);
            }
        }
    }

    private function applyOrderSort(Builder $query, string $sort): void
    {
        match ($sort) {
            'oldest' => $query->orderBy('orders.created_at'),
            'amount_high' => $query->orderByDesc('orders.total_price'),
            'amount_low' => $query->orderBy('orders.total_price'),
            'status' => $query->orderBy('orders.status')->orderByDesc('orders.created_at'),
            'student' => $query->orderBy(
                User::select('last_name')->whereColumn('users.school_id', 'orders.student_id')->limit(1)
            )->orderByDesc('orders.created_at'),
            'item' => $query->orderBy(
                Merchandise::select('name')->whereColumn('merchandise.id', 'orders.merchandise_id')->limit(1)
            )->orderByDesc('orders.created_at'),
            default => $query->orderByDesc('orders.created_at'),
        };
    }

    private function orderSummary(Request $request, array $filters): array
    {
        $orders = Order::query()->where('orders.organization_id', $request->user()->organization_id);
        $this->applyOrderFilters($orders, $filters);

        $cohort = User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('account_status', 'active');
        $this->applyUserFilters($cohort, $filters);

        $totalUsers = (clone $cohort)->count();
        $purchaserIds = (clone $orders)->distinct()->pluck('student_id');
        $purchasedUsers = (clone $cohort)->whereIn('school_id', $purchaserIds)->count();
        $totalOrders = (clone $orders)->count();
        $paidOrders = (clone $orders)->whereIn('status', ['paid', 'claimed'])->count();
        $claimedOrders = (clone $orders)->where('status', 'claimed')->count();

        $breakdown = (clone $orders)
            ->join('merchandise', 'merchandise.id', '=', 'orders.merchandise_id')
            ->selectRaw('merchandise.id, merchandise.name, SUM(orders.quantity) as quantity, COUNT(orders.id) as orders_count, SUM(CASE WHEN orders.status IN (?, ?) THEN orders.total_price ELSE 0 END) as collected', ['paid', 'claimed'])
            ->groupBy('merchandise.id', 'merchandise.name')
            ->orderByDesc('quantity')
            ->get();

        return [
            'total_users' => $totalUsers,
            'purchased_users' => $purchasedUsers,
            'not_purchased_users' => max(0, $totalUsers - $purchasedUsers),
            'purchase_rate' => $totalUsers > 0 ? round(($purchasedUsers / $totalUsers) * 100, 2) : 0,
            'total_orders' => $totalOrders,
            'paid_orders' => $paidOrders,
            'pending_orders' => (clone $orders)->where('status', 'pending')->count(),
            'claimed_orders' => $claimedOrders,
            'unclaimed_orders' => (clone $orders)->where('status', 'paid')->count(),
            'cancelled_orders' => (clone $orders)->where('status', 'cancelled')->count(),
            'total_quantity' => (int) (clone $orders)->sum('quantity'),
            'total_collected' => (float) (clone $orders)->whereIn('status', ['paid', 'claimed'])->sum('total_price'),
            'outstanding_balance' => (float) (clone $orders)->where('status', 'pending')->sum('total_price'),
            'breakdown' => $breakdown,
        ];
    }

    private function orderFilterOptions(Request $request): array
    {
        $organizationId = $request->user()->organization_id;
        $organization = $request->user()->organization;

        return [
            'departments' => array_values(array_filter([$organization?->college ?: 'College of Computer Studies'])),
            'programs' => AcademicProgram::where('organization_id', $organizationId)->with('sections')->orderBy('name')->get(),
            'majors' => User::where('organization_id', $organizationId)->whereNotNull('major')->where('major', '!=', '')->distinct()->orderBy('major')->pluck('major'),
            'roles' => ['STUDENT', 'SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD'],
            'positions' => SboPosition::where('organization_id', $organizationId)->where('is_active', true)->orderBy('title')->pluck('title'),
            'merchandise' => Merchandise::where('organization_id', $organizationId)->orderBy('name')->get(['id', 'name', 'category', 'price']),
            'statuses' => ['pending', 'paid', 'claimed', 'cancelled'],
            'payment_statuses' => ['pending', 'paid', 'cancelled'],
            'payment_methods' => ['cash', 'gcash', 'other'],
        ];
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
                if ($pendingApproval && $request->user()->role !== 'ADMIN') {
                    return response()->json(['message' => 'Review this payment from the Approvals module.'], 422);
                }
                $order = DB::transaction(function () use ($order, $request, $data) {
                    $rejected = $this->fulfillmentService->rejectPayment($order, $request->user(), $data['review_remarks']);
                    if ($request->user()->role === 'ADMIN') {
                        $this->resolvePaymentApproval($rejected, $request, 'rejected', $data['review_remarks']);
                    }

                    return $rejected;
                });
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
                $order = DB::transaction(function () use ($order, $request) {
                    $bypassOfficerReview = $order->officer_review_status !== 'approved';
                    $approved = $this->fulfillmentService->approvePayment($order, $request->user(), $bypassOfficerReview);
                    $this->resolvePaymentApproval($approved, $request, 'approved', $bypassOfficerReview ? 'Approved directly from order management.' : null);

                    return $approved;
                });
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

    private function resolvePaymentApproval(Order $order, Request $request, string $status, ?string $remarks): void
    {
        $approvals = ApprovalRequest::where('organization_id', $order->organization_id)
            ->where('entity_type', 'payment')
            ->where('entity_id', $order->id)
            ->where('status', 'pending')
            ->lockForUpdate()
            ->get();

        foreach ($approvals as $approval) {
            $approval->update([
                'status' => $status,
                'active_key' => null,
                'remarks' => $remarks,
                'reviewed_by' => $request->user()->school_id,
                'reviewed_at' => now(),
            ]);

            AuditLog::create([
                'organization_id' => $order->organization_id,
                'user_id' => $request->user()->school_id,
                'module' => 'approvals',
                'action' => 'payment_'.$status.'_from_order_management',
                'record_type' => ApprovalRequest::class,
                'record_id' => $approval->id,
                'new_values' => ['entity_type' => 'payment', 'entity_id' => $order->id, 'status' => $status, 'remarks' => $remarks],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
        }
    }

    public function auditHistory(Request $request, $id)
    {
        $order = Order::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        return response()->json(AuditLog::with('user:school_id,first_name,last_name,role,position_title')
            ->where('organization_id', $order->organization_id)->where('record_type', Order::class)->where('record_id', $order->id)->latest('created_at')->get());
    }

    public function paymentProof(Request $request, $id)
    {
        $order = Order::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $user = $request->user();
        abort_unless(
            in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true) || $order->student_id === $user->school_id,
            403
        );

        $storedPath = $order->payment_proof_url;
        if (! $storedPath) {
            return response()->json(['message' => 'Payment proof not found.'], 404);
        }

        if (preg_match('#^payment-proofs/[0-9a-f-]+\.(?:jpe?g|png|webp)$#i', $storedPath)) {
            $disk = Storage::disk('local');
            if (! $disk->exists($storedPath)) {
                return response()->json(['message' => 'Payment proof not found.'], 404);
            }
            $path = $disk->path($storedPath);
        } elseif (preg_match('#^/uploads/payments/[0-9a-f-]+\.(?:jpe?g|png|webp)$#i', $storedPath)) {
            // Existing installations can read legacy proofs only through this
            // authorization gate while files transition from public storage.
            $path = public_path(ltrim($storedPath, '/'));
            if (! is_file($path)) {
                return response()->json(['message' => 'Payment proof not found.'], 404);
            }
        } else {
            return response()->json(['message' => 'Payment proof not found.'], 404);
        }

        $response = response()->file($path, [
            'Content-Disposition' => 'inline; filename="payment-proof-'.intval($order->id).'.'.pathinfo($path, PATHINFO_EXTENSION).'"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
        $response->setPrivate();
        $response->setMaxAge(0);
        $response->headers->addCacheControlDirective('no-store');

        return $response;
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
        $path = $file->storeAs('payment-proofs', $filename, 'local');

        if (! $path) {
            throw new \RuntimeException('Unable to store payment proof.');
        }

        return $path;
    }

    private function deletePaymentProof(?string $paymentProofUrl): void
    {
        if (! $paymentProofUrl) {
            return;
        }

        if (str_starts_with($paymentProofUrl, 'payment-proofs/')) {
            Storage::disk('local')->delete($paymentProofUrl);
        } elseif (str_starts_with($paymentProofUrl, '/uploads/payments/')) {
            $path = public_path(ltrim($paymentProofUrl, '/'));
            if (is_file($path)) {
                @unlink($path);
            }
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
