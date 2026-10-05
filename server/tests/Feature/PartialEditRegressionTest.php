<?php

namespace Tests\Feature;

use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Editing one field must not require resending every other field. These
 * edits used to fail with a 500 because 'sometimes|required' was passed as a
 * single array rule, which Laravel reads as one unknown rule name.
 */
class PartialEditRegressionTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->admin);
    }

    public function test_a_transaction_description_can_be_corrected_alone(): void
    {
        $transaction = Transaction::factory()->create([
            'organization_id' => $this->organization->id,
            'recorded_by' => $this->admin->school_id,
            'type' => 'income',
            'amount' => 500,
            'category' => 'Membership Fees',
            'description' => 'Membership fees, first week',
            'budget_id' => null,
            'event_id' => null,
            'payer_id' => null,
        ]);

        $this->putJson("/api/transactions/{$transaction->id}", ['description' => 'Membership fees, first and second week'])
            ->assertOk()
            ->assertJsonPath('description', 'Membership fees, first and second week');
        $this->assertEquals(500, (float) $transaction->fresh()->amount);
    }

    public function test_a_forecast_can_be_adjusted_one_figure_at_a_time(): void
    {
        $forecast = FinancialForecast::factory()->create(['organization_id' => $this->organization->id]);

        $this->putJson("/api/forecasts/{$forecast->id}", ['confidence_note' => 'Adjusted after the treasurer review.'])
            ->assertOk();
        $this->assertSame('Adjusted after the treasurer review.', $forecast->fresh()->confidence_note);
    }

    public function test_a_task_title_can_be_edited_alone(): void
    {
        $task = Task::factory()->create(['organization_id' => $this->organization->id, 'status' => 'pending', 'deadline' => now()->addWeek()]);

        $this->putJson("/api/tasks/{$task->id}", ['title' => 'Book the gymnasium for the general assembly'])
            ->assertOk();
        $this->assertSame('Book the gymnasium for the general assembly', $task->fresh()->title);
    }
}
