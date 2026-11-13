<?php

namespace App\Console\Commands;

use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\OfficerAppointment;
use App\Models\OrganizationComplianceSubmission;
use App\Support\RenewalDeadline;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class SendRenewalReminders extends Command
{
    protected $signature = 'officers:renewal-reminders';

    protected $description = 'Notify officers with an active or upcoming appointment about renewal requirements due in 7 days that their organization has not submitted';

    public function handle(): int
    {
        $created = 0;
        $target = now()->addDays(7)->toDateString();
        $types = RenewalDeadline::types(0)->filter(fn (ComplianceRequirementType $type) => $type->deadline_at?->toDateString() === $target);

        foreach ($types as $type) {
            $title = 'Renewal due in 7 days: '.Str::limit($type->name, 220);
            $done = OrganizationComplianceSubmission::where('requirement_type_id', $type->id)
                ->whereIn('status', ['submitted', 'approved'])
                ->pluck('organization_id');

            $appointments = OfficerAppointment::query()
                ->whereIn('status', ['active', 'upcoming'])
                ->whereNotIn('organization_id', $done)
                ->get(['organization_id', 'user_school_id'])
                ->unique(fn (OfficerAppointment $appointment) => $appointment->user_school_id);

            foreach ($appointments as $appointment) {
                $alreadyToday = Notification::where('user_id', $appointment->user_school_id)
                    ->where('reference_type', 'compliance_requirement_type')
                    ->where('reference_id', $type->id)
                    ->where('title', $title)
                    ->whereDate('sent_at', today())
                    ->exists();

                if ($alreadyToday) {
                    continue;
                }

                Notification::create([
                    'organization_id' => $appointment->organization_id,
                    'user_id' => $appointment->user_school_id,
                    'title' => $title,
                    'message' => $type->name.' is due on '.$type->deadline_at->format('M j, Y g:i A').' and your organization has not submitted it yet.',
                    'notification_type' => 'general',
                    'reference_type' => 'compliance_requirement_type',
                    'reference_id' => $type->id,
                    'is_read' => false,
                    'sent_at' => now(),
                ]);
                $created++;
            }
        }

        $this->info("Created {$created} renewal reminder notification(s).");

        return Command::SUCCESS;
    }
}
