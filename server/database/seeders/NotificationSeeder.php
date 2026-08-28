<?php

namespace Database\Seeders;

use App\Models\Notification;
use Illuminate\Database\Seeder;

class NotificationSeeder extends Seeder
{
    public function run(): void
    {
        $notifications = [
            [
                'user_id' => 900001, // Marco Dela Cruz, President
                'title' => 'New Merchandise Order',
                'message' => 'A new order for HIUSA T-Shirt (S/M) is awaiting payment verification.',
                'notification_type' => 'merchandise',
                'sent_at' => now()->subHours(3),
            ],
            [
                'user_id' => 900001,
                'title' => 'Budget Awaiting Your Follow-up',
                'message' => 'The Sports Fest 2024 Budget is still pending Department Head approval.',
                'notification_type' => 'general',
                'sent_at' => now()->subDay(),
            ],
            [
                'user_id' => 990001, // System Administrator
                'title' => 'Approval Request Submitted',
                'message' => 'The Induction and Recognition Ceremony event requires your review.',
                'notification_type' => 'general',
                'sent_at' => now()->subHours(6),
            ],
            [
                'user_id' => 2100142, // Juan Dela Vega
                'title' => 'HIUSA Student Council Election 2024-2025 Now Open',
                'message' => 'Voting is now open. Log in and cast your vote before the election closes.',
                'notification_type' => 'election',
                'sent_at' => now()->subDays(1),
            ],
            [
                'user_id' => 2200134, // Luis Ramos
                'title' => 'Attendance Recorded',
                'message' => 'Your attendance for HIUSA General Assembly was recorded as present.',
                'notification_type' => 'event',
                'sent_at' => now()->subWeeks(2),
            ],
        ];

        foreach ($notifications as $notification) {
            Notification::create([
                ...$notification,
                'is_read' => false,
            ]);
        }
    }
}
