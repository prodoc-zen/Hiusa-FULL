<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The semester's membership fee is one action: the organization head charges every active member at once, sees the
 * count and the total first, and a member who already holds the same open charge is skipped rather than billed twice.
 */
class BulkStudentChargeTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    /** @var array<int, User> */
    private array $members;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']);
        $this->members = User::factory()->student()->count(3)->create(['organization_id' => $this->organization->id, 'account_status' => 'active'])->all();
        Sanctum::actingAs($this->admin);
    }

    private function body(array $extra = []): array
    {
        return ['all_members' => true, 'description' => 'Membership fee', 'amount_due' => '150.00', ...$extra];
    }

    public function test_the_preview_counts_the_members_and_the_total_and_writes_nothing(): void
    {
        $this->postJson('/api/invoices', $this->body(['preview' => true]))->assertOk()
            ->assertJsonPath('preview', true)->assertJsonPath('members', 3)->assertJsonPath('to_charge', 3)
            ->assertJsonPath('skipped', 0)->assertJsonPath('total', 450);

        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, AuditLog::where('module', 'invoices')->count());
    }

    public function test_one_action_charges_every_active_member_and_writes_the_audit_rows(): void
    {
        $this->postJson('/api/invoices', $this->body(['due_date' => '2026-12-15']))->assertCreated()
            ->assertJsonPath('charged', 3)->assertJsonPath('skipped', 0)->assertJsonPath('total', 450);

        $invoices = Invoice::where('organization_id', $this->organization->id)->get();
        $this->assertCount(3, $invoices);
        $this->assertEqualsCanonicalizing(collect($this->members)->pluck('school_id')->all(), $invoices->pluck('student_id')->all());
        $this->assertSame(['unpaid'], $invoices->pluck('status')->unique()->values()->all());
        $this->assertSame('Membership fee', $invoices->first()->description);
        $this->assertSame('2026-12-15', $invoices->first()->due_date->toDateString());
        $this->assertCount(3, $invoices->pluck('reference')->unique());

        $this->assertSame(3, AuditLog::where('module', 'invoices')->where('action', 'created')->count());
        $summary = AuditLog::where('module', 'invoices')->where('action', 'created_for_all_members')->firstOrFail();
        $this->assertSame($this->admin->school_id, $summary->user_id);
        $this->assertSame($this->organization->id, $summary->organization_id);
        $this->assertSame(3, $summary->new_values['charged']);
    }

    private function invoiceFor(User $member, string $status, string $reference, string $description = 'Membership fee'): Invoice
    {
        return Invoice::create(['organization_id' => $this->organization->id, 'student_id' => $member->school_id, 'reference' => $reference, 'description' => $description, 'amount_due' => '150.00', 'status' => $status]);
    }

    public function test_a_member_who_holds_the_same_open_charge_or_already_paid_it_is_skipped_by_default(): void
    {
        $this->invoiceFor($this->members[0], 'unpaid', 'INV-OPEN');
        $this->invoiceFor($this->members[1], 'paid', 'INV-PAID');

        $this->postJson('/api/invoices', $this->body(['preview' => true]))->assertOk()
            ->assertJsonPath('members', 3)->assertJsonPath('to_charge', 1)->assertJsonPath('skipped', 1)
            ->assertJsonPath('already_paid', 1)->assertJsonPath('total', 150);

        $this->postJson('/api/invoices', $this->body())->assertCreated()
            ->assertJsonPath('charged', 1)->assertJsonPath('skipped', 1)->assertJsonPath('already_paid', 1);
        $this->assertSame(1, Invoice::where('student_id', $this->members[0]->school_id)->count());
        $this->assertSame(1, Invoice::where('student_id', $this->members[1]->school_id)->count());
        $this->assertSame(1, Invoice::where('student_id', $this->members[2]->school_id)->count());
    }

    public function test_members_who_already_paid_are_charged_again_only_when_the_flag_says_so(): void
    {
        $this->invoiceFor($this->members[0], 'unpaid', 'INV-OPEN');
        $this->invoiceFor($this->members[1], 'paid', 'INV-PAID');
        $this->invoiceFor($this->members[2], 'cancelled', 'INV-CANCELLED');

        $this->postJson('/api/invoices', $this->body(['preview' => true, 'charge_already_paid' => true]))->assertOk()
            ->assertJsonPath('to_charge', 2)->assertJsonPath('skipped', 1)->assertJsonPath('already_paid', 1)->assertJsonPath('total', 300);

        $this->postJson('/api/invoices', $this->body(['charge_already_paid' => true]))->assertCreated()
            ->assertJsonPath('charged', 2)->assertJsonPath('skipped', 1)->assertJsonPath('already_paid', 1);
        $this->assertSame(1, Invoice::where('student_id', $this->members[0]->school_id)->count());
        $this->assertSame(2, Invoice::where('student_id', $this->members[1]->school_id)->count());
        $this->assertSame(2, Invoice::where('student_id', $this->members[2]->school_id)->count());
        $this->assertTrue(AuditLog::where('action', 'created_for_all_members')->firstOrFail()->new_values['charged_already_paid']);
    }

    public function test_a_request_without_the_flag_never_charges_a_member_who_already_paid(): void
    {
        foreach ($this->members as $index => $member) {
            $this->invoiceFor($member, 'paid', 'INV-PAID-'.$index);
        }

        foreach ([[], ['charge_already_paid' => false], ['charge_already_paid' => 0], ['charge_already_paid' => 'false']] as $extra) {
            $this->postJson('/api/invoices', $this->body($extra))->assertStatus(422);
        }
        $this->assertSame(3, Invoice::count());
    }

    public function test_the_same_charge_after_everyone_paid_is_not_billed_again_without_the_flag(): void
    {
        $this->postJson('/api/invoices', $this->body())->assertCreated()->assertJsonPath('charged', 3);
        Invoice::query()->update(['status' => 'paid']);

        $this->postJson('/api/invoices', $this->body(['preview' => true]))->assertOk()
            ->assertJsonPath('to_charge', 0)->assertJsonPath('skipped', 0)->assertJsonPath('already_paid', 3)->assertJsonPath('total', 0);
        $this->postJson('/api/invoices', $this->body())->assertStatus(422);
        $this->assertSame(3, Invoice::count());
    }

    public function test_running_it_twice_does_not_bill_anyone_twice(): void
    {
        $this->postJson('/api/invoices', $this->body())->assertCreated();

        $this->postJson('/api/invoices', $this->body())->assertStatus(422)
            ->assertJsonPath('message', 'Every active member already has an open charge named Membership fee.');
        $this->assertSame(3, Invoice::count());
    }

    public function test_only_active_members_of_this_organization_are_charged(): void
    {
        $other = Organization::factory()->create();
        User::factory()->student()->create(['organization_id' => $other->id, 'account_status' => 'active']);
        User::factory()->student()->create(['organization_id' => $this->organization->id, 'account_status' => 'inactive']);

        $this->postJson('/api/invoices', $this->body())->assertCreated()->assertJsonPath('charged', 3);
        $this->assertSame(0, Invoice::where('organization_id', $other->id)->count());
    }

    public function test_an_organization_with_no_members_cannot_be_charged(): void
    {
        $empty = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $empty->id, 'account_status' => 'active']));

        $this->postJson('/api/invoices', $this->body(['preview' => true]))->assertOk()->assertJsonPath('members', 0)->assertJsonPath('total', 0);
        $this->postJson('/api/invoices', $this->body())->assertStatus(422)
            ->assertJsonPath('message', 'Your organization has no active members to charge.');
    }

    public function test_the_amount_and_description_are_still_required(): void
    {
        $this->postJson('/api/invoices', $this->body(['amount_due' => '0']))->assertStatus(422)->assertJsonValidationErrors('amount_due');
        $this->postJson('/api/invoices', $this->body(['description' => '']))->assertStatus(422)->assertJsonValidationErrors('description');
        $this->assertSame(0, Invoice::count());
    }

    public function test_an_event_that_is_not_the_organizations_is_refused(): void
    {
        $this->postJson('/api/invoices', $this->body(['event_id' => 999999]))->assertStatus(422);
        $this->assertSame(0, Invoice::count());
    }

    public function test_an_officer_cannot_charge_everyone(): void
    {
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']));

        $this->postJson('/api/invoices', $this->body())->assertForbidden();
        $this->assertSame(0, Invoice::count());
    }

    public function test_charging_one_student_still_works_as_before(): void
    {
        $this->postJson('/api/invoices', ['student_id' => $this->members[0]->school_id, 'description' => 'Shirt', 'amount_due' => '200.00'])->assertCreated()
            ->assertJsonPath('student_id', $this->members[0]->school_id);
        $this->assertSame(1, Invoice::count());
    }
}
