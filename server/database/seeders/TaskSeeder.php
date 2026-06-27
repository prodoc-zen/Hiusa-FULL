<?php

namespace Database\Seeders;

use App\Models\Event;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Seeder;

class TaskSeeder extends Seeder
{
    public function run(): void
    {
        $officer1 = User::where('school_id', 'OFF-2024-001')->first();
        $officer2 = User::where('school_id', 'OFF-2024-002')->first();
        $assembly = Event::where('title', 'HIUSA General Assembly')->first();
        $sportsFest = Event::where('title', 'Sports Fest 2024')->first();

        $tasks = [
            [
                'title'       => 'Prepare event venue layout for General Assembly',
                'description' => 'Arrange chairs, set up projector and sound system, print attendance sheets.',
                'status'      => 'completed',
                'deadline'    => now()->subWeeks(2)->subDay(),
                'assigned_to' => $officer2->id,
                'created_by'  => $officer1->id,
                'event_id'    => $assembly?->id,
            ],
            [
                'title'       => 'Book catering for General Assembly',
                'description' => 'Source and confirm snack catering for approximately 80 attendees.',
                'status'      => 'completed',
                'deadline'    => now()->subWeeks(2)->subDays(3),
                'assigned_to' => $officer1->id,
                'created_by'  => $officer1->id,
                'event_id'    => $assembly?->id,
            ],
            [
                'title'       => 'Design and print election campaign posters',
                'description' => 'Coordinate with candidates for photos and platform summaries. Print 20 copies per candidate.',
                'status'      => 'in_progress',
                'deadline'    => now()->addDay(),
                'assigned_to' => $officer2->id,
                'created_by'  => $officer1->id,
                'event_id'    => null,
            ],
            [
                'title'       => 'Collect and record second semester org fee payments',
                'description' => 'Accept payments from students, issue official receipts, update payment records in system.',
                'status'      => 'in_progress',
                'deadline'    => now()->addWeek(),
                'assigned_to' => $officer1->id,
                'created_by'  => $officer1->id,
                'event_id'    => null,
            ],
            [
                'title'       => 'Draft semester-end financial report',
                'description' => 'Compile all transaction records, prepare income vs expense summary, get adviser signature.',
                'status'      => 'pending',
                'deadline'    => now()->addWeeks(2),
                'assigned_to' => $officer1->id,
                'created_by'  => $officer1->id,
                'event_id'    => null,
            ],
            [
                'title'       => 'Source merchandise suppliers for Sports Fest',
                'description' => 'Get at least 3 quotations for HIUSA shirts, lanyards, and tote bags. Present to president by deadline.',
                'status'      => 'pending',
                'deadline'    => now()->addWeeks(3),
                'assigned_to' => $officer2->id,
                'created_by'  => $officer1->id,
                'event_id'    => $sportsFest?->id,
            ],
            [
                'title'       => 'Update official member roster for 2024–2025',
                'description' => 'Cross-check paid members list with registration records. Remove inactive members from the roster.',
                'status'      => 'overdue',
                'deadline'    => now()->subDays(5),
                'assigned_to' => $officer2->id,
                'created_by'  => $officer1->id,
                'event_id'    => null,
            ],
            [
                'title'       => 'Follow up unpaid organizational fee list',
                'description' => 'Send reminders to students with outstanding org fees. Coordinate with class representatives.',
                'status'      => 'overdue',
                'deadline'    => now()->subWeek(),
                'assigned_to' => $officer1->id,
                'created_by'  => $officer1->id,
                'event_id'    => null,
            ],
        ];

        foreach ($tasks as $t) {
            Task::create($t);
        }
    }
}
