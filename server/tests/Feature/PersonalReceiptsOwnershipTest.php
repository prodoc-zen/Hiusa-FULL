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

    public function test_a_student_downloads_their_own_receipt_as_a_pdf_and_each_listed_receipt_says_where(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $own = $this->receipt($organization, $admin, $student, 'PDF-OWN');

        Sanctum::actingAs($student);

        $this->getJson('/api/transactions/personal-receipts')
            ->assertOk()
            ->assertJsonPath('0.open_url', '/transactions/personal-receipts/'.$own->id.'/pdf');

        $response = $this->get('/api/transactions/personal-receipts/'.$own->id.'/pdf');
        $response->assertOk();
        $this->assertStringStartsWith('application/pdf', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('private', $response->headers->get('Cache-Control'));
        $this->assertStringStartsWith('%PDF', $response->getContent());
    }

    public function test_a_student_cannot_download_another_persons_receipt_or_one_with_no_payer(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $other = User::factory()->student()->create(['organization_id' => $organization->id]);
        $theirs = $this->receipt($organization, $admin, $other, 'PDF-OTHER');
        $expense = $this->receipt($organization, $admin, null, 'PDF-EXPENSE');

        Sanctum::actingAs($student);

        $this->getJson('/api/transactions/personal-receipts/'.$theirs->id.'/pdf')->assertNotFound();
        $this->getJson('/api/transactions/personal-receipts/'.$expense->id.'/pdf')->assertNotFound();
        $this->getJson('/api/transactions/personal-receipts/999999/pdf')->assertNotFound();
    }

    public function test_an_officer_without_the_finance_area_downloads_only_their_own_receipt_pdf(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $officer->accountProfiles()->where('organization_id', $organization->id)->update(['modules' => ['events']]);
        $own = $this->receipt($organization, $admin, $officer, 'PDF-OFFICER-OWN');
        $recordedForOthers = $this->receipt($organization, $officer, $admin, 'PDF-RECORDED');

        Sanctum::actingAs($officer->fresh());

        $this->get('/api/transactions/personal-receipts/'.$own->id.'/pdf')->assertOk();
        $this->getJson('/api/transactions/personal-receipts/'.$recordedForOthers->id.'/pdf')->assertNotFound();
    }

    public function test_the_receipt_pdf_needs_a_signed_in_person(): void
    {
        $this->getJson('/api/transactions/personal-receipts/1/pdf')->assertUnauthorized();
    }
}
