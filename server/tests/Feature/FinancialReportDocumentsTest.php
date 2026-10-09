<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class FinancialReportDocumentsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function world(): array
    {
        Storage::fake('local');
        Storage::fake('public');
        $computing = $this->makeCollege('CCS');
        $business = $this->makeCollege('CBE');
        $organization = $this->makeCollegeStudentOrganization($computing);
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();

        return [
            'organization' => $organization,
            'admin' => User::factory()->admin()->create(['organization_id' => $organization->id]),
            'otherAdmin' => User::factory()->admin()->create(['organization_id' => $this->makeCollegeStudentOrganization($business)->id]),
            'head' => $this->makeCollegeHead($computing),
            'otherHead' => $this->makeCollegeHead($business),
            'director' => User::factory()->superAdmin()->create(['organization_id' => $sao->id]),
        ];
    }

    private function draftReport(Organization $organization, User $generator, array $overrides = []): FinancialReport
    {
        return FinancialReport::create([
            'organization_id' => $organization->id,
            'report_type' => 'monthly',
            'title' => 'Monthly Financial Report',
            'summary_text' => 'Calculated report summary.',
            'source_transaction_ids' => [],
            'signatories' => [],
            'submission_status' => 'draft',
            'generated_by' => $generator->school_id,
            'generated_at' => now(),
            ...$overrides,
        ]);
    }

    private function submittedReportWithDocument(array $world): FinancialReport
    {
        $report = $this->draftReport($world['organization'], $world['admin']);
        Sanctum::actingAs($world['admin']);
        $this->post('/api/financial-reports/'.$report->id.'/submit', [
            'supporting_documents' => [UploadedFile::fake()->createWithContent('receipts.pdf', '%PDF-1.4 receipts')],
        ])->assertOk();

        return $report->fresh();
    }

    private function actingAsFresh(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);
    }

    public function test_new_supporting_documents_are_stored_privately_and_never_expose_a_path_or_public_url(): void
    {
        $world = $this->world();
        $report = $this->draftReport($world['organization'], $world['admin']);

        Sanctum::actingAs($world['admin']);
        $response = $this->post('/api/financial-reports/'.$report->id.'/submit', [
            'supporting_documents' => [UploadedFile::fake()->createWithContent('receipts.pdf', '%PDF-1.4 receipts')],
        ])->assertOk();

        $stored = $report->fresh()->supporting_documents[0];
        Storage::disk('local')->assertExists($stored['path']);
        $this->assertStringStartsWith('financial-reports/'.$world['organization']->id.'/', $stored['path']);
        $this->assertSame([], Storage::disk('public')->allFiles());
        $this->assertArrayNotHasKey('url', $stored);

        $document = $response->json('supporting_documents.0');
        $this->assertSame(['index', 'mime_type', 'name', 'open_url', 'size'], collect($document)->keys()->sort()->values()->all());
        $this->assertSame('receipts.pdf', $document['name']);
        $this->assertSame('/financial-reports/'.$report->id.'/documents/0', $document['open_url']);
        $this->assertStringNotContainsString($stored['path'], $response->getContent());
        $this->assertStringNotContainsString('/storage/', $response->getContent());

        $this->getJson('/api/financial-reports/'.$report->id)->assertOk()
            ->assertJsonPath('report.supporting_documents.0.open_url', $document['open_url'])
            ->assertJsonMissingPath('report.supporting_documents.0.path')
            ->assertJsonMissingPath('report.supporting_documents.0.url');
        $this->getJson('/api/financial-reports')->assertOk()
            ->assertJsonPath('data.0.supporting_documents.0.open_url', $document['open_url'])
            ->assertJsonMissingPath('data.0.supporting_documents.0.path');
    }

    public function test_legacy_public_urls_are_no_longer_emitted_by_any_report_payload(): void
    {
        $world = $this->world();
        $path = 'financial-reports/'.$world['organization']->id.'/legacy.pdf';
        $report = $this->draftReport($world['organization'], $world['admin'], [
            'submission_status' => 'pending_department_head',
            'submitted_at' => now(),
            'supporting_documents' => [['name' => 'legacy.pdf', 'path' => $path, 'url' => Storage::disk('public')->url($path), 'mime_type' => 'application/pdf', 'size' => 10]],
        ]);
        ApprovalRequest::create([
            'organization_id' => $world['organization']->id, 'entity_type' => 'financial_report', 'entity_id' => $report->id,
            'requested_by' => $world['admin']->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending', 'requested_at' => now(),
        ]);

        Sanctum::actingAs($world['head']);
        foreach (['/api/financial-reports/'.$report->id, '/api/financial-reports', '/api/approval-requests'] as $uri) {
            $content = str_replace('\\/', '/', $this->getJson($uri)->assertOk()->getContent());
            $this->assertStringNotContainsString($path, $content, $uri);
            $this->assertStringNotContainsString('/storage/', $content, $uri);
            $this->assertStringContainsString('/financial-reports/'.$report->id.'/documents/0', $content, $uri);
        }
    }

    public function test_document_route_refuses_unauthenticated_requests_and_other_organizations(): void
    {
        $world = $this->world();
        $report = $this->submittedReportWithDocument($world);

        $this->app['auth']->forgetGuards();
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/0')->assertUnauthorized();

        $this->actingAsFresh($world['otherAdmin']);
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/0')->assertNotFound();
    }

    public function test_owner_admin_streams_the_document_inline_without_caching(): void
    {
        $world = $this->world();
        $report = $this->submittedReportWithDocument($world);

        $response = $this->get('/api/financial-reports/'.$report->id.'/documents/0')->assertOk();

        $this->assertSame('%PDF-1.4 receipts', file_get_contents($response->baseResponse->getFile()->getPathname()));
        $this->assertStringStartsWith('inline;', $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('private', $response->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
    }

    public function test_head_of_the_same_college_reads_the_document_once_the_report_is_submitted_but_another_college_cannot(): void
    {
        $world = $this->world();
        $report = $this->submittedReportWithDocument($world);
        $report->update(['submitted_at' => null]);

        $this->actingAsFresh($world['head']);
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/0')->assertNotFound();

        $report->update(['submitted_at' => now()]);
        $this->get('/api/financial-reports/'.$report->id.'/documents/0')->assertOk();

        $this->actingAsFresh($world['otherHead']);
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/0')->assertNotFound();
    }

    public function test_sao_reads_the_document_only_after_the_department_head_approved_the_report(): void
    {
        $world = $this->world();
        $report = $this->submittedReportWithDocument($world);

        $this->actingAsFresh($world['director']);
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/0')->assertNotFound();

        $report->update(['department_head_approved_at' => now(), 'department_head_approved_by' => $world['head']->school_id, 'submission_status' => 'pending_sao']);
        $this->get('/api/financial-reports/'.$report->id.'/documents/0')->assertOk();
    }

    public function test_missing_unsafe_and_malformed_document_requests_return_not_found(): void
    {
        $world = $this->world();
        $report = $this->submittedReportWithDocument($world);
        $unsafe = $this->draftReport($world['organization'], $world['admin'], [
            'supporting_documents' => [['name' => 'x.pdf', 'path' => 'financial-reports/1/../../.env', 'mime_type' => 'application/pdf', 'size' => 1]],
        ]);
        $absent = $this->draftReport($world['organization'], $world['admin'], [
            'supporting_documents' => [['name' => 'gone.pdf', 'path' => 'financial-reports/'.$world['organization']->id.'/gone.pdf', 'mime_type' => 'application/pdf', 'size' => 1]],
        ]);

        $this->actingAsFresh($world['admin']);
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/1')->assertNotFound();
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/first')->assertNotFound();
        $this->getJson('/api/financial-reports/'.$unsafe->id.'/documents/0')->assertNotFound();
        $this->getJson('/api/financial-reports/'.$absent->id.'/documents/0')->assertNotFound();
    }

    public function test_an_oversized_document_index_returns_not_found_instead_of_failing(): void
    {
        $world = $this->world();
        $report = $this->submittedReportWithDocument($world);
        $this->actingAsFresh($world['admin']);

        $this->getJson('/api/financial-reports/'.$report->id.'/documents/99999999999999999999')->assertNotFound();
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/9999999')->assertNotFound();
        $this->get('/api/financial-reports/'.$report->id.'/documents/0')->assertOk();
    }

    public function test_secure_documents_command_moves_public_files_to_the_private_disk_and_is_idempotent(): void
    {
        $world = $this->world();
        $organizationId = $world['organization']->id;
        $path = 'financial-reports/'.$organizationId.'/legacy.pdf';
        $missingPath = 'financial-reports/'.$organizationId.'/lost.pdf';
        Storage::disk('public')->put($path, '%PDF-1.4 legacy');
        $report = $this->draftReport($world['organization'], $world['admin'], [
            'submission_status' => 'pending_department_head',
            'submitted_at' => now(),
            'supporting_documents' => [
                ['name' => 'legacy.pdf', 'path' => $path, 'url' => Storage::disk('public')->url($path), 'mime_type' => 'application/pdf', 'size' => 15],
                ['name' => 'lost.pdf', 'path' => $missingPath, 'url' => Storage::disk('public')->url($missingPath), 'mime_type' => 'application/pdf', 'size' => 1],
            ],
        ]);
        $untouched = $this->draftReport($world['organization'], $world['admin']);

        $this->artisan('financial-reports:secure-documents')
            ->expectsOutputToContain('Moved 1 document(s)')
            ->assertSuccessful();

        Storage::disk('public')->assertMissing($path);
        $this->assertSame('%PDF-1.4 legacy', Storage::disk('local')->get($path));
        $documents = $report->fresh()->supporting_documents;
        $this->assertArrayNotHasKey('url', $documents[0]);
        $this->assertSame($path, $documents[0]['path']);
        $this->assertSame($missingPath, $documents[1]['path']);
        $this->assertNull($untouched->fresh()->supporting_documents);

        $before = $report->fresh()->supporting_documents;
        $this->artisan('financial-reports:secure-documents')
            ->expectsOutputToContain('Moved 0 document(s)')
            ->assertSuccessful();
        $this->assertSame($before, $report->fresh()->supporting_documents);
        $this->assertSame('%PDF-1.4 legacy', Storage::disk('local')->get($path));

        $this->actingAsFresh($world['admin']);
        $this->get('/api/financial-reports/'.$report->id.'/documents/0')->assertOk();
        $this->getJson('/api/financial-reports/'.$report->id.'/documents/1')->assertNotFound();
    }
}
