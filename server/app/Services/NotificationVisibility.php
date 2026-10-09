<?php

namespace App\Services;

use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder;

/**
 * The notifications a person actually sees: their own, in their organization,
 * already due (not scheduled for later), not evaluation window reminders, and
 * not of a kind they muted. The bell and the dashboard briefing both count
 * through this so their unread numbers always agree.
 */
class NotificationVisibility
{
    public static function apply(Builder|EloquentBuilder $query, int $userId, int $organizationId, array $mutedTypes): Builder|EloquentBuilder
    {
        return $query->where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->where(function ($query) {
                $query->whereNull('reference_type')->orWhereNotIn('reference_type', [
                    'App\\Models\\EvaluationWindow', 'evaluation_window', 'evaluationwindow',
                ]);
            })
            ->when($mutedTypes !== [], fn ($query) => $query->whereNotIn('notification_type', $mutedTypes))
            ->where(function ($query) {
                $query->whereNull('scheduled_at')->orWhere('scheduled_at', '<=', now());
            });
    }
}
