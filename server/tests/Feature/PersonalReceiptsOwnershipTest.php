<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PersonalReceiptsOwnershipTest extends TestCase
{
    use RefreshDatabase;

    private function receipt(Organization $organization, User $recorder, ?User $payer, string $reference): Transaction
    {
        return Transaction::create([
            'organization_id' => $organization->id,
            'recorded_by' => $recorder->school_id,
            'payer_id' => $payer?->school_id,
            'type' => $payer ? 'income' : 'expense',
            'category' => $payer ? 'Merchandise' : 'Supplies',
            'description' => 'Receipt '.$reference,
            'amount' => 100,
            'receipt_reference' => $reference,
            'transaction_date' => now(),
        ]);
    }

    public static function recorderRoles(): array
    {
        return [
            'admin' => ['admin'],
            'officer' => ['officer'],
        ];
    }

    /** @dataProvider recorderRoles */
    public function test_a_person_who_recorded_other_peoples_payments_only_receives_their_own_receipts(string $state): void
    {
        $organization = Organization::factory()->create();
        $recorder = User::factory()->{$state}()->create(['organization_id' => $organization->id]);
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);

        $own = $this->receipt($organization, $buyer, $recorder, 'OWN-PAYMENT');
        $this->receipt($organization, $recorder, $buyer, 'RECORDED-FOR-STUDENT');
        $this->receipt($organization, $recorder, null, 'ORG-EXPENSE');

        Sanctum::actingAs($recorder);

        $this->getJson('/api/transactions/personal-receipts')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $own->id);
    }

    public function test_a_student_never_receives_another_persons_receipt(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $other = User::factory()->student()->create(['organization_id' => $organization->id]);

        $own = $this->receipt($organization, $admin, $student, 'STUDENT-OWN');
        $this->receipt($organization, $admin, $other, 'STUDENT-OTHER');

        Sanctum::actingAs($student);

        $this->getJson('/api/transactions/personal-receipts')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $own->id);
    }
}
