<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderExportCsvInjectionTest extends TestCase
{
    use RefreshDatabase;

    private function exportRows(User $admin): array
    {
        Sanctum::actingAs($admin);
        $content = $this->get('/api/orders/export')->assertOk()->streamedContent();

        $handle = fopen('php://temp', 'r+');
        fwrite($handle, $content);
        rewind($handle);
        $rows = [];
        while (($row = fgetcsv($handle)) !== false) {
            $rows[] = $row;
        }
        fclose($handle);

        return $rows;
    }

    private function orderFor(Organization $organization, User $student): void
    {
        Order::create([
            'organization_id' => $organization->id,
            'student_id' => $student->school_id,
            'merchandise_id' => Merchandise::factory()->create(['organization_id' => $organization->id, 'name' => 'HIUSA Shirt', 'price' => 100])->id,
            'quantity' => 1,
            'total_price' => 100,
            'status' => 'pending',
            'claim_token' => 'CSVINJECT'.$student->school_id,
        ]);
    }

    public function test_student_text_that_would_run_as_a_formula_is_neutralized_in_the_export(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'first_name' => '=HYPERLINK("http://evil.example")',
            'last_name' => 'Doe',
            'email' => '+cmd@example.com',
            'department' => '-1+1',
            'program' => '@SUM(A1)',
            'major' => "\t=1+1",
            'section' => "\r=1+1",
        ]);
        $this->orderFor($organization, $student);

        $rows = $this->exportRows($admin);
        $header = array_flip($rows[0]);
        $row = $rows[1];

        $this->assertStringStartsWith("'=HYPERLINK", $row[$header['Full Name']]);
        $this->assertSame("'+cmd@example.com", $row[$header['Email']]);
        $this->assertSame("'-1+1", $row[$header['Department']]);
        $this->assertSame("'@SUM(A1)", $row[$header['Program']]);
        $this->assertSame("'\t=1+1", $row[$header['Major']]);
        $this->assertSame("'\r=1+1", $row[$header['Section']]);
    }

    public function test_ordinary_values_are_exported_unchanged(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create([
            'organization_id' => $organization->id,
            'first_name' => 'Maria',
            'last_name' => 'Santos',
            'email' => 'maria@example.com',
        ]);
        $this->orderFor($organization, $student);

        $rows = $this->exportRows($admin);
        $header = array_flip($rows[0]);

        $this->assertSame('Maria Santos', $rows[1][$header['Full Name']]);
        $this->assertSame('maria@example.com', $rows[1][$header['Email']]);
        $this->assertSame('HIUSA Shirt', $rows[1][$header['Item']]);
        $this->assertSame('1', $rows[1][$header['Quantity']]);
    }
}
