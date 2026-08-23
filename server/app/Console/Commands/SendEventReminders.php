<?php

namespace App\Console\Commands;

use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class SendEventReminders extends Command
{
    protected $signature = 'events:send-reminders';

    protected $description = 'Notify active organization members about approved events starting within 24 hours';

    public function handle(): int
    {
        $created = 0;
        $events = Event::where('status', 'approved')
            ->whereNotNull('approved_at')
            ->whereBetween('start_time', [now(), now()->addDay()])
            ->get();

        foreach ($events as $event) {
            $title = 'Event Reminder: '.Str::limit($event->title, 230);
            $recipientIds = User::where('organization_id', $event->organization_id)
                ->where('account_status', 'active')
                ->pluck('school_id');

            foreach ($recipientIds as $userId) {
                $notification = Notification::firstOrCreate(
                    [
                        'organization_id' => $event->organization_id,
                        'user_id' => $userId,
                        'title' => $title,
                        'reference_type' => Event::class,
                        'reference_id' => $event->id,
                    ],
                    [
                        'message' => $event->title.' starts '.$event->start_time->format('M j, Y g:i A').' at '.($event->location ?: 'the announced venue').'.',
                        'notification_type' => 'event',
                        'is_read' => false,
                        'sent_at' => now(),
                    ],
                );

                if ($notification->wasRecentlyCreated) {
                    $created++;
                }
            }
        }

        $this->info("Created {$created} event reminder notification(s).");

        return Command::SUCCESS;
    }
}
