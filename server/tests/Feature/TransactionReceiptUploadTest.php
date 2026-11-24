<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The official receipt of an expense is attached when the entry is recorded and can be replaced when it is edited.
 * It lives on the private disk under the organization's folder, and the API never says where.
 */
class TransactionReceiptUploadTest extends TestCase
{
    use RefreshDatabase;

    private const TYPE_MESSAGE = 'Attach the official receipt as a JPG, PNG, WEBP or PDF up to 5 MB.';

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
        $this->organization = Organization::factory()->create();
        SboPosition::create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->admin);
    }

    private function body(array $overrides = []): array
    {
        return ['type' => 'expense', 'amount' => '120.00', 'category' => 'Supplies', 'description' => 'Printing', 'transaction_date' => now()->toDateString(), ...$overrides];
    }

    private function pdf(string $name = 'receipt.pdf', int $kilobytes = 40): UploadedFile
    {
        return UploadedFile::fake()->create($name, $kilobytes, 'application/pdf');
    }

    private function keptFiles(): array
    {
        return collect(Storage::disk('local')->allFiles())->filter(fn (string $path) => str_starts_with($path, 'finance-receipts/'))->values()->all();
    }

    private function record(array $overrides = []): Transaction
    {
        return Transaction::findOrFail($this->post('/api/transactions', $this->body($overrides), ['Accept' => 'application/json'])->assertCreated()->json('id'));
    }

    public function test_an_expense_needs_the_official_receipt(): void
    {
        $this->postJson('/api/transactions', $this->body())
            ->assertStatus(422)
            ->assertJsonPath('errors.receipt_file.0', 'Attach the official receipt for this expense.');

        $this->assertSame(0, Transaction::count());
    }

    public function test_an_income_does_not_need_one(): void
    {
        $this->postJson('/api/transactions', $this->body(['type' => 'income', 'category' => 'Dues']))->assertCreated()->assertJsonPath('has_receipt_file', false);
    }

    public function test_the_receipt_is_kept_privately_under_the_organization_and_never_named_in_the_response(): void
    {
        $response = $this->post('/api/transactions', $this->body(['receipt_file' => $this->pdf()]), ['Accept' => 'application/json'])->assertCreated();

        $entry = Transaction::findOrFail($response->json('id'));
        $this->assertStringStartsWith('finance-receipts/'.$this->organization->id.'/', $entry->receipt_file_url);
        $this->assertStringEndsWith('.pdf', $entry->receipt_file_url);
        Storage::disk('local')->assertExists($entry->receipt_file_url);
        $this->assertSame([], Storage::disk('public')->allFiles());
        $response->assertJsonPath('has_receipt_file', true)->assertJsonPath('receipt_file_open_url', "/transactions/{$entry->id}/receipt-file");
        $this->assertArrayNotHasKey('receipt_file_url', $response->json());
        $row = collect($this->getJson('/api/transactions')->json('data'))->firstWhere('id', $entry->id);
        $this->assertArrayNotHasKey('receipt_file_url', $row);
        $this->assertStringNotContainsString('finance-receipts', $this->getJson('/api/financial-dashboard')->getContent());
        $this->getJson("/api/transactions/{$entry->id}/receipt-file")->assertOk()->assertHeader('Content-Type', 'application/pdf');
    }

    public function test_pictures_are_accepted_and_open_with_their_own_type(): void
    {
        foreach (['receipt.jpg' => 'image/jpeg', 'receipt.png' => 'image/png', 'receipt.webp' => 'image/webp'] as $name => $type) {
            $entry = $this->record(['receipt_file' => UploadedFile::fake()->image($name, 200, 300)]);
            $this->getJson("/api/transactions/{$entry->id}/receipt-file")->assertOk()->assertHeader('Content-Type', $type);
        }
    }

    public function test_other_kinds_of_file_and_files_over_five_megabytes_are_refused_with_the_message(): void
    {
        foreach ([
            UploadedFile::fake()->create('receipt.txt', 5, 'text/plain'),
            UploadedFile::fake()->create('receipt.exe', 5, 'application/octet-stream'),
            UploadedFile::fake()->create('receipt.gif', 5, 'image/gif'),
            $this->pdf('big.pdf', 5121),
        ] as $file) {
            $this->post('/api/transactions', $this->body(['receipt_file' => $file]), ['Accept' => 'application/json'])
                ->assertStatus(422)->assertJsonPath('errors.receipt_file.0', self::TYPE_MESSAGE);
        }

        $this->assertSame(0, Transaction::count());
        $this->assertSame([], $this->keptFiles());
    }

    public function test_the_largest_allowed_file_is_accepted(): void
    {
        $this->post('/api/transactions', $this->body(['receipt_file' => $this->pdf('largest.pdf', 5120)]), ['Accept' => 'application/json'])->assertCreated();

        $this->assertCount(1, $this->keptFiles());
    }

    public function test_a_typed_path_does_not_stand_in_for_the_receipt(): void
    {
        $other = Organization::factory()->create();
        Storage::disk('local')->put('finance-receipts/'.$other->id.'/someone-elses.pdf', 'x');
        Storage::disk('local')->put('finance-receipts/'.$this->organization->id.'/real.pdf', 'x');

        foreach (['finance-receipts/'.$other->id.'/someone-elses.pdf', 'finance-receipts/'.$this->organization->id.'/missing.pdf', '/storage/receipts/made-up.pdf', 'finance-receipts/'.$this->organization->id.'/../'.$other->id.'/someone-elses.pdf'] as $path) {
            $this->postJson('/api/transactions', $this->body(['receipt_file_url' => $path]))
                ->assertStatus(422)->assertJsonPath('errors.receipt_file.0', 'Attach the official receipt for this expense.');
        }

        $this->postJson('/api/transactions', $this->body(['receipt_file_url' => 'finance-receipts/'.$this->organization->id.'/real.pdf']))->assertCreated();
    }

    public function test_editing_can_replace_the_file_and_the_old_one_goes_after_the_commit(): void
    {
        $entry = $this->record(['receipt_file' => $this->pdf()]);
        $old = $entry->receipt_file_url;

        $response = $this->post("/api/transactions/{$entry->id}", ['_method' => 'PUT', 'edit_reason' => 'The first photo was blurred', 'receipt_file' => $this->pdf('clear.pdf')], ['Accept' => 'application/json'])->assertOk();

        $new = $entry->fresh()->receipt_file_url;
        $this->assertNotSame($old, $new);
        Storage::disk('local')->assertExists($new);
        Storage::disk('local')->assertMissing($old);
        $this->assertSame([$new], $this->keptFiles());
        $this->assertSame(1, $entry->fresh()->edit_count);
        $this->assertArrayNotHasKey('receipt_file_url', $response->json());
        $audit = AuditLog::where('action', 'updated')->where('record_id', $entry->id)->firstOrFail();
        $this->assertSame(['receipt_file'], $audit->new_values['changed_fields']);
        $this->assertStringNotContainsString('finance-receipts', json_encode($audit->old_values).json_encode($audit->new_values));
        $changes = $this->getJson("/api/transactions/{$entry->id}/history")->json('data.0.changes');
        $this->assertSame([['field' => 'receipt_file', 'label' => 'Official receipt file', 'from' => 'Previous file', 'to' => 'Replacement file']], $changes);
    }

    public function test_adding_a_file_to_an_entry_that_had_none_reads_as_a_file_attached(): void
    {
        $entry = $this->record(['type' => 'income', 'category' => 'Dues']);

        $this->post("/api/transactions/{$entry->id}", ['_method' => 'PUT', 'edit_reason' => 'Found the receipt book', 'receipt_file' => $this->pdf()], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('has_receipt_file', true);

        $this->assertSame([['field' => 'receipt_file', 'label' => 'Official receipt file', 'from' => 'None', 'to' => 'File attached']], $this->getJson("/api/transactions/{$entry->id}/history")->json('data.0.changes'));
    }

    public function test_the_old_file_stays_while_another_entry_still_points_at_it(): void
    {
        $entry = $this->record(['receipt_file' => $this->pdf()]);
        $shared = $entry->receipt_file_url;
        Transaction::create([
            'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->school_id, 'type' => 'expense', 'category' => 'Supplies',
            'amount' => 10, 'description' => 'Same receipt', 'transaction_date' => now(), 'receipt_file_url' => $shared,
        ]);

        $this->post("/api/transactions/{$entry->id}", ['_method' => 'PUT', 'edit_reason' => 'Replacing the picture', 'receipt_file' => $this->pdf('other.pdf')], ['Accept' => 'application/json'])->assertOk();

        Storage::disk('local')->assertExists($shared);
    }

    public function test_an_edit_that_does_not_save_leaves_no_stray_file(): void
    {
        $entry = $this->record(['receipt_file' => $this->pdf()]);
        $this->patchJson("/api/transactions/{$entry->id}/archive", ['reason' => 'Entered twice'])->assertOk();
        $before = $this->keptFiles();

        $this->post("/api/transactions/{$entry->id}", ['_method' => 'PUT', 'edit_reason' => 'Trying to replace it', 'receipt_file' => $this->pdf('late.pdf')], ['Accept' => 'application/json'])->assertStatus(409);
        $this->assertSame($before, $this->keptFiles());

        $open = $this->record(['receipt_file' => $this->pdf()]);
        $before = $this->keptFiles();
        $this->post("/api/transactions/{$open->id}", ['_method' => 'PUT', 'edit_reason' => 'x', 'receipt_file' => $this->pdf('short.pdf')], ['Accept' => 'application/json'])->assertStatus(422);
        $this->assertSame($before, $this->keptFiles());
    }

    public function test_a_bad_replacement_file_is_refused_and_the_old_one_stays(): void
    {
        $entry = $this->record(['receipt_file' => $this->pdf()]);
        $old = $entry->receipt_file_url;

        $this->post("/api/transactions/{$entry->id}", ['_method' => 'PUT', 'edit_reason' => 'Replacing the file', 'receipt_file' => UploadedFile::fake()->create('notes.txt', 3, 'text/plain')], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonPath('errors.receipt_file.0', self::TYPE_MESSAGE);

        $this->assertSame($old, $entry->fresh()->receipt_file_url);
        Storage::disk('local')->assertExists($old);
    }

    public function test_a_typed_path_is_not_taken_on_an_edit(): void
    {
        $entry = $this->record(['receipt_file' => $this->pdf()]);
        $old = $entry->receipt_file_url;
        Storage::disk('local')->put('finance-receipts/'.$this->organization->id.'/swap.pdf', 'x');

        $this->putJson("/api/transactions/{$entry->id}", ['receipt_file_url' => 'finance-receipts/'.$this->organization->id.'/swap.pdf', 'edit_reason' => 'Swapping the file'])
            ->assertStatus(422)->assertJsonPath('message', 'Nothing changed.');

        $this->assertSame($old, $entry->fresh()->receipt_file_url);
    }

    public function test_the_receipt_file_opens_for_the_head_but_not_across_organizations_or_for_students(): void
    {
        $entry = $this->record(['receipt_file' => $this->pdf()]);

        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => $this->organization->id]));
        $this->getJson("/api/transactions/{$entry->id}/receipt-file")->assertOk();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));
        $this->getJson("/api/transactions/{$entry->id}/receipt-file")->assertNotFound();
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $this->organization->id]));
        $this->getJson("/api/transactions/{$entry->id}/receipt-file")->assertForbidden();
    }
}
