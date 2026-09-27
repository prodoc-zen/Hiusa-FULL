<?php

namespace App\Services;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Order;
use Illuminate\Support\Str;

class ApprovalEntityLabel
{
    public function for(ApprovalRequest $approval): string
    {
        $entity = match ($approval->entity_type) {
            'event' => Event::query(),
            'budget' => Budget::query(),
            'election' => Election::query(),
            'announcement' => Announcement::query(),
            'payment' => Order::with('merchandise:id,name'),
            'financial_report' => FinancialReport::query(),
            default => null,
        };

        $record = $entity?->where('organization_id', $approval->organization_id)->find($approval->entity_id);
        if (! $record) {
            return Str::headline($approval->entity_type).' #'.$approval->entity_id;
        }

        return match ($approval->entity_type) {
            'payment' => 'Order ORD-'.$record->id.($record->merchandise?->name ? ' for '.$record->merchandise->name : ''),
            default => (string) ($record->title ?? $record->name ?? Str::headline($approval->entity_type).' #'.$approval->entity_id),
        };
    }
}
