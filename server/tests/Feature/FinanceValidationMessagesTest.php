<?php

namespace Tests\Feature;

use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinanceValidationMessagesTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_semester_starting_in_the_future_says_so_in_plain_words(): void
    {
        Sanctum::actingAs(User::factory()->admin()->create());

        $this->postJson('/api/financial-semesters', ['name' => 'Next term', 'starts_on' => today()->addDays(3)->toDateString()])
            ->assertStatus(422)
            ->assertJsonPath('errors.starts_on.0', 'The start date cannot be in the future.');
    }

    public function test_a_repeated_semester_name_says_so_in_plain_words(): void
    {
        Sanctum::actingAs(User::factory()->admin()->create());
        $payload = ['name' => 'Term one', 'starts_on' => today()->subMonth()->toDateString()];
        $this->postJson('/api/financial-semesters', $payload)->assertCreated();

        $this->postJson('/api/financial-semesters', $payload)
            ->assertStatus(422)
            ->assertJsonPath('errors.name.0', 'A semester with this name already exists.');
    }

    public function test_a_repeated_receipt_reference_says_so_in_plain_words(): void
    {
        $admin = User::factory()->admin()->create();
        Transaction::create([
            'organization_id' => $admin->organization_id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'category' => 'Dues',
            'description' => 'First', 'amount' => 50, 'receipt_reference' => 'OR-100', 'transaction_date' => now(),
        ]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/transactions', [
            'type' => 'income', 'category' => 'Dues', 'description' => 'Second', 'amount' => 50,
            'transaction_date' => today()->toDateString(), 'receipt_reference' => 'OR-100',
        ])->assertStatus(422)->assertJsonPath('errors.receipt_reference.0', 'This receipt reference is already used. Enter a different one.');
    }
}
