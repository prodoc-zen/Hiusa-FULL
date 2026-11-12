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
