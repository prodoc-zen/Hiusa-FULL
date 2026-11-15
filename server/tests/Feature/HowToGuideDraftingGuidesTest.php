<?php

namespace Tests\Feature;

use App\Services\Ai\HowToGuideLibrary;
use Tests\TestCase;

/** The how-to entries for the three drafting and checking features are found by plain questions and open only pages the role may open. */
class HowToGuideDraftingGuidesTest extends TestCase
{
    public function test_each_question_lands_on_its_own_guide_for_the_roles_it_is_written_for(): void
    {
        $library = new HowToGuideLibrary;
        $cases = [
            ['How do I check my financial report before sending it?', 'ADMIN', 'admin-check-report'],
            ['How do I draft the remarks for a return or rejection?', 'DEPARTMENT_HEAD', 'review-draft-remarks'],
            ['How do I draft the semester accomplishment report?', 'ADMIN', 'admin-draft-semester-report'],
        ];

        foreach ($cases as [$question, $role, $id]) {
            $found = $library->search($question, $role);
            $this->assertSame($id, $found['best']['id'] ?? null, "{$role}: {$question}");
        }
    }

    public function test_the_remarks_guide_has_a_page_for_each_role_it_names(): void
    {
        $library = new HowToGuideLibrary;
        $guide = collect($library->all())->firstWhere('id', 'review-draft-remarks');

        foreach ($guide['roles'] as $role) {
            foreach ($guide['steps'] as $step) {
                $path = $library->stepPath($step, $role);
                $this->assertNotNull($path, "{$role} has no page for {$step['title']}");
                $this->assertContains($path, config("client_routes.{$role}"), "{$role} cannot open {$path}");
            }
        }
    }
}
