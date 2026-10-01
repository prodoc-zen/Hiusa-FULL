<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AuditLogExportTest extends TestCase
{
    use RefreshDatabase;

    private function log(Organization $organization, User $actor, string $module, string $description): void
    {
        AuditLog::create([
            'organization_id' => $organization->id,
            'user_id' => $actor->school_id,
            'actor_role' => $actor->role,
            'module' => $module,
            'action' => 'updated',
            'description' => $description,
            'record_type' => User::class,
            'record_id' => $actor->school_id,
            'created_at' => now(),
        ]);
    }

    private function csv(string $content): array
    {
        return array_map('str_getcsv', array_values(array_filter(explode("\n", trim($content)))));
    }

    public function test_admin_exports_only_their_organization_without_grievances_and_respects_filters(): void
    {
        $organization = Organization::factory()->create();
        $other = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $other->id]);
        $this->log($organization, $admin, 'events', 'Event updated.');
        $this->log($organization, $admin, 'tasks', 'Task updated.');
        $this->log($organization, $admin, 'grievances', 'Grievance updated.');
        $this->log($other, $otherAdmin, 'events', 'Other organization event.');
        Sanctum::actingAs($admin);

        $response = $this->get('/api/audit-logs/export')->assertOk();
        $rows = $this->csv($response->streamedContent());

        $this->assertStringContainsString('text/csv', $response->headers->get('Content-Type'));
        $this->assertSame(['Date and time', 'Actor', 'School ID', 'Role', 'Module', 'Action', 'Description', 'Record'], $rows[0]);
        $this->assertEqualsCanonicalizing(['Event updated.', 'Task updated.'], array_column(array_slice($rows, 1), 6));

        $filtered = $this->csv($this->get('/api/audit-logs/export?module=tasks')->assertOk()->streamedContent());
        $this->assertSame(['Task updated.'], array_column(array_slice($filtered, 1), 6));
    }

    public function test_sao_export_spans_organizations_names_them_and_hides_ledger_modules(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $alpha = Organization::factory()->create(['name' => 'Org Alpha']);
        $beta = Organization::factory()->create(['name' => 'Org Beta']);
        $alphaAdmin = User::factory()->admin()->create(['organization_id' => $alpha->id]);
        $betaAdmin = User::factory()->admin()->create(['organization_id' => $beta->id]);
        $this->log($alpha, $alphaAdmin, 'events', 'Alpha event.');
        $this->log($beta, $betaAdmin, 'grievances', 'Beta grievance.');
        $this->log($beta, $betaAdmin, 'financial_ledger', 'Beta ledger entry.');
        Sanctum::actingAs($director);

        $rows = $this->csv($this->get('/api/audit-logs/export')->assertOk()->streamedContent());

        $this->assertSame('Organization', $rows[0][4]);
        $byDescription = collect(array_slice($rows, 1))->keyBy(7);
        $this->assertSame(['Alpha event.', 'Beta grievance.'], $byDescription->keys()->sort()->values()->all());
        $this->assertSame('Org Alpha', $byDescription['Alpha event.'][4]);
    }

    public function test_cells_that_would_run_as_spreadsheet_formulas_are_neutralized(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id, 'first_name' => '=HYPERLINK("http://x")']);
        $this->log($organization, $admin, 'events', '+SUM(A1:A9)');
        Sanctum::actingAs($admin);

        $row = $this->csv($this->get('/api/audit-logs/export')->assertOk()->streamedContent())[1];

        $this->assertStringStartsWith("'=HYPERLINK", $row[1]);
        $this->assertSame("'+SUM(A1:A9)", $row[6]);
    }

    public function test_officers_cannot_export_the_audit_log(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']));

        $this->get('/api/audit-logs/export')->assertForbidden();
    }
}
