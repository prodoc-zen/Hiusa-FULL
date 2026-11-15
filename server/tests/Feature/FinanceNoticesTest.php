<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\Invoice;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Cash advances and student charges tell the person they are about, once, and never the person who made the change. */
class FinanceNoticesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $requester;

    private User $approver;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->requester = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->approver = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    private function noticesFor(User $user)
    {
        return Notification::where('user_id', $user->school_id)->orderBy('id')->get();
    }

    private function requestedAdvance(): int
    {
        Sanctum::actingAs($this->requester);

        return $this->postJson('/api/cash-advances', ['amount' => '500.00', 'purpose' => 'Venue deposit'])->assertCreated()->json('id');
    }

    public function test_approving_and_releasing_a_cash_advance_tells_the_requester(): void
    {
        $id = $this->requestedAdvance();
        $this->assertCount(0, $this->noticesFor($this->requester));

        Sanctum::actingAs($this->approver);
        $this->patchJson("/api/cash-advances/{$id}/approve")->assertOk();
        $this->patchJson("/api/cash-advances/{$id}/release")->assertOk();

        $notices = $this->noticesFor($this->requester);
        $this->assertSame(['Cash Advance Approved', 'Cash Advance Released'], $notices->pluck('title')->all());
        $this->assertStringContainsString('PHP 500.00', $notices[0]->message);
        $this->assertSame('financial', $notices[0]->notification_type);
        $this->assertSame(CashAdvance::class, $notices[0]->reference_type);
        $this->assertSame($id, (int) $notices[0]->reference_id);
        $this->assertSame($this->organization->id, (int) $notices[0]->organization_id);
        $this->assertFalse($notices[0]->is_read);
        $this->assertCount(0, $this->noticesFor($this->approver));
    }

    public function test_a_repayment_tells_the_approver_and_says_when_it_is_fully_repaid(): void
    {
        $id = $this->requestedAdvance();
        Sanctum::actingAs($this->approver);
        $this->patchJson("/api/cash-advances/{$id}/approve")->assertOk();
        $this->patchJson("/api/cash-advances/{$id}/release")->assertOk();

        Sanctum::actingAs($this->requester);
        $this->postJson("/api/cash-advances/{$id}/repayments", ['amount' => '200.00'])->assertOk();
        $this->postJson("/api/cash-advances/{$id}/repayments", ['amount' => '300.00'])->assertOk();

        $notices = $this->noticesFor($this->approver);
        $this->assertSame(['Cash Advance Repayment', 'Cash Advance Repaid'], $notices->pluck('title')->all());
        $this->assertStringContainsString('PHP 300.00 is still outstanding', $notices[0]->message);
        $this->assertStringContainsString('fully repaid', $notices[1]->message);
        $this->assertSame(CashAdvance::class, $notices[1]->reference_type);
        $this->assertSame(['Cash Advance Approved', 'Cash Advance Released'], $this->noticesFor($this->requester)->pluck('title')->all());
    }

    public function test_the_person_who_releases_their_own_advance_is_not_told_about_it(): void
    {
        $id = $this->requestedAdvance();
        Sanctum::actingAs($this->approver);
        $this->patchJson("/api/cash-advances/{$id}/approve")->assertOk();

        Sanctum::actingAs($this->requester);
        $this->patchJson("/api/cash-advances/{$id}/release")->assertOk();

        $this->assertSame(['Cash Advance Approved'], $this->noticesFor($this->requester)->pluck('title')->all());
    }

    public function test_a_refused_cash_advance_step_sends_nothing(): void
    {
        $id = $this->requestedAdvance();

        $this->patchJson("/api/cash-advances/{$id}/approve")->assertForbidden();
        $this->patchJson("/api/cash-advances/{$id}/release")->assertStatus(409);

        $this->assertSame(0, Notification::count());
    }

    public function test_issuing_an_invoice_tells_the_student_with_a_link_that_resolves(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);

        Sanctum::actingAs($this->requester);
        $id = $this->postJson('/api/invoices', ['student_id' => $student->school_id, 'description' => 'Organization fee', 'amount_due' => '150.00', 'due_date' => '2026-12-15'])
            ->assertCreated()->json('id');

        $notice = $this->noticesFor($student)->sole();
        $this->assertSame('New Invoice', $notice->title);
        $this->assertStringContainsString('Organization fee', $notice->message);
        $this->assertStringContainsString('PHP 150.00', $notice->message);
        $this->assertStringContainsString('Dec 15, 2026', $notice->message);
        $this->assertSame(Invoice::class, $notice->reference_type);
        $this->assertSame($id, (int) $notice->reference_id);
        $this->assertSame('financial', $notice->notification_type);
        $this->assertTrue(in_array('/dashboard/finance/statement-of-account', config('client_routes.STUDENT'), true));
    }

    public function test_charging_every_member_tells_each_member_and_a_preview_tells_nobody(): void
    {
        $first = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $second = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $body = ['all_members' => true, 'description' => 'Shirt fund', 'amount_due' => '75.00'];

        Sanctum::actingAs($this->requester);
        $this->postJson('/api/invoices', [...$body, 'preview' => true])->assertOk();
        $this->assertSame(0, Notification::count());

        $this->postJson('/api/invoices', $body)->assertCreated();

        $this->assertSame(['New Invoice'], $this->noticesFor($first)->pluck('title')->all());
        $this->assertSame(['New Invoice'], $this->noticesFor($second)->pluck('title')->all());
        $this->assertSame(1, Notification::where('user_id', $first->school_id)->where('reference_type', Invoice::class)->count());
    }

    public function test_recording_a_payment_tells_the_student_the_balance_then_that_it_is_paid(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->requester);
        $id = $this->postJson('/api/invoices', ['student_id' => $student->school_id, 'description' => 'Organization fee', 'amount_due' => '300.00'])->assertCreated()->json('id');

        $this->postJson("/api/invoices/{$id}/payments", ['amount' => '100.00'])->assertOk();
        $this->postJson("/api/invoices/{$id}/payments", ['amount' => '200.00'])->assertOk();
        $this->postJson("/api/invoices/{$id}/payments", ['amount' => '1.00'])->assertUnprocessable();

        $notices = $this->noticesFor($student);
        $this->assertSame(['New Invoice', 'Invoice Payment Recorded', 'Invoice Payment Recorded'], $notices->pluck('title')->all());
        $this->assertStringContainsString('PHP 200.00 is still due', $notices[1]->message);
        $this->assertStringContainsString('paid in full', $notices[2]->message);
        $this->assertSame(Invoice::class, $notices[2]->reference_type);
        $this->assertSame($id, (int) $notices[2]->reference_id);
    }
}
