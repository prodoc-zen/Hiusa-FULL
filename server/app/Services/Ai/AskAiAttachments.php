<?php

namespace App\Services\Ai;

use App\Models\AiMessage;
use App\Models\AiMessageAttachment;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Files attached to an Ask AI question: where they are kept, and how Claude reads them. Only Claude can read a
 * file, so nothing here ever falls back to another writing service; a caller that gets null says so plainly.
 */
class AskAiAttachments
{
    private const DISK = 'local';

    private const EXTENSIONS = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];

    /** A photo or PDF read can take longer than a one-shot text call; this is the most one read may run. */
    private const READ_SECONDS = 30.0;

    private const FIELD_MAX = 255;

    private const FIGURES_MAX = 20;

    /** Stored on the private disk under the owner's school ID, named by a random id and never by what the person called it. */
    public function store(User $user, AiMessage $message, UploadedFile $file): AiMessageAttachment
    {
        $mime = (string) $file->getMimeType();
        $name = (string) Str::uuid().'.'.(self::EXTENSIONS[$mime] ?? 'bin');
        $path = Storage::disk(self::DISK)->putFileAs('ai-attachments/'.$user->school_id, $file, $name);

        return AiMessageAttachment::create([
            'message_id' => $message->id,
            'user_id' => $user->school_id,
            'disk' => self::DISK,
            'path' => $path,
            'original_name' => mb_substr(basename(str_replace('\\', '/', (string) $file->getClientOriginalName())), 0, 255),
            'mime_type' => $mime,
            'size_bytes' => (int) $file->getSize(),
            'created_at' => now(),
        ]);
    }

    /** True when a model that can read a file is set up. */
    public function readerConfigured(): bool
    {
        return trim((string) config('services.anthropic.key')) !== '';
    }

    /** @return null|array{mime: string, data: string} the file as Claude takes it, or null when the bytes are gone */
    public function forModel(AiMessageAttachment $attachment): ?array
    {
        $disk = Storage::disk($attachment->disk);
        if (! $disk->exists($attachment->path)) {
            return null;
        }

        return ['mime' => $attachment->mime_type, 'data' => base64_encode((string) $disk->get($attachment->path))];
    }

    /**
     * What Claude reads from the file, checked in PHP before anyone sees it: an amount that is not a positive number,
     * a date that is not a real day and a category that is not in the list all become null.
     *
     * @param  array<int, string>  $categories
     * @return null|array{is_receipt: bool, amount: ?float, date: ?string, payee_or_description: ?string, suggested_category: ?string, summary: string, figures: array<int, array{label: string, value: string}>, confidence_notes: string}
     */
    public function extract(AiMessageAttachment $attachment, array $categories): ?array
    {
        $file = $this->forModel($attachment);
        if ($file === null || ! $this->readerConfigured()) {
            return null;
        }

        $text = ['type' => ['string', 'null']];
        $generated = $this->claude()->generateStructuredFromFile(
            AiInstructions::askAiFileExtraction(),
            ['categories' => array_values($categories), 'today' => now('Asia/Manila')->format('Y-m-d')],
            'hiusa_attached_file',
            [
                'type' => 'object',
                'additionalProperties' => false,
                'required' => ['is_receipt', 'amount', 'date', 'payee_or_description', 'suggested_category', 'summary', 'figures', 'confidence_notes'],
                'properties' => [
                    'is_receipt' => ['type' => 'boolean'],
                    'amount' => ['type' => ['number', 'null']],
                    'date' => $text,
                    'payee_or_description' => $text,
                    'suggested_category' => $text,
                    'summary' => ['type' => 'string'],
                    'figures' => ['type' => 'array', 'items' => [
                        'type' => 'object',
                        'additionalProperties' => false,
                        'required' => ['label', 'value'],
                        'properties' => ['label' => ['type' => 'string'], 'value' => ['type' => 'string']],
                    ]],
                    'confidence_notes' => ['type' => 'string'],
                ],
            ],
            $file,
            900,
        );

        return is_array($generated['data'] ?? null) ? $this->checked($generated['data'], $categories) : null;
    }

    /**
     * The answer turn, from Claude only, with the file on the last turn. Null when Claude does not answer.
     *
     * @param  array<int, array{role: string, content: string}>  $messages
     * @return null|array{text: string, reasoning: ?string, model: string, response_id: ?string}
     */
    public function converse(array $messages, int $maxOutputTokens, ?callable $onEvent, AiMessageAttachment $attachment): ?array
    {
        $file = $this->forModel($attachment);
        if ($file === null || ! $this->readerConfigured()) {
            return null;
        }

        return $this->claude()->converseWithFile(AiInstructions::askAiFileChat(), $messages, $file, $maxOutputTokens, $onEvent);
    }

    private function claude(): ClaudeMessagesService
    {
        $claude = app(ClaudeMessagesService::class);
        $claude->withTimeBudget(self::READ_SECONDS, self::READ_SECONDS);

        return $claude;
    }

    private function checked(array $data, array $categories): array
    {
        $amount = $data['amount'] ?? null;
        $amount = is_int($amount) || is_float($amount) ? (float) $amount : null;
        $category = $data['suggested_category'] ?? null;

        $figures = [];
        foreach (is_array($data['figures'] ?? null) ? $data['figures'] : [] as $figure) {
            $label = is_array($figure) ? $this->line($figure['label'] ?? null) : null;
            $value = is_array($figure) ? $this->line($figure['value'] ?? null) : null;
            if ($label !== null && $value !== null && count($figures) < self::FIGURES_MAX) {
                $figures[] = ['label' => $label, 'value' => $value];
            }
        }

        return [
            'is_receipt' => ($data['is_receipt'] ?? false) === true,
            'amount' => $amount !== null && is_finite($amount) && $amount > 0 ? round($amount, 2) : null,
            'date' => $this->realDay($data['date'] ?? null),
            'payee_or_description' => $this->line($data['payee_or_description'] ?? null),
            'suggested_category' => is_string($category) && in_array($category, $categories, true) ? $category : null,
            'summary' => (string) $this->line($data['summary'] ?? null, 500),
            'figures' => $figures,
            'confidence_notes' => (string) $this->line($data['confidence_notes'] ?? null, 300),
        ];
    }

    private function realDay(mixed $value): ?string
    {
        if (! is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            return null;
        }
        $day = Carbon::createFromFormat('!Y-m-d', $value);

        return $day !== false && $day->format('Y-m-d') === $value ? $value : null;
    }

    private function line(mixed $value, int $max = self::FIELD_MAX): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $clean = trim(preg_replace('/\s+/u', ' ', strip_tags($value)) ?? $value);

        return $clean === '' ? null : mb_substr($clean, 0, $max);
    }
}
