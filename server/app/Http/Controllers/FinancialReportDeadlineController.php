<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\FinancialReportDeadline;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The date the SAO asks every organization to send its financial report by. The dashboard briefing and Ask AI read the
 * latest row, and a report counts as sent for it once it carries that row's id, so a new round starts a new row and
 * changing the date of the current round updates the row in place.
 */
class FinancialReportDeadlineController extends Controller
{
    public function show()
    {
        return response()->json(['data' => $this->payload(FinancialReportDeadline::orderByDesc('id')->first())]);
    }

    public function update(Request $request)
    {
        $data = $request->validate([
            'deadline_at' => ['required', 'date', 'after_or_equal:today'],
            'new_round' => ['nullable', 'boolean'],
        ], ['deadline_at.after_or_equal' => 'Choose today or a later date.']);

        $deadlineAt = Carbon::parse($data['deadline_at'])->endOfDay();

        $deadline = DB::transaction(function () use ($request, $data, $deadlineAt) {
            $current = FinancialReportDeadline::orderByDesc('id')->lockForUpdate()->first();
            $startNew = ! $current || (bool) ($data['new_round'] ?? false);
            $before = $startNew ? null : ['deadline_at' => $current->deadline_at->toDateString()];

            $deadline = $startNew
                ? FinancialReportDeadline::create(['deadline_at' => $deadlineAt, 'set_by' => $request->user()->school_id])
                : tap($current)->update(['deadline_at' => $deadlineAt, 'set_by' => $request->user()->school_id]);

            AuditLog::create([
                'organization_id' => $request->user()->organization_id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'financial_reports',
                'action' => $startNew ? 'deadline_set' : 'deadline_changed',
                'description' => ($startNew ? 'Set the financial report due date to ' : 'Changed the financial report due date to ').$deadlineAt->format('M j, Y').'.',
                'record_type' => FinancialReportDeadline::class,
                'record_id' => $deadline->id,
                'old_values' => $before,
                'new_values' => ['deadline_at' => $deadlineAt->toDateString(), 'new_round' => $startNew],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return $deadline;
        });

        return response()->json(['data' => $this->payload($deadline)]);
    }

    private function payload(?FinancialReportDeadline $deadline): ?array
    {
        return $deadline ? ['id' => $deadline->id, 'deadline_at' => $deadline->deadline_at->toDateString()] : null;
    }
}
