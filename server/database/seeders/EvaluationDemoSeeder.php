<?php

namespace Database\Seeders;

use App\Models\EvaluationResponse;
use App\Models\EvaluationWindow;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

// Local demonstration data only. Never called from DatabaseSeeder: the
// capstone paper reports zero (0) real respondents so far, and no fake
// responses may ever be presented as study data. Every record this seeder
// creates is clearly labeled "DEMO" so it cannot be mistaken for a real
// submission. Run by hand: php artisan db:seed --class=EvaluationDemoSeeder
class EvaluationDemoSeeder extends Seeder
{
    private const DEMO_WINDOW_TITLE = 'DEMO - Sample Evaluation Window (Local Demonstration Only)';

    public function run(): void
    {
        $existing = EvaluationWindow::where('title', self::DEMO_WINDOW_TITLE)->first();
        if ($existing) {
            EvaluationResponse::where('evaluation_window_id', $existing->id)->delete();
            $existing->delete();
        }

        $organization = Organization::firstOrCreate(
            ['acronym' => 'HIUSA-DEMO'],
            [
                'name' => 'HIUSA Evaluation Demo Organization',
                'slug' => 'hiusa-evaluation-demo',
                'college' => 'Demo College (Local Demonstration Only)',
                'is_active' => true,
            ]
        );

        $admin = $this->demoUser($organization->id, 950000001, 'ADMIN', 'Demo', 'Admin', 'President');

        $window = EvaluationWindow::create([
            'title' => self::DEMO_WINDOW_TITLE,
            'description' => 'Synthetic responses for local demonstration only. Not real respondent data - the capstone paper reports zero (0) actual respondents as of this submission.',
            'opens_at' => now()->subMonth(),
            'closes_at' => now()->subWeek(),
            'status' => 'closed',
            'created_by' => $admin->school_id,
        ]);

        $students = [
            [950000101, 'Demo', 'Student One'],
            [950000102, 'Demo', 'Student Two'],
            [950000103, 'Demo', 'Student Three'],
            [950000104, 'Demo', 'Student Four'],
            [950000105, 'Demo', 'Student Five'],
        ];
        foreach ($students as [$schoolId, $first, $last]) {
            $this->demoResponse($window, $organization->id, $this->demoUser($organization->id, $schoolId, 'STUDENT', $first, $last), 'student');
        }

        $officers = [
            [950000201, 'Demo', 'Officer One', 'Secretary'],
            [950000202, 'Demo', 'Officer Two', 'Treasurer'],
            [950000203, 'Demo', 'Officer Three', 'Auditor'],
        ];
        foreach ($officers as [$schoolId, $first, $last, $position]) {
            $this->demoResponse($window, $organization->id, $this->demoUser($organization->id, $schoolId, 'SBO_OFFICER', $first, $last, $position), 'officer');
        }

        $this->demoResponse($window, $organization->id, $admin, 'officer');

        $departmentHead = $this->demoUser($organization->id, 950000301, 'DEPARTMENT_HEAD', 'Demo', 'Adviser');
        $this->demoResponse($window, $organization->id, $departmentHead, 'adviser');
    }

    private function demoUser(int $organizationId, int $schoolId, string $role, string $firstName, string $lastName, ?string $positionTitle = null): User
    {
        return User::updateOrCreate(
            ['school_id' => $schoolId],
            [
                'organization_id' => $organizationId,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'email' => 'demo.'.strtolower($lastName).'.'.$schoolId.'@hiusa.demo',
                'password_hash' => Hash::make('demo-password-not-for-production'),
                'role' => $role,
                'account_status' => 'active',
                'position_title' => $positionTitle,
                'is_member' => true,
            ]
        );
    }

    private function demoResponse(EvaluationWindow $window, int $organizationId, User $user, string $respondentType): void
    {
        $items = config("evaluation.instruments.{$respondentType}.items");
        $profile = [];
        $answers = [];

        foreach ($items as $item) {
            $value = match ($item['type']) {
                'likert' => fake()->randomElement([3, 4, 4, 4, 5, 5]),
                'single_choice' => $item['options'][array_rand($item['options'])]['value'],
                'multi_choice' => [$item['options'][array_rand($item['options'])]['value']],
                'text' => '[DEMO] Sample response for local demonstration only.',
                default => null,
            };

            if ($item['section'] === 'A') {
                $profile[$item['code']] = $value;
            } elseif ($item['section'] !== 'F') {
                $answers[$item['code']] = $value;
            }
        }

        EvaluationResponse::updateOrCreate(
            ['evaluation_window_id' => $window->id, 'user_id' => $user->school_id],
            [
                'organization_id' => $organizationId,
                'respondent_type' => $respondentType,
                'consent_given_at' => now()->subWeeks(2),
                'profile' => $profile,
                'answers' => $answers,
                'feedback' => '[DEMO] Sample open-ended feedback for local demonstration only.',
                'submitted_at' => now()->subWeeks(2),
            ]
        );
    }
}
