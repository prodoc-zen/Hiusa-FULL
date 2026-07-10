<?php

namespace Database\Seeders;

use App\Models\Event;
use App\Models\User;
use Illuminate\Database\Seeder;

class EventSeeder extends Seeder
{
    public function run(): void
    {
        $officer1 = User::where('school_id', 900001)->first();

        $events = [
            [
                'title'       => 'HIUSA General Assembly',
                'description' => 'Mandatory general assembly for all HIUSA members. Agenda includes election results, budget presentation, and Q&A session.',
                'start_time'  => now()->subWeeks(2)->setTime(14, 0),
                'end_time'    => now()->subWeeks(2)->setTime(17, 0),
                'location'    => 'Audio-Visual Room, 3rd Floor Main Building',
                'status'      => 'completed',
                'created_by'  => $officer1->id,
            ],
            [
                'title'       => 'Leadership Seminar 2024',
                'description' => 'Two-day leadership and governance seminar for all HIUSA officers. Topics include project management, conflict resolution, and financial accountability.',
                'start_time'  => now()->subDay()->setTime(8, 0),
                'end_time'    => now()->addDay()->setTime(17, 0),
                'location'    => 'Hotel Veneto, Iloilo City',
                'status'      => 'ongoing',
                'created_by'  => $officer1->id,
            ],
            [
                'title'       => 'Sports Fest 2024',
                'description' => 'Annual HIUSA Sports Fest featuring basketball, volleyball, and badminton tournaments. Open to all registered HIUSA members.',
                'start_time'  => now()->addWeeks(2)->setTime(7, 0),
                'end_time'    => now()->addWeeks(2)->addDay()->setTime(18, 0),
                'location'    => 'University Gymnasium',
                'status'      => 'approved',
                'created_by'  => $officer1->id,
            ],
            [
                'title'       => 'Induction and Recognition Ceremony',
                'description' => 'Formal induction of newly elected HIUSA officers and recognition of outstanding members for the academic year 2024–2025.',
                'start_time'  => now()->addMonth()->setTime(17, 0),
                'end_time'    => now()->addMonth()->setTime(21, 0),
                'location'    => 'University Convention Center',
                'status'      => 'approved',
                'created_by'  => $officer1->id,
            ],
        ];

        foreach ($events as $e) {
            Event::create($e);
        }
    }
}
