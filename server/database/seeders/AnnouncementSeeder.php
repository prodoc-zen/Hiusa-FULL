<?php

namespace Database\Seeders;

use App\Models\Announcement;
use App\Models\User;
use Illuminate\Database\Seeder;

class AnnouncementSeeder extends Seeder
{
    public function run(): void
    {
        $officer1 = User::where('school_id', 'OFF-2024-001')->first();
        $officer2 = User::where('school_id', 'OFF-2024-002')->first();

        $announcements = [
            [
                'title'        => 'General Assembly — All Members Required',
                'body'         => 'All HIUSA members are required to attend the General Assembly on July 5, 2024 at 2:00 PM in the AVR. Attendance will be checked. Bring your student ID.',
                'created_by'   => $officer1->id,
                'target_role'  => 'all',
                'is_published' => true,
            ],
            [
                'title'        => 'Org Fee Collection — Deadline Extended',
                'body'         => 'The deadline for organizational fee payment has been extended to June 30. Please settle your ₱500 fee at the HIUSA office. Unpaid members will not receive benefits.',
                'created_by'   => $officer1->id,
                'target_role'  => 'student',
                'is_published' => true,
            ],
            [
                'title'        => 'HIUSA Student Council Election 2024–2025 Now Open',
                'body'         => 'Voting for the HIUSA Student Council Election is now open! Log in to your student portal and cast your vote before the election closes. Every vote counts.',
                'created_by'   => $officer2->id,
                'target_role'  => 'all',
                'is_published' => true,
            ],
            [
                'title'        => 'Sports Fest 2024 — Volunteer Officers Needed',
                'body'         => 'We are looking for volunteer officers to assist in the Sports Fest 2024. Duties include venue setup, registration, and logistics. Contact Angela Santos to sign up.',
                'created_by'   => $officer2->id,
                'target_role'  => 'officer',
                'is_published' => true,
            ],
            [
                'title'        => 'Uniform Policy Reminder',
                'body'         => 'A reminder to all members: proper HIUSA uniform must be worn during all official events. White polo for officers, black slacks for both genders. No exceptions during formal activities.',
                'created_by'   => $officer1->id,
                'target_role'  => 'all',
                'is_published' => true,
            ],
            [
                'title'        => 'Sports Fest 2024 — Program Draft',
                'body'         => 'Draft program for Sports Fest 2024. Pending review from adviser. Please do not share outside the officer group until approved.',
                'created_by'   => $officer2->id,
                'target_role'  => 'officer',
                'is_published' => false,
            ],
            [
                'title'        => 'Q3 Budget Report — Internal Draft',
                'body'         => 'Q3 financial summary for internal review. Total income: ₱48,500. Total expenses: ₱31,200. Net: ₱17,300. Pending adviser signature before publishing.',
                'created_by'   => $officer1->id,
                'target_role'  => 'adviser',
                'is_published' => false,
            ],
        ];

        foreach ($announcements as $a) {
            Announcement::create($a);
        }
    }
}
