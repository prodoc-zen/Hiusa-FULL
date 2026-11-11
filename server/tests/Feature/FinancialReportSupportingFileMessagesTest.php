<?php

namespace Tests\Feature;

use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinancialReportSupportingFileMessagesTest extends TestCase
{
    use RefreshDatabase;

    private FinancialReport $report;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        Transaction::create([
            'organization_id' => $organization->id,
            'recorded_by' => $admin->school_id,
            'type' => 'income',
            'category' => 'membership',
            'amount' => 1000,
            'description' => 'Dues',
            'transaction_date' => now(),
        ]);
        Sanctum::actingAs($admin);
        $id = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'monthly',
            'signatories' => ['treasurer' => 'T', 'president' => 'P', 'adviser' => 'A', 'sbo_adviser' => 'S'],
        ])->assertCreated()->json('report.id');
        $this->report = FinancialReport::findOrFail($id);
    }

    private function submitWith(array $files)
    {
        return $this->post("/api/financial-reports/{$this->report->id}/submit", ['supporting_documents' => $files], ['Accept' => 'application/json']);
    }

    public function test_a_file_of_the_wrong_type_is_refused_in_plain_words(): void
    {
        $response = $this->submitWith([UploadedFile::fake()->create('setup.exe', 10, 'application/x-msdownload')])->assertStatus(422);

        $this->assertSame(['Supporting files must be PDF, JPG, PNG, Word or Excel files.'], $response->json('errors')['supporting_documents.0']);
    }

    public function test_a_file_over_ten_megabytes_is_refused_in_plain_words(): void
    {
        $response = $this->submitWith([UploadedFile::fake()->create('scan.pdf', 10241, 'application/pdf')])->assertStatus(422);

        $this->assertSame(['Each supporting file must be 10 MB or smaller.'], $response->json('errors')['supporting_documents.0']);
    }

    public function test_more_than_ten_files_are_refused_in_plain_words(): void
    {
        $files = array_map(fn ($n) => UploadedFile::fake()->create("proof{$n}.pdf", 10, 'application/pdf'), range(1, 11));

        $this->submitWith($files)
            ->assertStatus(422)
            ->assertJsonPath('errors.supporting_documents.0', 'Attach no more than 10 supporting files.');
    }

    public function test_ten_files_of_the_largest_allowed_size_are_accepted(): void
    {
        $files = array_map(fn ($n) => UploadedFile::fake()->create("proof{$n}.pdf", 10240, 'application/pdf'), range(1, 10));

        $this->submitWith($files)->assertOk();
    }
}
