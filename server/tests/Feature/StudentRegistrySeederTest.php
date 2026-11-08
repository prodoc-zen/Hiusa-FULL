<?php

namespace Tests\Feature;

use App\Models\StudentRegistryEntry;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\StudentRegistrySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StudentRegistrySeederTest extends TestCase
{
    use RefreshDatabase;

    private function seedDemo(): void
    {
        $this->seed(DatabaseSeeder::class);
    }

    public function test_every_seeded_student_has_a_claimed_record_with_a_birth_date(): void
    {
        $this->seedDemo();

        $students = User::where('role', 'STUDENT')->pluck('school_id');
        $this->assertNotEmpty($students);
        foreach ($students as $schoolId) {
            $entry = StudentRegistryEntry::where('school_id', $schoolId)->first();
            $this->assertNotNull($entry, "No record for demo student {$schoolId}");
            $this->assertNotNull($entry->claimed_at);
            $this->assertNotNull($entry->birth_date);
        }
    }

    public function test_the_unclaimed_demo_rows_can_sign_up_and_match_the_demo_script(): void
    {
        $this->seedDemo();

        foreach (StudentRegistrySeeder::UNCLAIMED as $row) {
            $this->assertDatabaseHas('student_registry', ['school_id' => $row['school_id'], 'claimed_at' => null]);
            $this->assertStringContainsString((string) $row['school_id'], file_get_contents(base_path('../docs/DEMO_SCRIPT.md')));
            $this->assertStringContainsString($row['birth_date'], file_get_contents(base_path('../docs/DEMO_SCRIPT.md')));
        }

        $this->postJson('/api/register', [
            'school_id' => 2500101, 'birth_date' => '2007-03-14', 'email' => 'hannah.demo@example.edu',
            'password' => 'a-long-passphrase', 'password_confirmation' => 'a-long-passphrase',
        ])->assertCreated()->assertJsonPath('user.first_name', 'Hannah');

        $this->assertSame('CCS', User::findOrFail(2500101)->organization->acronym);
    }

    public function test_running_the_seeder_again_does_not_unclaim_or_duplicate_anything(): void
    {
        $this->seedDemo();
        $this->postJson('/api/register', [
            'school_id' => 2500101, 'birth_date' => '2007-03-14', 'email' => 'hannah.demo@example.edu',
            'password' => 'a-long-passphrase', 'password_confirmation' => 'a-long-passphrase',
        ])->assertCreated();
        $count = StudentRegistryEntry::count();

        $this->seed(StudentRegistrySeeder::class);

        $this->assertSame($count, StudentRegistryEntry::count());
        $this->assertNotNull(StudentRegistryEntry::where('school_id', 2500101)->value('claimed_at'));
    }
}
