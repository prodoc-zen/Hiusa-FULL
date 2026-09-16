<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use App\Models\AnnouncementRecipient;
use App\Models\AuditLog;
use App\Models\FinancialReportDeadline;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class FinancialReportDeadlineController extends Controller
{
    public function show()
    {
        return response()->json(FinancialReportDeadline::with([
            'setter:school_id,first_name,last_name',
            'announcement:id,title,published_at',
        ])->latest('id')->first());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'deadline_at' => ['required', 'date', 'after:now'],
            'instructions' => ['nullable', 'string', 'max:3000'],
        ]);

        $deadline = DB::transaction(function () use ($request, $data) {
            $sao = Organization::where('organization_type', 'SYSTEM_ADMINISTRATION')
                ->where('acronym', 'SAO')
                ->firstOrFail();
            $previous = FinancialReportDeadline::latest('id')->first();
            $label = $previous ? 'Updated Financial Report Submission Deadline' : 'Financial Report Submission Deadline';
            $formatted = Carbon::parse($data['deadline_at'])->timezone(config('app.timezone'))->format('F j, Y g:i A');
            $body = "The financial report submission deadline is {$formatted}.";
            if (! empty($data['instructions'])) {
                $body .= "\n\n".$data['instructions'];
            }

            $announcement = Announcement::create([
                'organization_id' => $sao->id,
                'source_organization_id' => $sao->id,
                'announcement_source' => 'SAO',
                'title' => $label,
                'body' => $body,
                'category' => 'general',
                'target_role' => 'all',
                'target_scope' => 'all_organizations',
                'target_roles' => ['ADMIN'],
                'approval_status' => 'approved',
                'is_published' => true,
                'is_important' => true,
                'created_by' => $request->user()->school_id,
                'reviewed_by' => $request->user()->school_id,
                'published_at' => now(),
            ]);

            $deadline = FinancialReportDeadline::create([
                ...$data,
                'set_by' => $request->user()->school_id,
                'announcement_id' => $announcement->id,
            ]);

            $admins = User::query()
                ->where('role', 'ADMIN')
                ->where('account_status', 'active')
                ->whereHas('organization', fn ($query) => $query->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION'))
                ->get(['school_id', 'organization_id']);
            $now = now();
            foreach ($admins->chunk(250) as $chunk) {
                AnnouncementRecipient::insert($chunk->map(fn ($admin) => [
                    'announcement_id' => $announcement->id,
                    'user_id' => $admin->school_id,
                    'organization_id' => $admin->organization_id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all());
                Notification::insert($chunk->map(fn ($admin) => [
                    'organization_id' => $admin->organization_id,
                    'user_id' => $admin->school_id,
                    'notification_type' => 'financial',
                    'title' => $label,
                    'message' => $body,
                    'reference_type' => 'financial_report_deadline',
                    'reference_id' => $deadline->id,
                    'is_read' => false,
                    'sent_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all());
            }

            AuditLog::create([
                'organization_id' => $sao->id,
                'user_id' => $request->user()->school_id,
                'actor_role' => 'SUPER_ADMIN',
                'module' => 'financial_reports',
                'action' => $previous ? 'deadline_updated' : 'deadline_set',
                'description' => 'SAO set the financial report submission deadline and notified organization administrators.',
                'record_type' => FinancialReportDeadline::class,
                'record_id' => $deadline->id,
                'new_values' => ['deadline_at' => $deadline->deadline_at, 'recipient_count' => $admins->count()],
                'ip_address' => $request->ip(),
                'created_at' => $now,
            ]);

            return $deadline;
        });

        return response()->json($deadline->load(['setter:school_id,first_name,last_name', 'announcement:id,title,published_at']), 201);
    }
}
