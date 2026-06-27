<?php

namespace Database\Seeders;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Partylist;
use App\Models\User;
use Illuminate\Database\Seeder;

class ElectionSeeder extends Seeder
{
    public function run(): void
    {
        $election = Election::create([
            'title'      => 'HIUSA Student Council Election 2024–2025',
            'start_time' => now()->subDay(),
            'end_time'   => now()->addDays(7),
            'status'     => 'active',
        ]);

        $president = ElectionPosition::create([
            'election_id' => $election->id,
            'title'       => 'President',
            'max_winners' => 1,
        ]);

        $vicePresident = ElectionPosition::create([
            'election_id' => $election->id,
            'title'       => 'Vice President',
            'max_winners' => 1,
        ]);

        $unity = Partylist::create([
            'name'        => 'Unity Party',
            'acronym'     => 'UP',
            'description' => 'Committed to inclusive governance, transparency, and student welfare.',
        ]);

        $progress = Partylist::create([
            'name'        => 'Progress Alliance',
            'acronym'     => 'PA',
            'description' => 'Focused on modernizing HIUSA operations and digital student services.',
        ]);

        $student1 = User::where('school_id', '2023-00001')->first();
        $student2 = User::where('school_id', '2023-00002')->first();
        $student3 = User::where('school_id', '2023-00003')->first();
        $student4 = User::where('school_id', '2023-00004')->first();

        Candidate::create([
            'election_id' => $election->id,
            'user_id'     => $student1->id,
            'position_id' => $president->id,
            'partylist_id'=> $unity->id,
            'platform'    => 'I will push for better student services, transparent finances, and stronger industry partnerships for HIUSA members.',
        ]);

        Candidate::create([
            'election_id' => $election->id,
            'user_id'     => $student2->id,
            'position_id' => $president->id,
            'partylist_id'=> $progress->id,
            'platform'    => 'My platform focuses on digitalizing HIUSA processes, reducing paperwork, and making governance accessible to every student.',
        ]);

        Candidate::create([
            'election_id' => $election->id,
            'user_id'     => $student3->id,
            'position_id' => $vicePresident->id,
            'partylist_id'=> $unity->id,
            'platform'    => 'I will support the president in event coordination, member welfare, and maintaining strong adviser relations.',
        ]);

        Candidate::create([
            'election_id' => $election->id,
            'user_id'     => $student4->id,
            'position_id' => $vicePresident->id,
            'partylist_id'=> $progress->id,
            'platform'    => 'As VP, I will champion new student initiatives, mentorship programs, and better communication between officers and students.',
        ]);
    }
}
