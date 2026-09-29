<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Order;
use App\Models\Task;
use App\Models\Transaction;
use Illuminate\Http\Request;

class AdminDashboardController extends Controller
{
    public function index(Request $request)
    {
        $data = $request->validate(['months' => ['nullable', 'integer', 'in:3,6,12']]);
        $organizationId = $request->user()->organization_id;
        $months = (int) ($data['months'] ?? 6);
        $start = now()->startOfMonth()->subMonths($months - 1);
        $movement = array_fill_keys(
            collect(range($months - 1, 0))->map(fn ($offset) => now()->startOfMonth()->subMonths($offset)->format('Y-m'))->all(),
            ['income' => 0, 'expense' => 0]
        );

        Transaction::where('organization_id', $organizationId)
            ->where('transaction_date', '>=', $start)
            ->whereIn('type', ['income', 'expense'])
            ->get(['transaction_date', 'type', 'amount'])
            ->each(function ($transaction) use (&$movement) {
                $month = $transaction->transaction_date->format('Y-m');
                if (isset($movement[$month])) {
                    $movement[$month][$transaction->type] += (float) $transaction->amount;
                }
            });

        $announcements = Announcement::where(function ($query) use ($organizationId, $request) {
            $query->where('organization_id', $organizationId)
                ->orWhere(function ($sao) use ($request) {
                    $sao->where('announcement_source', 'SAO')
                        ->whereHas('recipients', fn ($recipients) => $recipients->where('user_id', $request->user()->school_id));
                });
        })
            ->where('is_published', true)
            ->where('approval_status', 'approved')
            ->where(fn ($query) => $query->whereNull('scheduled_at')->orWhere('scheduled_at', '<=', now()))
            ->where(fn ($query) => $query->whereNull('expires_at')->orWhere('expires_at', '>', now()));

        return response()->json([
            'organization_name' => $request->user()->organization?->name,
            'counts' => [
                'pending_orders' => Order::where('organization_id', $organizationId)->where('status', 'pending')->count(),
                'approval_requests' => ApprovalRequest::where('organization_id', $organizationId)
                    ->where('required_role', 'ADMIN')->where('status', 'pending')
                    ->where(fn ($query) => $query->whereNull('assigned_approver')->orWhere('assigned_approver', $request->user()->school_id))->count(),
                'pending_tasks' => Task::where('organization_id', $organizationId)->where('status', 'pending')->count(),
                'new_announcements' => (clone $announcements)->where('published_at', '>=', now()->subDays(7))->count(),
            ],
            'movement' => collect($movement)->map(fn ($amounts, $month) => ['month' => $month, ...$amounts])->values(),
            'announcements' => $announcements->with(['creator:school_id,first_name,last_name', 'sourceOrganization:id,name,acronym'])
                ->orderByDesc('published_at')->limit(2)->get(['id', 'organization_id', 'source_organization_id', 'created_by', 'title', 'body', 'image_url', 'published_at']),
        ]);
    }
}
