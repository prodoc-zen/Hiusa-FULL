<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AiOutputOutcomeTest extends TestCase
{
    use RefreshDatabase;

    private function officer(): User
    {
        return User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'SBO_OFFICER']);
    }

    private function draft(User $user, string $feature = 'review_note', mixed $output = 'Please attach the signed proposal.', string $status = 'pending'): AiOutput
    {
        return AiOutput::create([
            'organization_id' => $user->organization_id,
            'feature_type' => $feature,
            'reference_type' => 'event',
            'prompt_text' => 'p',
            'output_text' => '',
            'context_version' => 'v1',
            'structured_input' => ['facts' => ['round' => 1]],
            'structured_output' => $output,
            'status' => 'completed',
            'version' => 1,
            'decision_status' => $status,
            'requested_by' => $user->school_id,
        ]);
    }

    public function test_the_text_left_as_drafted_is_accepted(): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user);

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => 'Please attach the signed proposal.'])
            ->assertOk()
            ->assertExactJson(['success' => true, 'data' => ['decision_status' => 'accepted']]);

        $draft->refresh();
        $this->assertSame('accepted', $draft->decision_status);
        $this->assertSame($user->school_id, (int) $draft->decided_by);
        $this->assertNotNull($draft->decided_at);
        $this->assertSame('Please attach the signed proposal.', $draft->structured_output, 'the stored draft is never rewritten');
    }

    public function test_a_difference_in_spacing_only_is_still_accepted(): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user, 'handover_note', "Two tasks are open.\n\nCollect dues.");

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => "  Two tasks   are open.\nCollect  dues.\n"])
            ->assertOk()->assertJsonPath('data.decision_status', 'accepted');
    }

    public function test_changed_wording_is_edited(): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user);

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => 'Please attach the signed proposal and the budget.'])
            ->assertOk()->assertJsonPath('data.decision_status', 'edited');

        $draft->refresh();
        $this->assertSame('edited', $draft->decision_status);
        $this->assertSame($user->school_id, (int) $draft->decided_by);
        $this->assertNotNull($draft->decided_at);
    }

    public function test_no_final_text_is_discarded(): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user, 'report_check');

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => null])
            ->assertOk()->assertJsonPath('data.decision_status', 'discarded');

        $this->assertSame('discarded', $draft->refresh()->decision_status);
        $this->assertNotNull($draft->decided_at);
    }

    public function test_an_empty_field_counts_as_no_text(): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user, 'semester_narrative');

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => ''])
            ->assertOk()->assertJsonPath('data.decision_status', 'discarded');
    }

    public function test_a_draft_stored_with_a_text_key_or_in_sections_is_compared_by_its_text(): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $keyed = $this->draft($user, 'semester_narrative', ['text' => 'A busy semester.']);
        $sectioned = $this->draft($user, 'semester_narrative', ['sections' => [['heading' => 'Events', 'body' => 'Three events ran.'], ['heading' => 'Tasks', 'body' => 'Most tasks closed.']]]);

        $this->postJson("/api/ai/outputs/{$keyed->id}/outcome", ['final_text' => 'A busy semester.'])->assertOk()->assertJsonPath('data.decision_status', 'accepted');
        $this->postJson("/api/ai/outputs/{$sectioned->id}/outcome", ['final_text' => 'Events Three events ran. Tasks Most tasks closed.'])->assertOk()->assertJsonPath('data.decision_status', 'accepted');
    }

    public function test_the_field_is_required_and_must_be_text(): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user);

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", [])->assertStatus(422)->assertJsonValidationErrors('final_text');
        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => ['a']])->assertStatus(422)->assertJsonValidationErrors('final_text');
        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => str_repeat('a', 20001)])->assertStatus(422)->assertJsonValidationErrors('final_text');
        $this->assertSame('pending', $draft->refresh()->decision_status);
    }

    public function test_only_the_person_who_asked_can_record_it(): void
    {
        $owner = $this->officer();
        $other = User::factory()->create(['organization_id' => $owner->organization_id, 'role' => 'ADMIN']);
        $draft = $this->draft($owner);
        Sanctum::actingAs($other);

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => null])->assertNotFound();

        $this->assertSame('pending', $draft->refresh()->decision_status);
        $this->assertNull($draft->decided_by);
    }

    #[DataProvider('otherFeatures')]
    public function test_other_features_are_not_recorded_here(string $feature): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user, $feature);

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => null])->assertNotFound();

        $this->assertSame('pending', $draft->refresh()->decision_status);
    }

    public static function otherFeatures(): array
    {
        return [['ANNOUNCEMENT_DRAFT'], ['EVENT_WORKFLOW'], ['ask_ai'], ['']];
    }

    #[DataProvider('settledStatuses')]
    public function test_a_draft_that_is_already_settled_cannot_be_recorded_again(string $status): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user, 'review_note', 'Text.', $status);

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => 'Other text.'])->assertStatus(409);

        $this->assertSame($status, $draft->refresh()->decision_status);
        $this->assertNull($draft->decided_at);
    }

    public static function settledStatuses(): array
    {
        return [['accepted'], ['edited'], ['discarded'], ['rejected'], ['superseded']];
    }

    public function test_a_second_call_after_the_first_is_refused(): void
    {
        $user = $this->officer();
        Sanctum::actingAs($user);
        $draft = $this->draft($user);

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => 'Edited.'])->assertOk();
        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => null])->assertStatus(409);

        $this->assertSame('edited', $draft->refresh()->decision_status);
    }

    public function test_a_missing_draft_is_not_found_and_a_guest_is_refused(): void
    {
        $user = $this->officer();
        $draft = $this->draft($user);

        $this->postJson("/api/ai/outputs/{$draft->id}/outcome", ['final_text' => null])->assertUnauthorized();

        Sanctum::actingAs($user);
        $this->postJson('/api/ai/outputs/999999/outcome', ['final_text' => null])->assertNotFound();
    }
}
