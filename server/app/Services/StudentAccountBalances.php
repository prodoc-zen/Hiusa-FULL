<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * What each student owes an organization: open invoices less their approved
 * payments, plus pending merchandise orders that no invoice or transaction
 * covers yet. The Student Financial Accounts endpoint and the dashboard
 * briefing both read it from here so the two can never disagree.
 */
class StudentAccountBalances
{
    public function invoiceData(Invoice $i): array
    {
        $paid = (float) ($i->relationLoaded('payments')
            ? $i->payments->where('status', 'approved')->sum('amount')
            : $i->payments()->where('status', 'approved')->sum('amount'));
        $remaining = $i->isVoided() ? 0.0 : (float) $i->amount_due - $paid;

        return [...$i->toArray(), 'amount_paid' => round($paid, 2), 'remaining_balance' => round($remaining, 2), 'clearance_status' => $remaining < 0.005 ? 'financially_cleared' : 'pending_clearance'];
    }

    public function rows(Collection $students, int $organizationId): Collection
    {
        $studentIds = $students->pluck('school_id');
        $invoices = Invoice::with('payments')->where('organization_id', $organizationId)->whereIn('student_id', $studentIds)
            ->whereNotIn('status', ['paid', 'cancelled', 'waived'])->get()->groupBy('student_id');
        $orders = Order::with('merchandise:id,name,image_url')->where('organization_id', $organizationId)->whereIn('student_id', $studentIds)
            ->where('status', 'pending')->whereDoesntHave('transaction')->whereDoesntHave('billingInvoice')->get()->groupBy('student_id');

        return $students->map(function (User $student) use ($invoices, $orders) {
            $studentInvoices = $invoices->get($student->school_id, collect())->map(fn (Invoice $invoice) => $this->invoiceData($invoice))->values();
            $studentOrders = $orders->get($student->school_id, collect())->values();
            $invoiceDebt = (float) $studentInvoices->sum('remaining_balance');
            $orderDebt = (float) $studentOrders->sum('total_price');
            $overdueCount = $studentInvoices->filter(fn (array $invoice) => ! empty($invoice['due_date']) && $invoice['remaining_balance'] > 0 && now()->startOfDay()->gt($invoice['due_date']))->count();
            $pendingPayments = $studentOrders->whereNotNull('payment_proof_url')->count() + $studentInvoices->where('status', 'partially_paid')->count();
            $activityDates = $studentInvoices->pluck('updated_at')->merge($studentOrders->pluck('updated_at'))->filter();

            return [
                'student' => ['school_id' => $student->school_id, 'name' => trim($student->first_name.' '.$student->last_name), 'email' => $student->email, 'account_status' => $student->account_status, 'department' => $student->department, 'program' => $student->program, 'major' => $student->major, 'section' => $student->section, 'year_level' => $student->year_level],
                'invoice_debt' => round($invoiceDebt, 2), 'reserved_order_debt' => round($orderDebt, 2), 'total_debt' => round($invoiceDebt + $orderDebt, 2),
                'clearance_status' => ($invoiceDebt + $orderDebt) < 0.005 ? 'financially_cleared' : 'pending_clearance', 'unpaid_invoice_count' => $studentInvoices->count(),
                'pending_order_count' => $studentOrders->count(), 'pending_payment_count' => $pendingPayments, 'overdue_invoice_count' => $overdueCount,
                'last_activity_at' => $activityDates->sortDesc()->first(), 'invoices' => $studentInvoices, 'reserved_orders' => $studentOrders,
            ];
        });
    }
}
