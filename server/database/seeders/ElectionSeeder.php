<?php

namespace Database\Seeders;

use App\Models\ApprovalRequest;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Partylist;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class ElectionSeeder extends Seeder
{
    public function run(): void
    {
        $officer1 = User::where('school_id', 900001)->first();

        $election = Election::create([
            'title' => 'HIUSA Student Council Election 2024-2025',
            'start_time' => now()->subDay(),
            'end_time' => now()->addDays(7),
            'status' => 'active',
            'organization_id' => $officer1->organization_id,
        ]);

        $president = ElectionPosition::create([
            'election_id' => $election->id,
            'title' => 'President',
            'max_winners' => 1,
        ]);

        $vicePresident = ElectionPosition::create([
            'election_id' => $election->id,
            'title' => 'Vice President',
            'max_winners' => 1,
        ]);

        $unity = Partylist::create([
            'name' => 'Unity Party',
            'acronym' => 'UP',
            'description' => 'Committed to inclusive governance, transparency, and student welfare.',
        ]);

        $progress = Partylist::create([
            'name' => 'Progress Alliance',
            'acronym' => 'PA',
            'description' => 'Focused on modernizing HIUSA operations and digital student services.',
        ]);

        $students = User::query()
            ->where('role', 'STUDENT')
            ->orderBy('school_id')
            ->take(4)
            ->get();

        if ($students->count() < 4) {
            throw new \RuntimeException('ElectionSeeder requires at least 4 student users. Seed UserSeeder first.');
        }

        [$student1, $student2, $student3, $student4] = $students->values()->all();

        $presidentUnity = Candidate::create([
            'election_id' => $election->id,
            'user_id' => $student1->id,
            'position_id' => $president->id,
            'partylist_id' => $unity->id,
            'platform' => 'I will push for better student services, transparent finances, and stronger industry partnerships for HIUSA members.',
        ]);

        $presidentProgress = Candidate::create([
            'election_id' => $election->id,
            'user_id' => $student2->id,
            'position_id' => $president->id,
            'partylist_id' => $progress->id,
            'platform' => 'My platform focuses on digitalizing HIUSA processes, reducing paperwork, and making governance accessible to every student.',
        ]);

        $vpUnity = Candidate::create([
            'election_id' => $election->id,
            'user_id' => $student3->id,
            'position_id' => $vicePresident->id,
            'partylist_id' => $unity->id,
            'platform' => 'I will support the president in event coordination, member welfare, and maintaining strong adviser relations.',
        ]);

        $vpProgress = Candidate::create([
            'election_id' => $election->id,
            'user_id' => $student4->id,
            'position_id' => $vicePresident->id,
            'partylist_id' => $progress->id,
            'platform' => 'As VP, I will champion new student initiatives, mentorship programs, and better communication between officers and students.',
        ]);

        // Approve the election through the same shape a real Department Head
        // review produces, so the gate in ElectionController::update() (requires
        // approved_at before an election can be opened/closed) is satisfied.
        // withoutEvents() suppresses ApprovalRequest::booted()'s notifyApprovers()
        // and recordSubmissionAudit(), which would otherwise fan out bogus
        // notifications/audit rows during seeding.
        $deptHead = User::where('organization_id', $officer1->organization_id)
            ->where('role', 'DEPARTMENT_HEAD')
            ->first();

        ApprovalRequest::withoutEvents(function () use ($election, $officer1, $deptHead) {
            ApprovalRequest::create([
                'organization_id' => $officer1->organization_id,
                'entity_type' => 'election',
                'entity_id' => $election->id,
                'requested_by' => $officer1->school_id,
                'required_role' => 'DEPARTMENT_HEAD',
                'status' => 'approved',
                'reviewed_by' => $deptHead?->school_id,
                'requested_at' => now()->subDays(3),
                'reviewed_at' => now()->subDays(2),
            ]);
        });

        $election->update(['approved_at' => now()->subDays(2)]);

        // Cast votes for every eligible student except the last one (Alyssa
        // Domingo, school_id 2400093), who is left deliberately unvoted so the
        // live demo can show a real cast-vote flow and, on a second attempt,
        // the "already voted" rejection.
        // Collection-level slice, not ->skip()/->offset() - MySQL rejects an
        // OFFSET clause with no LIMIT, which SQLite tolerates but MySQL does not.
        $voters = User::query()
            ->where('role', 'STUDENT')
            ->where('organization_id', $officer1->organization_id)
            ->orderBy('school_id')
            ->get()
            ->slice(4);

        $votingStudents = $voters->slice(0, -1)->values();

        foreach ($votingStudents as $index => $student) {
            $presidentPick = $index % 2 === 0 ? $presidentUnity : $presidentProgress;
            $vpPick = $index % 2 === 0 ? $vpUnity : $vpProgress;

            Vote::create([
                'election_id' => $election->id,
                'position_id' => $president->id,
                'candidate_id' => $presidentPick->id,
                'voter_id' => $student->school_id,
                'vote_hash' => strtoupper(Str::random(12)),
            ]);

            Vote::create([
                'election_id' => $election->id,
                'position_id' => $vicePresident->id,
                'candidate_id' => $vpPick->id,
                'voter_id' => $student->school_id,
                'vote_hash' => strtoupper(Str::random(12)),
            ]);
        }
    }
}
