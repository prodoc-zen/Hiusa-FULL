<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Budget;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class OrgSpaceTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function world(): array
    {
        $computing = $this->makeCollege('CCS');
        $business = $this->makeCollege('CBE');
        $organization = $this->makeCollegeStudentOrganization($computing, ['name' => 'Computing Society']);
        $other = $this->makeCollegeStudentOrganization($business);

        return [
            'head' => $this->makeCollegeHead($computing),
            'otherHead' => $this->makeCollegeHead($business),
            'organization' => $organization,
            'other' => $other,
            'admin' => User::factory()->admin()->create(['organization_id' => $organization->id, 'first_name' => 'Ana', 'last_name' => 'Reyes']),
        ];
    }

    private function space(User $user, Organization $organization)
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);

        return $this->getJson("/api/college/organizations/{$organization->id}/space");
    }

    private function transactions(User $user, Organization $organization, array $query = [])
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);

        return $this->getJson("/api/college/organizations/{$organization->id}/space/transactions".($query ? '?'.http_build_query($query) : ''));
    }

    public function test_head_reads_the_space_of_an_organization_in_their_college(): void
    {
        ['head' => $head, 'organization' => $organization, 'admin' => $admin] = $this->world();

        $response = $this->space($head, $organization)->assertOk();

        $response->assertJsonPath('organization.name', 'Computing Society')
            ->assertJsonPath('lifecycle.status', 'active')
            ->assertJsonStructure(['organization', 'lifecycle', 'counts', 'members', 'events' => ['upcoming', 'recent'], 'finance' => ['allocated', 'income', 'spent', 'remaining', 'budgets'], 'documents']);
        $member = collect($response->json('members'))->firstWhere('school_id', $admin->school_id);
        $this->assertSame('Ana Reyes', $member['name']);
        $this->assertSame('ADMIN', $member['role']);
        $this->assertArrayNotHasKey('password', $member);
    }

    public function test_other_college_head_cannot_read_it(): void
    {
        ['otherHead' => $otherHead, 'organization' => $organization] = $this->world();

        $this->space($otherHead, $organization)->assertForbidden();
    }

    public function test_head_cannot_read_an_organization_outside_their_college(): void
    {
        ['head' => $head, 'other' => $other] = $this->world();

        $this->space($head, $other)->assertForbidden();
    }

    public function test_the_college_home_organization_is_not_a_space(): void
    {
        ['head' => $head] = $this->world();

        $this->space($head, Organization::find($head->organization_id))->assertForbidden();
    }

    public function test_unknown_organization_is_not_found(): void
    {
        ['head' => $head] = $this->world();
        Sanctum::actingAs($head);

        $this->getJson('/api/college/organizations/999999/space')->assertNotFound();
    }

    public function test_organization_members_cannot_use_the_oversight_routes(): void
    {
        ['organization' => $organization, 'admin' => $admin] = $this->world();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);

        foreach ([$admin, $officer, $student] as $user) {
            $this->space($user, $organization)->assertForbidden();
            $this->transactions($user, $organization)->assertForbidden();
        }
    }

    public function test_sao_reads_the_space_of_any_organization_in_any_college(): void
    {
        ['organization' => $organization, 'other' => $other] = $this->world();
        $sao = User::factory()->superAdmin()->create();

        $this->space($sao, $organization)->assertOk()->assertJsonPath('organization.name', 'Computing Society');
        $this->space($sao, $other)->assertOk()->assertJsonPath('organization.id', $other->id);
    }

    public function test_sao_cannot_open_a_college_home_organization_as_a_space(): void
    {
        ['head' => $head] = $this->world();
        $sao = User::factory()->superAdmin()->create();

        $this->space($sao, Organization::find($head->organization_id))->assertForbidden();
        $this->transactions($sao, Organization::find($head->organization_id))->assertForbidden();
    }

    public function test_transactions_are_scoped_paginated_newest_first_and_filterable_by_type(): void
    {
        ['head' => $head, 'organization' => $organization, 'other' => $other, 'admin' => $admin] = $this->world();
        foreach (range(1, 17) as $day) {
            Transaction::factory()->create([
                'organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'expense',
                'amount' => 10, 'description' => "Expense {$day}", 'transaction_date' => now()->subDays(30 - $day),
            ]);
        }
        Transaction::factory()->create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'amount' => 500, 'description' => 'Dues', 'transaction_date' => now()->subDays(60)]);
        Transaction::factory()->create(['organization_id' => $other->id, 'type' => 'income', 'amount' => 9999, 'description' => 'Not ours']);

        $first = $this->transactions($head, $organization)->assertOk();

        $first->assertJsonPath('meta.total', 18)->assertJsonPath('meta.per_page', 15)->assertJsonPath('meta.last_page', 2);
        $this->assertCount(15, $first->json('data'));
        $this->assertSame('Expense 17', $first->json('data.0.description'));
        $this->assertSame('Ana Reyes', $first->json('data.0.recorded_by'));
        $this->assertEquals(500, $first->json('summary.income'));
        $this->assertEquals(170, $first->json('summary.expense'));
        $this->assertStringNotContainsString('Not ours', $first->getContent());

        $second = $this->transactions($head, $organization, ['page' => 2])->assertOk();
        $this->assertCount(3, $second->json('data'));
        $this->assertSame('Dues', $second->json('data.2.description'));

        $income = $this->transactions($head, $organization, ['type' => 'income'])->assertOk();
        $this->assertSame(['Dues'], array_column($income->json('data'), 'description'));
        $this->assertEquals(170, $income->json('summary.expense'));

        $this->transactions($head, $organization, ['type' => 'refund'])->assertStatus(422);
    }

    public function test_transactions_of_another_college_are_closed_to_the_head_and_open_to_the_sao(): void
    {
        ['head' => $head, 'otherHead' => $otherHead, 'organization' => $organization] = $this->world();
        Transaction::factory()->create(['organization_id' => $organization->id, 'type' => 'income', 'amount' => 75, 'description' => 'Sponsor']);
        $sao = User::factory()->superAdmin()->create();

        $this->transactions($otherHead, $organization)->assertForbidden();
        $this->transactions($head, $organization)->assertOk()->assertJsonPath('meta.total', 1);
        $this->transactions($sao, $organization)->assertOk()->assertJsonPath('data.0.description', 'Sponsor');
    }

    public function test_events_split_into_upcoming_and_recent_and_skip_other_organizations(): void
    {
        ['head' => $head, 'organization' => $organization, 'other' => $other, 'admin' => $admin] = $this->world();
        $make = fn (Organization $org, string $title, $start) => Event::factory()->create([
            'organization_id' => $org->id, 'created_by' => $admin->id, 'title' => $title, 'status' => 'approved',
            'start_time' => $start, 'end_time' => $start->copy()->addHours(2),
        ]);
        $make($organization, 'Next week', now()->addWeek());
        $make($organization, 'Last month', now()->subMonth());
        $make($other, 'Not ours', now()->addDays(2));

        $response = $this->space($head, $organization)->assertOk();

        $this->assertSame(['Next week'], collect($response->json('events.upcoming'))->pluck('title')->all());
        $this->assertSame(['Last month'], collect($response->json('events.recent'))->pluck('title')->all());
        $this->assertSame(1, $response->json('counts.upcoming_events'));
    }

    public function test_finance_counts_only_approved_budgets_and_adds_income_to_the_remaining_amount(): void
    {
        ['head' => $head, 'organization' => $organization, 'admin' => $admin] = $this->world();
        $approved = Budget::factory()->create(['organization_id' => $organization->id, 'allocated_amount' => 1000, 'remaining_amount' => 1000, 'warning_threshold' => 100, 'submission_status' => 'approved']);
        Budget::factory()->create(['organization_id' => $organization->id, 'allocated_amount' => 5000, 'remaining_amount' => 5000, 'warning_threshold' => 100, 'submission_status' => 'pending_department_head']);
        foreach ([['expense', 300], ['income', 200]] as [$type, $amount]) {
            Transaction::factory()->create(['organization_id' => $organization->id, 'budget_id' => $approved->id, 'recorded_by' => $admin->school_id, 'type' => $type, 'amount' => $amount]);
        }

        $finance = $this->space($head, $organization)->assertOk()->json('finance');

        $this->assertSame(1, $finance['approved_budget_count']);
        $this->assertEquals(1000, $finance['allocated']);
        $this->assertEquals(300, $finance['spent']);
        $this->assertEquals(200, $finance['income']);
        $this->assertEquals(900, $finance['remaining']);
        $this->assertEquals(900, $finance['budgets'][0]['remaining']);
    }

    public function test_documents_carry_a_protected_open_url_and_never_a_storage_path(): void
    {
        ['head' => $head, 'organization' => $organization, 'admin' => $admin] = $this->world();
        $type = ComplianceRequirementType::create(['name' => 'By-laws', 'academic_year' => '2026-2027', 'deadline_at' => now()->addMonth(), 'created_by' => $admin->school_id, 'is_active' => true]);
        $submission = OrganizationComplianceSubmission::create([
            'organization_id' => $organization->id, 'requirement_type_id' => $type->id, 'status' => 'submitted',
            'file_path' => 'compliance/secret/by-laws.pdf', 'file_original_name' => 'by-laws.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1200, 'submitted_by' => $admin->school_id, 'submitted_at' => now(),
        ]);

        $response = $this->space($head, $organization)->assertOk();

        $document = $response->json('documents.0');
        $this->assertSame("/compliance/submissions/{$submission->id}/document", $document['open_url']);
        $this->assertSame('By-laws', $document['requirement_name']);
        $this->assertStringNotContainsString('compliance/secret', $response->getContent());
        $this->assertSame(1, $response->json('counts.pending_documents'));
    }

    public function test_members_are_active_profiles_only_with_officers_first(): void
    {
        ['head' => $head, 'organization' => $organization] = $this->world();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id, 'first_name' => 'Zed', 'last_name' => 'Aquino']);
        $gone = User::factory()->student()->create(['organization_id' => $organization->id, 'first_name' => 'Gone', 'last_name' => 'Away']);
        AccountProfile::where('user_school_id', $gone->school_id)->where('organization_id', $organization->id)->update(['account_status' => 'inactive']);

        $members = $this->space($head, $organization)->assertOk()->json('members');

        $this->assertSame(['ADMIN', 'SBO_OFFICER'], array_slice(array_column($members, 'role'), 0, 2));
        $this->assertNotContains($gone->school_id, array_column($members, 'school_id'));
        $this->assertContains($officer->school_id, array_column($members, 'school_id'));
    }
}
