<?php

namespace App\Http\Controllers;

use App\Models\AiConversation;
use App\Models\AiMemory;
use App\Models\AiMessage;
use App\Services\Ai\AskAiChatService;
use App\Services\Ai\AskAiService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class AskAiController extends Controller
{
    public function __construct(
        private readonly AskAiService $askAi,
        private readonly AskAiChatService $chat,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->askAi->overview($request->user()));
    }

    public function ask(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'question' => ['required', 'string', 'min:2', 'max:500'],
            'topic' => ['nullable', 'string', 'max:60'],
        ]);

        return response()->json(
            $this->askAi->ask(
                $request->user(),
                $validated['question'],
                $validated['topic'] ?? null
            )
        );
    }

    public function chat(Request $request): Response
    {
        $user = $request->user();
        $regenerate = $request->boolean('regenerate');

        try {
            $validated = $request->validate([
                'conversation_id' => [Rule::requiredIf($regenerate), 'nullable', 'integer'],
                'message' => [Rule::requiredIf(! $regenerate), 'nullable', 'string', 'min:1', 'max:2000'],
                'topic' => ['nullable', 'string', 'max:60'],
                'source' => ['nullable', 'in:typed,link'],
                'regenerate' => ['sometimes', 'boolean'],
            ]);

            $conversation = null;
            if (isset($validated['conversation_id'])) {
                $conversation = AiConversation::ownedBy($user)->find($validated['conversation_id']);
                if ($conversation === null) {
                    return response()->json(['message' => 'Conversation not found.'], 404);
                }
            }

            if ($regenerate) {
                $this->chat->assertRegenerable($conversation);
            }
        } catch (ValidationException $e) {
            $errors = $e->errors();

            return response()->json(['message' => collect($errors)->flatten()->first() ?? $e->getMessage(), 'errors' => $errors], 422);
        }

        $message = $regenerate ? null : trim((string) $validated['message']);
        $topic = $validated['topic'] ?? null;
        $source = $validated['source'] ?? 'typed';

        $lock = Cache::lock('ask-ai-chat:'.$user->school_id, 150);
        if (! $lock->get()) {
            return response()->json(['message' => 'Wait for the current answer to finish.'], 429);
        }

        if (! str_contains((string) $request->header('Accept'), 'text/event-stream')) {
            try {
                return response()->json($this->chat->respond($user, $conversation, $message, $topic, $regenerate, static function (): void {}, null, $source));
            } finally {
                $lock->release();
            }
        }

        return new StreamedResponse(function () use ($user, $conversation, $message, $topic, $regenerate, $source, $lock): void {
            ignore_user_abort(true);
            $began = false;
            $emit = function (string $event, array $data) use (&$began): void {
                $began = true;
                $this->writeEvent($event, $data);
            };

            try {
                $result = $this->chat->respond(
                    $user,
                    $conversation,
                    $message,
                    $topic,
                    $regenerate,
                    $emit,
                    static fn (): bool => connection_aborted() === 1,
                    $source,
                );

                if ($result['message'] !== null) {
                    $emit('done', ['conversation' => $result['conversation'], 'message' => $result['message']]);
                }
            } catch (Throwable $e) {
                report($e);
                $this->writeEvent('error', ['message' => 'Could not answer that right now. Try again.']);
            } finally {
                $lock->release();
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-transform',
            'X-Accel-Buffering' => 'no',
            'Connection' => 'keep-alive',
        ]);
    }

    public function conversations(Request $request): JsonResponse
    {
        $validated = $request->validate(['search' => ['nullable', 'string', 'max:100']]);

        $query = AiConversation::ownedBy($request->user())->withSummary();

        if (! empty($validated['search'])) {
            $term = '%'.addcslashes($validated['search'], '%_\\').'%';
            $query->where(fn ($match) => $match
                ->where('title', 'like', $term)
                ->orWhereHas('messages', fn ($messages) => $messages->where('content', 'like', $term)));
        }

        $rows = $query->orderByDesc('last_message_at')->orderByDesc('id')->limit(50)->get();

        return response()->json(['data' => $rows->map(fn (AiConversation $row) => $this->chat->conversationRow($row, $request->user()))->all()]);
    }

    public function showConversation(Request $request, int $conversation): JsonResponse
    {
        $row = AiConversation::ownedBy($request->user())->withSummary()->findOrFail($conversation);

        return response()->json([
            'conversation' => $this->chat->conversationRow($row, $request->user()),
            'messages' => $row->messages()->get()->map(fn (AiMessage $message) => $this->chat->presentMessageFor($request->user(), $message))->all(),
        ]);
    }

    public function renameConversation(Request $request, int $conversation): JsonResponse
    {
        $row = AiConversation::ownedBy($request->user())->findOrFail($conversation);
        $validated = $request->validate(['title' => ['required', 'string', 'min:1', 'max:160']]);

        $row->update(['title' => $validated['title']]);

        return response()->json(['conversation' => $this->chat->presentConversation($row, $request->user())]);
    }

    public function destroyConversation(Request $request, int $conversation): JsonResponse
    {
        $row = AiConversation::ownedBy($request->user())->findOrFail($conversation);
        AiConversation::eraseWithOutputs(AiConversation::query()->whereKey($row->id));

        return response()->json(['message' => 'Conversation deleted.']);
    }

    public function destroyConversations(Request $request): JsonResponse
    {
        AiConversation::eraseWithOutputs(AiConversation::ownedBy($request->user()));

        return response()->json(['message' => 'All conversations deleted.']);
    }

    public function feedback(Request $request, int $message): JsonResponse
    {
        $user = $request->user();
        $row = AiMessage::query()
            ->whereIn('conversation_id', AiConversation::ownedBy($user)->select('id'))
            ->findOrFail($message);

        if ($row->role !== 'assistant') {
            throw ValidationException::withMessages(['rating' => 'Feedback can only be left on an answer.']);
        }

        $validated = $request->validate(['rating' => ['present', 'nullable', 'in:up,down']]);
        $row->update(['feedback' => $validated['rating']]);

        return response()->json(['message' => $this->chat->presentMessage($row)]);
    }

    public function memories(Request $request): JsonResponse
    {
        return response()->json(['data' => AiMemory::ownedBy($request->user())->orderBy('id')->limit(AiMemory::LIMIT)->get()->map(fn (AiMemory $memory) => $this->memoryRow($memory))->all()]);
    }

    public function storeMemory(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate(['content' => ['required', 'string', 'min:3', 'max:300']]);

        $memory = AiMemory::remember($user, $validated['content']);
        if ($memory === null) {
            throw ValidationException::withMessages(['content' => 'You can keep up to '.AiMemory::LIMIT.' memories. Delete one first.']);
        }

        return response()->json(['memory' => $this->memoryRow($memory)], 201);
    }

    public function destroyMemory(Request $request, int $memory): JsonResponse
    {
        AiMemory::ownedBy($request->user())->findOrFail($memory)->delete();

        return response()->json(['message' => 'Memory deleted.']);
    }

    public function destroyMemories(Request $request): JsonResponse
    {
        AiMemory::ownedBy($request->user())->delete();

        return response()->json(['message' => 'Memory cleared.']);
    }

    private function memoryRow(AiMemory $memory): array
    {
        return ['id' => $memory->id, 'content' => $memory->content, 'created_at' => $memory->created_at?->toIso8601String()];
    }

    private function writeEvent(string $event, array $data): void
    {
        echo 'event: '.$event."\ndata: ".json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)."\n\n";

        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
    }
}
