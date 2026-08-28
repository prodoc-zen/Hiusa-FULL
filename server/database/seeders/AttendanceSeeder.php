<?php

namespace Database\Seeders;

use App\Models\Attendance;
use App\Models\Event;
use App\Models\User;
use Illuminate\Database\Seeder;

class AttendanceSeeder extends Seeder
{
    public function run(): void
    {
        $officer1 = User::where('school_id', 900001)->first();
        $assembly = Event::where('title', 'HIUSA General Assembly')->first();

        if (! $assembly) {
            return;
        }

        $records = [
            ['school_id' => 2100142, 'status' => 'present', 'minutes_after_start' => -10],
            ['school_id' => 2100217, 'status' => 'present', 'minutes_after_start' => -5],
            ['school_id' => 2200134, 'status' => 'present', 'minutes_after_start' => 0],
            ['school_id' => 2200298, 'status' => 'present', 'minutes_after_start' => 2],
            ['school_id' => 2300078, 'status' => 'present', 'minutes_after_start' => 5],
            ['school_id' => 2300163, 'status' => 'present', 'minutes_after_start' => 8],
            ['school_id' => 2200451, 'status' => 'late', 'minutes_after_start' => 35],
            ['school_id' => 2300247, 'status' => 'late', 'minutes_after_start' => 42],
            ['school_id' => 2300312, 'status' => 'excused', 'minutes_after_start' => 0, 'remarks' => 'Excused - medical appointment, cleared by adviser.'],
        ];

        foreach ($records as $record) {
            Attendance::create([
                'event_id' => $assembly->id,
                'user_id' => $record['school_id'],
                'method' => 'manual',
                'status' => $record['status'],
                'check_in_time' => $assembly->start_time->copy()->addMinutes($record['minutes_after_start']),
                'recorded_by' => $officer1->school_id,
                'remarks' => $record['remarks'] ?? null,
            ]);
        }
    }
}
