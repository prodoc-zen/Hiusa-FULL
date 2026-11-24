<?php

namespace Tests\Feature;

use App\Models\AiConversation;
use App\Models\AiMessage;
use App\Models\AiMessageAttachment;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\ClaudeMessagesService;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Psr\Http\Message\RequestInterface;
use Tests\TestCase;

/**
 * A file attached to an Ask AI question: validation, private storage, owner-only opening, what Claude is sent, the
 * guard on numbers that come from the file, the Record expense card and the conversation delete.
 */
class AskAiAttachmentsTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<int, array{request: RequestInterface}> */
    private array $history = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic' => ['key' => 'test-anthropic-key', 'model' => 'claude-sonnet-5-5', 'effort' => 'low', 'timeout' => 8, 'connect_timeout' => 3]]);
        RateLimiter::for('ai-generation', fn () => Limit::none());
        $this->history = [];
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function admin(?Organization $org = null): User
    {
        return User::factory()->admin()->create(['organization_id' => ($org ?? Organization::factory()->create())->id]);
    }

    private function student(): User
    {
        return User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
    }

    /** Claude answers with these responses, in order; every request it receives is kept in $this->history. */
    private function claude(array $responses): void
    {
        $stack = HandlerStack::create(new MockHandler($responses));
        $stack->push(Middleware::history($this->history));
        $this->app->instance(ClaudeMessagesService::class, new ClaudeMessagesService(new Client(['handler' => $stack])));
    }

    private function jsonMessage(array $data): Response
    {
        return new Response(200, ['content-type' => 'application/json'], json_encode([
            'id' => 'msg_test_1', 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-sonnet-5-5',
            'content' => [['type' => 'text', 'text' => json_encode($data)]],
            'stop_reason' => 'end_turn', 'stop_sequence' => null, 'usage' => ['input_tokens' => 12, 'output_tokens' => 34],
        ]));
    }

    private function streamed(string $text): Response
    {
        $event = fn (string $name, array $data) => "event: {$name}\ndata: ".json_encode(['type' => $name] + $data)."\n\n";
        $body = $event('message_start', ['message' => ['id' => 'msg_stream_1', 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-sonnet-5-5', 'content' => [], 'stop_reason' => null, 'stop_sequence' => null, 'usage' => ['input_tokens' => 12, 'output_tokens' => 1]]])
            .$event('content_block_start', ['index' => 0, 'content_block' => ['type' => 'text', 'text' => '']])
            .$event('content_block_delta', ['index' => 0, 'delta' => ['type' => 'text_delta', 'text' => $text]])
            .$event('content_block_stop', ['index' => 0])
            .$event('message_delta', ['delta' => ['stop_reason' => 'end_turn', 'stop_sequence' => null], 'usage' => ['output_tokens' => 34]])
            .$event('message_stop', []);

        return new Response(200, ['content-type' => 'text/event-stream'], $body);
    }

    /** What Claude reads from a receipt. */
    private function receipt(array $over = []): array
    {
        return array_replace([
            'is_receipt' => true,
            'amount' => 1250.0,
            'date' => '2026-11-20',
            'payee_or_description' => 'Mercury Drug',
            'suggested_category' => 'Operations',
            'summary' => 'A pharmacy receipt for first aid supplies.',
            'figures' => [['label' => 'Items', 'value' => '3'], ['label' => 'VAT', 'value' => '133.93']],
            'confidence_notes' => 'Everything was clear.',
        ], $over);
    }

    private function jpeg(string $name = 'receipt.jpg', int $kilobytes = 40): UploadedFile
    {
        return UploadedFile::fake()->create($name, $kilobytes, 'image/jpeg');
    }

    private function send(array $body)
    {
        return $this->post('/api/ai/assistant/chat', $body, ['Accept' => 'application/json']);
    }

    private function requestBody(int $index): array
    {
        return json_decode((string) $this->history[$index]['request']->getBody(), true);
    }

    // -------------------------------------------------------------------------
    // Validation and storage
    // -------------------------------------------------------------------------

    public function test_a_file_of_the_wrong_type_or_over_five_megabytes_is_refused_and_nothing_is_stored(): void
    {
        $this->claude([]);
        Sanctum::actingAs($this->admin());

        $text = $this->send(['message' => 'Read this', 'source' => 'typed', 'attachment' => UploadedFile::fake()->create('notes.txt', 10, 'text/plain')]);
        $text->assertStatus(422)->assertJsonValidationErrors('attachment');
        $this->assertSame('Attach a JPG, PNG or WebP photo, or a PDF.', $text->json('message'));

        // The real content decides, not the name: a script that is called photo.jpg is still refused.
        $script = tempnam(sys_get_temp_dir(), 'askai');
        file_put_contents($script, '<?php echo 1;');
        $renamed = $this->send(['message' => 'Read this', 'source' => 'typed', 'attachment' => new UploadedFile($script, 'photo.jpg', 'image/jpeg', null, true)]);
        $renamed->assertStatus(422)->assertJsonValidationErrors('attachment');

        $big = $this->send(['message' => 'Read this', 'source' => 'typed', 'attachment' => $this->jpeg('big.jpg', 5121)]);
        $big->assertStatus(422)->assertJsonValidationErrors('attachment');
        $this->assertSame('That file is over 5 MB. Choose a smaller one.', $big->json('message'));

        $this->assertSame(0, AiConversation::count());
        $this->assertSame(0, AiMessageAttachment::count());
        $this->assertSame([], Storage::disk('local')->allFiles());
        $this->assertCount(0, $this->history);
    }

    public function test_a_file_of_exactly_five_megabytes_and_each_allowed_type_is_accepted(): void
    {
        Sanctum::actingAs($this->admin());

        foreach ([['a.jpg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp'], ['a.pdf', 'application/pdf']] as [$name, $mime]) {
            $this->claude([]);
            $this->send(['message' => 'Read this', 'source' => 'typed', 'attachment' => UploadedFile::fake()->create($name, 5120, $mime)])->assertOk();
        }

        $this->assertSame(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], AiMessageAttachment::orderBy('id')->pluck('mime_type')->all());
    }

    public function test_the_file_is_kept_on_the_private_disk_under_the_owners_school_id_and_never_on_the_public_disk(): void
    {
        $this->claude([new Response(500)]);
        $user = $this->student();
        Sanctum::actingAs($user);

        $response = $this->send(['message' => 'What is this?', 'source' => 'typed', 'attachment' => $this->jpeg('my receipt.jpg')])->assertOk();

        $attachment = AiMessageAttachment::firstOrFail();
        $this->assertSame($user->school_id, $attachment->user_id);
        $this->assertSame('local', $attachment->disk);
        $this->assertStringStartsWith('ai-attachments/'.$user->school_id.'/', $attachment->path);
        $this->assertStringEndsWith('.jpg', $attachment->path);
        $this->assertStringNotContainsString('receipt', $attachment->path);
        Storage::disk('local')->assertExists($attachment->path);
        $this->assertSame([], Storage::disk('public')->allFiles());
        $this->assertSame('my receipt.jpg', $attachment->original_name);

        $shown = $response->json('user_message.attachment');
        $this->assertSame(['id', 'mime_type', 'name', 'open_url', 'size_bytes'], collect(array_keys($shown))->sort()->values()->all());
        $this->assertSame('/ai/assistant/attachments/'.$attachment->id, $shown['open_url']);
        $this->assertStringNotContainsString('ai-attachments', json_encode($response->json()));
    }

    public function test_a_file_can_stand_in_for_the_words_of_the_question(): void
    {
        $this->claude([new Response(500)]);
        Sanctum::actingAs($this->student());

        $response = $this->send(['source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        $this->assertSame('Please read the attached file.', AiMessage::where('role', 'user')->firstOrFail()->content);
        $this->assertNotNull($response->json('user_message.attachment.id'));
    }

    // -------------------------------------------------------------------------
    // Owner-only open
    // -------------------------------------------------------------------------

    public function test_only_the_owner_can_open_the_file_and_everyone_else_gets_not_found(): void
    {
        $this->claude([new Response(500)]);
        $owner = $this->student();
        Sanctum::actingAs($owner);
        $this->send(['message' => 'What is this?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();
        $url = '/api/ai/assistant/attachments/'.AiMessageAttachment::firstOrFail()->id;

        $opened = $this->get($url)->assertOk();
        $this->assertSame('image/jpeg', $opened->headers->get('Content-Type'));
        $this->assertStringContainsString('no-store', (string) $opened->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $opened->headers->get('X-Content-Type-Options'));

        foreach ([$this->student(), $this->admin(), User::factory()->superAdmin()->create()] as $other) {
            Sanctum::actingAs($other);
            $this->getJson($url)->assertNotFound();
        }

        $this->app['auth']->forgetGuards();
        $this->getJson($url)->assertUnauthorized();
    }

    // -------------------------------------------------------------------------
    // What Claude is sent
    // -------------------------------------------------------------------------

    public function test_claude_receives_the_file_as_an_image_block_in_the_extraction_and_in_the_answer(): void
    {
        $this->claude([$this->jsonMessage($this->receipt()), $this->streamed('The receipt is from Mercury Drug.')]);
        Sanctum::actingAs($this->student());
        $upload = UploadedFile::fake()->createWithContent('r.png', "\x89PNG\r\n\x1a\nfake-image-bytes");

        $this->send(['message' => 'Who is this receipt from?', 'source' => 'typed', 'attachment' => $upload])->assertOk();

        $this->assertCount(2, $this->history);
        foreach ([0, 1] as $call) {
            $content = $this->requestBody($call)['messages'][array_key_last($this->requestBody($call)['messages'])]['content'];
            $this->assertSame('image', $content[0]['type']);
            $this->assertSame(['type' => 'base64', 'media_type' => 'image/png', 'data' => base64_encode("\x89PNG\r\n\x1a\nfake-image-bytes")], $content[0]['source']);
            $this->assertSame('text', $content[1]['type']);
        }
        $this->assertArrayHasKey('output_config', $this->requestBody(0));
    }

    public function test_a_pdf_goes_to_claude_as_a_document_block(): void
    {
        $this->claude([$this->jsonMessage($this->receipt(['is_receipt' => false])), $this->streamed('It is a PDF.')]);
        Sanctum::actingAs($this->student());

        $this->send(['message' => 'What is this?', 'source' => 'typed', 'attachment' => UploadedFile::fake()->createWithContent('r.pdf', '%PDF-1.4 fake')])->assertOk();

        $content = $this->requestBody(0)['messages'][0]['content'];
        $this->assertSame('document', $content[0]['type']);
        $this->assertSame(['type' => 'base64', 'media_type' => 'application/pdf', 'data' => base64_encode('%PDF-1.4 fake')], $content[0]['source']);
    }

    public function test_a_question_without_a_file_sends_claude_no_content_block(): void
    {
        $service = $this->claudeService([$this->streamed('Hello.')]);

        $service->converse('Be brief.', [['role' => 'user', 'content' => 'Hi']]);

        $this->assertSame('Hi', $this->requestBody(0)['messages'][0]['content']);
    }

    public function test_groq_is_never_called_when_a_file_is_attached_and_claude_does_not_answer(): void
    {
        config(['services.groq.key' => 'test-groq-key']);
        Http::fake();
        $this->claude([new Response(500)]);
        Sanctum::actingAs($this->admin());

        $response = $this->send(['message' => 'Record this receipt', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        Http::assertNothingSent();
        $this->assertSame('I could not read that file right now, so nothing was saved. Try again in a moment.', $response->json('message.content'));
        $this->assertArrayNotHasKey('action', $response->json('message.payload'));
        $this->assertSame(0, Transaction::count());
    }

    public function test_groq_is_never_called_when_claude_reads_the_file_but_does_not_finish_the_answer(): void
    {
        config(['services.groq.key' => 'test-groq-key']);
        Http::fake();
        $this->claude([$this->jsonMessage($this->receipt()), new Response(500)]);
        Sanctum::actingAs($this->student());

        $response = $this->send(['message' => 'How much is this?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        Http::assertNothingSent();
        $this->assertSame('I could not read that file right now, so nothing was saved. Try again in a moment.', $response->json('message.content'));
        $this->assertSame('records', $response->json('message.payload.engine'));
    }

    public function test_without_a_claude_key_the_answer_says_the_file_could_not_be_read_and_calls_nothing(): void
    {
        config(['services.anthropic.key' => '', 'services.groq.key' => 'test-groq-key']);
        Http::fake();
        Sanctum::actingAs($this->student());

        $response = $this->send(['message' => 'What is this?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        Http::assertNothingSent();
        $this->assertStringContainsString('nothing was saved', $response->json('message.content'));
    }

    // -------------------------------------------------------------------------
    // The numeric guard
    // -------------------------------------------------------------------------

    public function test_a_number_the_model_read_from_the_file_is_kept_in_the_answer(): void
    {
        $this->claude([$this->jsonMessage($this->receipt()), $this->streamed('You paid PHP 1,250.00 at Mercury Drug on November 20, 2026, and the receipt lists 3 items with VAT of 133.93.')]);
        Sanctum::actingAs($this->student());

        $response = $this->send(['message' => 'What does this receipt say?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        $this->assertStringContainsString('PHP 1,250.00', $response->json('message.content'));
        $this->assertSame('claude', $response->json('message.payload.engine'));
        $this->assertTrue($response->json('message.payload.model_written'));
        $this->assertNull($response->json('message.payload.notice'));
        $this->assertArrayNotHasKey('action', $response->json('message.payload'));
    }

    public function test_a_number_that_is_not_on_the_file_is_still_blocked(): void
    {
        $this->claude([$this->jsonMessage($this->receipt()), $this->streamed('You paid PHP 9,999.00 at Mercury Drug.')]);
        Sanctum::actingAs($this->student());

        $response = $this->send(['message' => 'What does this receipt say?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        $this->assertStringNotContainsString('9,999', $response->json('message.content'));
        $this->assertStringContainsString('PHP 1,250.00', $response->json('message.content'));
        $this->assertSame('The written answer was replaced with the verified summary.', $response->json('message.payload.notice'));
        $this->assertFalse($response->json('message.payload.model_written'));
    }

    // -------------------------------------------------------------------------
    // The Record expense card
    // -------------------------------------------------------------------------

    public function test_an_admin_gets_a_record_expense_card_with_the_values_read_and_the_receipt_attached(): void
    {
        $this->claude([$this->jsonMessage($this->receipt())]);
        Sanctum::actingAs($this->admin());

        $response = $this->send(['message' => 'Record this receipt', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        $action = $response->json('message.payload.action');
        $this->assertSame('record_expense', $action['key']);
        $this->assertSame('Record expense', $action['title']);
        $this->assertSame('Record expense', $action['submit_label']);
        $this->assertSame('awaiting_confirmation', $action['status']);
        $this->assertSame('receipt', $action['read_from']);
        $this->assertSame(['amount', 'transaction_date', 'description', 'category'], array_column($action['fields'], 'name'));
        $this->assertSame(['1250.00', '2026-11-20', 'Mercury Drug', 'Operations'], array_column($action['fields'], 'value'));
        $this->assertSame(['number', 'date', 'text', 'select'], array_column($action['fields'], 'type'));
        $this->assertSame(['Operations', 'Events', 'Elections', 'Merchandise', 'General'], array_column($action['fields'][3]['options'], 'value'));
        $this->assertSame(['name' => 'receipt.jpg', 'open_url' => '/ai/assistant/attachments/'.AiMessageAttachment::firstOrFail()->id], $action['receipt']);
        $this->assertArrayNotHasKey('attachment', $action);
        $this->assertStringContainsString('These values were read from the receipt and must be checked.', $response->json('message.content'));
        $this->assertSame(0, Transaction::count());
    }

    public function test_what_the_model_could_not_read_stays_empty_and_an_unlisted_category_is_dropped(): void
    {
        $this->claude([$this->jsonMessage($this->receipt(['amount' => null, 'date' => '2026-02-31', 'payee_or_description' => null, 'suggested_category' => 'Snacks']))]);
        Sanctum::actingAs($this->admin());

        $response = $this->send(['message' => 'Record this receipt', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        $this->assertSame([null, null, null, null], array_column($response->json('message.payload.action.fields'), 'value'));
    }

    public function test_a_file_that_is_not_a_receipt_gets_an_answer_and_no_card_even_for_an_admin(): void
    {
        $this->claude([$this->jsonMessage($this->receipt(['is_receipt' => false, 'amount' => null, 'date' => null, 'summary' => 'A poster for an event.', 'figures' => []])), $this->streamed('This is a poster for an event.')]);
        Sanctum::actingAs($this->admin());

        $response = $this->send(['message' => 'What is this?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        $this->assertArrayNotHasKey('action', $response->json('message.payload'));
        $this->assertSame('This is a poster for an event.', $response->json('message.content'));
    }

    public function test_a_student_gets_the_extraction_as_text_and_no_card(): void
    {
        $this->claude([$this->jsonMessage($this->receipt()), $this->streamed('It is a receipt from Mercury Drug for PHP 1,250.00.')]);
        Sanctum::actingAs($this->student());

        $response = $this->send(['message' => 'Record this receipt', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        $this->assertArrayNotHasKey('action', $response->json('message.payload'));
        $this->assertStringContainsString('PHP 1,250.00', $response->json('message.content'));
        $this->assertSame(0, Transaction::count());
    }

    public function test_confirming_the_card_records_the_expense_through_the_transactions_route_with_the_receipt(): void
    {
        $org = Organization::factory()->create();
        $admin = $this->admin($org);
        $this->claude([$this->jsonMessage($this->receipt())]);
        Sanctum::actingAs($admin);
        $card = $this->send(['message' => 'Record this receipt', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk()->json('message');
        $attachment = AiMessageAttachment::firstOrFail();

        $done = $this->postJson("/api/ai/assistant/messages/{$card['id']}/action/confirm", ['fields' => [
            'amount' => '1,300.50', 'transaction_date' => '2026-11-21', 'description' => 'Mercury Drug first aid kit', 'category' => 'Events',
        ]])->assertOk();

        $this->assertSame('done', $done->json('message.payload.action.status'));
        $this->assertSame(['name' => 'receipt.jpg', 'open_url' => '/ai/assistant/attachments/'.$attachment->id], $done->json('message.payload.action.receipt'));
        $transaction = Transaction::firstOrFail();
        $this->assertSame('expense', $transaction->type);
        $this->assertEquals(1300.50, $transaction->amount);
        $this->assertSame('Events', $transaction->category);
        $this->assertSame('Mercury Drug first aid kit', $transaction->description);
        $this->assertSame('2026-11-21', $transaction->transaction_date->format('Y-m-d'));
        $this->assertSame($org->id, $transaction->organization_id);
        $this->assertSame($admin->id, $transaction->recorded_by);
        $this->assertNotNull($transaction->receipt_reference);
        $this->assertTrue(AuditLog::where('module', 'financial_ledger')->where('action', 'created')->where('record_id', $transaction->id)->exists());

        $this->assertStringStartsWith('finance-receipts/'.$org->id.'/', $transaction->receipt_file_url);
        Storage::disk('local')->assertExists($transaction->receipt_file_url);
        $this->assertSame([], Storage::disk('public')->allFiles());
        $this->assertSame(Storage::disk('local')->get($attachment->path), Storage::disk('local')->get($transaction->receipt_file_url));

        // The ledger opens the stored receipt for people who can read it, and nobody from another organization.
        $this->getJson("/api/transactions/{$transaction->id}/receipt-file")->assertOk();
        Sanctum::actingAs($this->admin());
        $this->getJson("/api/transactions/{$transaction->id}/receipt-file")->assertNotFound();
        Sanctum::actingAs($this->student());
        $this->getJson("/api/transactions/{$transaction->id}/receipt-file")->assertForbidden();
    }

    public function test_a_refused_confirm_keeps_no_receipt_copy_and_the_card_waits_for_a_fix(): void
    {
        $admin = $this->admin();
        $this->claude([$this->jsonMessage($this->receipt())]);
        Sanctum::actingAs($admin);
        $card = $this->send(['message' => 'Record this receipt', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk()->json('message');

        $this->postJson("/api/ai/assistant/messages/{$card['id']}/action/confirm", ['fields' => [
            'amount' => '0', 'transaction_date' => '2026-11-21', 'description' => 'Mercury Drug', 'category' => 'Events',
        ]])->assertStatus(422);

        $this->assertSame(0, Transaction::count());
        $this->assertSame([], collect(Storage::disk('local')->allFiles())->filter(fn (string $path) => str_starts_with($path, 'finance-receipts/'))->all());
    }

    public function test_a_person_who_lost_the_right_to_write_finance_cannot_confirm_an_old_card(): void
    {
        $admin = $this->admin();
        $this->claude([$this->jsonMessage($this->receipt())]);
        Sanctum::actingAs($admin);
        $card = $this->send(['message' => 'Record this receipt', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk()->json('message');

        $admin->forceFill(['role' => 'STUDENT'])->save();
        Sanctum::actingAs($admin->fresh());

        $this->postJson("/api/ai/assistant/messages/{$card['id']}/action/confirm", ['fields' => ['amount' => '10']])->assertNotFound();
        $this->assertSame(0, Transaction::count());
    }

    // -------------------------------------------------------------------------
    // Regenerate and delete
    // -------------------------------------------------------------------------

    public function test_answering_again_reads_the_same_file_again(): void
    {
        $this->claude([$this->jsonMessage($this->receipt()), $this->streamed('It is from Mercury Drug.'), $this->jsonMessage($this->receipt()), $this->streamed('The shop is Mercury Drug.')]);
        Sanctum::actingAs($this->student());
        $first = $this->send(['message' => 'Who is the shop?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();

        $again = $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $first->json('conversation.id'), 'regenerate' => true])->assertOk();

        $this->assertSame('The shop is Mercury Drug.', $again->json('message.content'));
        $this->assertCount(4, $this->history);
        $this->assertSame('image', $this->requestBody(3)['messages'][0]['content'][0]['type']);
        $this->assertSame(1, AiMessageAttachment::count());
    }

    public function test_deleting_a_conversation_deletes_its_files_and_all_conversations_deletes_all_of_them(): void
    {
        $user = $this->student();
        Sanctum::actingAs($user);
        $paths = [];
        foreach ([1, 2] as $_) {
            $this->claude([new Response(500)]);
            $conversation = $this->send(['message' => 'What is this?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk()->json('conversation.id');
            $paths[$conversation] = AiMessageAttachment::latest('id')->firstOrFail()->path;
        }
        $this->claude([new Response(500)]);
        $this->send(['message' => 'And this?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();
        $third = AiMessageAttachment::latest('id')->firstOrFail()->path;
        foreach ($paths as $path) {
            Storage::disk('local')->assertExists($path);
        }

        $first = array_key_first($paths);
        $this->deleteJson("/api/ai/assistant/conversations/{$first}")->assertOk();

        Storage::disk('local')->assertMissing($paths[$first]);
        Storage::disk('local')->assertExists($paths[array_key_last($paths)]);
        $this->assertSame(2, AiMessageAttachment::count());

        $this->deleteJson('/api/ai/assistant/conversations')->assertOk();

        Storage::disk('local')->assertMissing($paths[array_key_last($paths)]);
        Storage::disk('local')->assertMissing($third);
        $this->assertSame(0, AiMessageAttachment::count());
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_the_receipt_kept_in_the_ledger_survives_deleting_the_conversation(): void
    {
        $this->claude([$this->jsonMessage($this->receipt())]);
        Sanctum::actingAs($this->admin());
        $response = $this->send(['message' => 'Record this receipt', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();
        $this->postJson('/api/ai/assistant/messages/'.$response->json('message.id').'/action/confirm', ['fields' => [
            'amount' => '1250', 'transaction_date' => '2026-11-20', 'description' => 'Mercury Drug', 'category' => 'Operations',
        ]])->assertOk();
        $kept = Transaction::firstOrFail()->receipt_file_url;

        $this->deleteJson('/api/ai/assistant/conversations/'.$response->json('conversation.id'))->assertOk();

        Storage::disk('local')->assertExists($kept);
        $this->assertSame([$kept], Storage::disk('local')->allFiles());
    }

    public function test_the_conversation_lists_the_file_on_the_question_it_came_with(): void
    {
        $this->claude([new Response(500)]);
        Sanctum::actingAs($this->student());
        $first = $this->send(['message' => 'What is this?', 'source' => 'typed', 'attachment' => $this->jpeg('proof.jpg')])->assertOk();

        $shown = $this->getJson('/api/ai/assistant/conversations/'.$first->json('conversation.id'))->assertOk()->json('messages');

        $this->assertSame('proof.jpg', $shown[0]['attachment']['name']);
        $this->assertNull($shown[1]['attachment']);
    }

    public function test_deleting_a_person_from_the_system_deletes_the_files_they_attached(): void
    {
        $this->claude([new Response(500)]);
        $student = $this->student();
        Sanctum::actingAs($student);
        $this->send(['message' => 'What is this?', 'source' => 'typed', 'attachment' => $this->jpeg()])->assertOk();
        $path = AiMessageAttachment::firstOrFail()->path;
        Storage::disk('local')->assertExists($path);

        Sanctum::actingAs(User::factory()->superAdmin()->create());
        $this->deleteJson('/api/system/users/'.$student->school_id, ['school_id' => $student->school_id])->assertOk();

        Storage::disk('local')->assertMissing($path);
        $this->assertSame(0, AiMessageAttachment::count());
    }

    public function test_the_attachments_table_can_be_rolled_back_and_built_again(): void
    {
        $migration = require base_path('database/migrations/2026_11_24_000002_create_ai_message_attachments_table.php');

        $migration->down();
        $this->assertFalse(Schema::hasTable('ai_message_attachments'));

        $migration->up();
        $this->assertTrue(Schema::hasTable('ai_message_attachments'));
        $this->assertTrue(Schema::hasColumns('ai_message_attachments', ['message_id', 'user_id', 'disk', 'path', 'original_name', 'mime_type', 'size_bytes']));
    }

    private function claudeService(array $responses): ClaudeMessagesService
    {
        $stack = HandlerStack::create(new MockHandler($responses));
        $stack->push(Middleware::history($this->history));

        return new ClaudeMessagesService(new Client(['handler' => $stack]));
    }
}
