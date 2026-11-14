<?php

namespace App\Services\Ai;

use App\Contracts\TextGenerator;
use App\Models\AiConversation;
use App\Models\AiMemory;
use App\Models\AiMessage;
use App\Models\AiOutput;
use App\Models\User;
use App\Services\Dashboard\ClientRouteAccess;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

class AskAiChatService
{
    private const HISTORY_LIMIT = 8;

    private const HISTORY_CHARS = 1500;

    private const FACT_ROWS = 12;

    private const GUARD_NOTICE = 'The written answer was replaced with the verified summary.';

    private const LOCAL_INTENTS = ['greeting', 'capabilities', 'memory'];

    private const LOCAL_PHRASES = [
        'greeting' => 'Understood this as a greeting',
        'capabilities' => 'Understood this as a question about what the assistant can do',
        'memory' => 'Understood this as a request about your saved memory',
    ];

    private const INTENT_PHRASES = [
        'daily_priorities' => 'your priorities for today',
        'missing_submissions' => 'missing requirements',
        'submitted_documents' => 'submitted documents',
        'pending_approvals' => 'pending approvals',
        'organizations_without_admin' => 'organizations without an admin',
        'tasks_workload' => 'tasks and workload',
        'finance_health' => 'finance',
        'merchandise_orders' => 'merchandise orders',
        'events_attendance' => 'events and attendance',
        'clearances_status' => 'clearances',
        'elections_status' => 'elections',
        'grievances_status' => 'grievances',
        'how_to_guide' => 'how to do something in HIUSA',
    ];

    public function __construct(
        private readonly AskAiService $askAi,
        private readonly TextGenerator $ai,
        private readonly ClientRouteAccess $routeAccess,
    ) {}

    public function assertRegenerable(AiConversation $conversation): void
    {
        $last = $conversation->messages()->reorder()->orderByDesc('id')->first();
        $hasQuestion = $conversation->messages()->where('role', 'user')->exists();

        if ($last === null || $last->role !== 'assistant' || ! $hasQuestion) {
            throw ValidationException::withMessages(['regenerate' => 'There is no answer to regenerate in this conversation.']);
        }
    }

    /**
     * @param  callable(string, array): void  $emit  receives each stream event name and its data
     * @param  null|callable(): bool  $aborted  true when the client has left
     * @return array{conversation: array, user_message: array, message: ?array}
     */
    public function respond(User $user, ?AiConversation $conversation, ?string $text, ?string $topic, bool $regenerate, callable $emit, ?callable $aborted = null): array
    {
        $started = microtime(true);

        if ($regenerate) {
            $this->assertRegenerable($conversation);
            $conversation->messages()->reorder()->where('role', 'assistant')->orderByDesc('id')->first()?->delete();
            $userMessage = $conversation->messages()->reorder()->where('role', 'user')->orderByDesc('id')->first();
        } else {
            $conversation ??= AiConversation::create([
                'user_id' => $user->school_id,
                'organization_id' => $user->organization_id,
                'role' => $user->role,
                'title' => $this->titleFrom((string) $text),
                'last_message_at' => now(),
            ]);
            $userMessage = AiMessage::create([
                'conversation_id' => $conversation->id,
                'role' => 'user',
                'content' => (string) $text,
                'status' => 'completed',
                'created_at' => now(),
            ]);
        }

        $conversation->forceFill(['last_message_at' => now()])->save();
        $question = $userMessage->content;

        $emit('meta', ['conversation' => $this->presentConversation($conversation), 'user_message' => $this->presentMessage($userMessage)]);

        $local = $this->localAnswer($user, $question);
        $message = $local !== null
            ? $this->answerLocally($user, $conversation, $userMessage, $local, $emit, $started)
            : $this->answerFromRecords($user, $conversation, $userMessage, $topic, $emit, $aborted, $started);

        $conversation->forceFill(['last_message_at' => now()])->save();

        return [
            'conversation' => $this->presentConversation($conversation),
            'user_message' => $this->presentMessage($userMessage),
            'message' => $message === null ? null : $this->presentMessage($message),
        ];
    }

    public function presentConversation(AiConversation $conversation): array
    {
        $row = AiConversation::query()->whereKey($conversation->id)->withSummary()->first() ?? $conversation;

        return $this->conversationRow($row);
    }

    public function conversationRow(AiConversation $row): array
    {
        $source = (string) ($row->getAttribute('preview_source') ?? '');

        return [
            'id' => $row->id,
            'title' => $row->title,
            'last_message_at' => $row->last_message_at?->toIso8601String(),
            'preview' => $source === '' ? '' : mb_substr(AnswerMarkdown::plainText($source), 0, 140),
            'message_count' => (int) ($row->getAttribute('messages_count') ?? 0),
        ];
    }

    public function presentMessage(AiMessage $message): array
    {
        return [
            'id' => $message->id,
            'conversation_id' => $message->conversation_id,
            'role' => $message->role,
            'content' => $message->content,
            'status' => $message->status,
            'feedback' => $message->feedback,
            'created_at' => $message->created_at?->toIso8601String(),
            'payload' => $message->payload,
        ];
    }

    private function titleFrom(string $question): string
    {
        $clean = trim(preg_replace('/\s+/u', ' ', $question) ?? $question);

        if (mb_strlen($clean) > 80) {
            $cut = mb_substr($clean, 0, 80);
            $space = mb_strrpos($cut, ' ');
            $clean = $space !== false && $space > 20 ? mb_substr($cut, 0, $space) : $cut;
        }

        $clean = trim(preg_replace('/[\s.,;:!?\-–—]+$/u', '', $clean) ?? $clean);

        return $clean === '' ? 'New conversation' : $clean;
    }

    // -------------------------------------------------------------------------
    // Answers that need no model: greetings, capabilities, memory commands
    // -------------------------------------------------------------------------

    /** @return null|array{intent: string, payload: array} */
    private function localAnswer(User $user, string $question): ?array
    {
        $plain = trim($question);
        $lower = mb_strtolower(preg_replace('/\s+/u', ' ', $plain) ?? $plain);

        if (preg_match('/^(?:(?:please|pls|hey)[\s,]+)?remember\b(?:\s+that\b)?\s*[:\-,]?\s*(?<content>.+)$/isu', $plain, $match) === 1) {
            return ['intent' => 'memory', 'payload' => $this->saveMemory($user, (string) $match['content'])];
        }

        if (mb_strlen($lower) < 80) {
            if (Str::contains($lower, ['forget everything', 'forget all', 'clear your memory', 'clear my memory', 'clear memory', 'clear all memories', 'delete your memory', 'delete my memories', 'erase your memory', 'wipe your memory'])) {
                $count = AiMemory::ownedBy($user)->count();
                AiMemory::ownedBy($user)->delete();

                return ['intent' => 'memory', 'payload' => $this->plainPayload('Memory cleared', $count === 0 ? 'I was not holding anything in memory.' : 'Done. I have forgotten everything you asked me to keep in mind.')];
            }

            if (Str::contains($lower, ['what do you remember', 'what do you currently remember', 'what have you remembered', "what's in your memory", 'what is in your memory', 'show your memory', 'show my memory', 'show me your memory', 'show memories', 'list memories', 'list your memories', 'show me what you remember', 'what are my memories'])) {
                return ['intent' => 'memory', 'payload' => $this->listMemories($user)];
            }
        }

        if (preg_match('/^(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening)|greetings|hola|kumusta)(?:\s+(?:there|again|everyone|hiusa|assistant))?[\s!.,?]*$/iu', $plain) === 1) {
            return ['intent' => 'greeting', 'payload' => $this->askAi->greetingAnswer($user, false)];
        }

        if (preg_match('/^(?:thanks?|thank\s+you|thank\s+you\s+(?:so|very)\s+much|thanks\s+(?:a\s+lot|so\s+much)|salamat|ty|thx|much\s+appreciated)[\s!.,?]*$/iu', $plain) === 1) {
            return ['intent' => 'greeting', 'payload' => $this->askAi->greetingAnswer($user, true)];
        }

        if (mb_strlen($lower) < 100 && Str::contains($lower, ['what can you do', 'what do you do', 'what can i ask', 'how can you help', 'what can you help', 'what are you able', 'your capabilities', 'who are you'])) {
            return ['intent' => 'capabilities', 'payload' => $this->askAi->capabilitiesAnswer($user)];
        }

        return null;
    }

    private function saveMemory(User $user, string $raw): array
    {
        $content = trim(preg_replace('/\s+/u', ' ', $raw) ?? $raw);
        $content = mb_substr($content, 0, 300);

        if (mb_strlen($content) < 3 || mb_strtolower($content) === 'that') {
            return $this->plainPayload('Nothing to remember', 'Tell me what to remember, for example: remember that I am the treasurer and want short answers.');
        }

        $existing = AiMemory::ownedBy($user)->where('content', $content)->exists();
        if (! $existing && AiMemory::ownedBy($user)->count() >= AiMemory::LIMIT) {
            return $this->plainPayload('Memory is full', 'I already hold '.AiMemory::LIMIT.' memories. Delete one from Memory, then ask me again.');
        }

        if (! $existing) {
            AiMemory::create([
                'user_id' => $user->school_id,
                'organization_id' => $user->organization_id,
                'role' => $user->role,
                'content' => $content,
            ]);
        }

        return $this->plainPayload('Saved to memory', 'Saved to memory: '.$content);
    }

    private function listMemories(User $user): array
    {
        $memories = AiMemory::ownedBy($user)->orderBy('id')->pluck('content');

        if ($memories->isEmpty()) {
            return $this->plainPayload('Memory', 'I am not holding anything in memory yet. Say "remember that ..." and I will keep it in mind.');
        }

        return $this->plainPayload('Memory', "Here is what you asked me to keep in mind:\n\n".$memories->map(fn (string $line) => '- '.$line)->implode("\n"));
    }

    private function plainPayload(string $title, string $answer): array
    {
        return [
            'title' => $title,
            'answer' => $answer,
            'highlights' => [],
            'sections' => [],
            'charts' => [],
            'follow_ups' => [],
            'formatted_blocks' => ['recommended_action' => null],
            'model_name' => null,
        ];
    }

    /** @param array{intent: string, payload: array} $local */
    private function answerLocally(User $user, AiConversation $conversation, AiMessage $userMessage, array $local, callable $emit, float $started): AiMessage
    {
        $content = trim(AnswerMarkdown::sanitize($local['payload']['answer'], $this->linkCheck($user, [])));
        $emit('delta', ['text' => $content]);

        $reasoning = $this->reasoning($started, [self::LOCAL_PHRASES[$local['intent']].', so no records were read'], null);

        return $this->storeAnswer($user, $conversation, $userMessage, $local['intent'], $local['payload'], $content, 'records', false, $reasoning, null, 'completed', null);
    }

    // -------------------------------------------------------------------------
    // Answers built from records, with the model putting words around them
    // -------------------------------------------------------------------------

    private function answerFromRecords(User $user, AiConversation $conversation, AiMessage $userMessage, ?string $topic, callable $emit, ?callable $aborted, float $started): ?AiMessage
    {
        $question = $userMessage->content;
        $emit('status', ['stage' => 'reading', 'label' => 'Reading your records']);

        $history = $this->history($conversation, $userMessage);
        $intent = $this->resolveIntent($user, $question, $topic, $conversation, $userMessage);
        $det = $this->askAi->deterministicAnswer($user, $question, $intent);
        $payloadBase = $this->cleanPayload($user, $det);
        $hrefs = $this->hrefsIn($payloadBase);
        $linkCheck = $this->linkCheck($user, $hrefs);
        $memories = AiMemory::ownedBy($user)->orderBy('id')->pluck('content')->all();
        $facts = $this->facts($user, $question, $intent, $payloadBase, $det, $memories);
        $deterministicText = trim(AnswerMarkdown::sanitize((string) $det['answer'], $linkCheck));
        $allowedModel = $this->askAi->canAsk($user, $intent);

        $messages = $this->modelMessages($history, $facts, $question);
        $guardFacts = ['facts' => $facts, 'history' => array_column($history, 'content'), 'question' => $question];

        $released = '';
        $raw = '';
        $pending = '';
        $reasoningText = '';
        $failed = false;
        $stopped = false;
        $wrote = false;

        $blanks = 0;
        $release = function (string $line) use (&$released, &$blanks, $guardFacts, $linkCheck, $emit): bool {
            if (trim($line) === '') {
                $blanks++;

                return true;
            }
            if (! $this->ai->preservesNumericFacts($line, $guardFacts)) {
                return false;
            }
            $piece = ($released === '' ? '' : str_repeat("\n", $blanks + 1)).AnswerMarkdown::sanitize($line, $linkCheck);
            $blanks = 0;
            $released .= $piece;
            $emit('delta', ['text' => $piece]);

            return true;
        };

        $onEvent = function (string $type, string $delta) use (&$released, &$raw, &$pending, &$reasoningText, &$failed, &$stopped, &$wrote, &$blanks, $release, $emit, $aborted): void {
            if ($aborted !== null && $aborted()) {
                $stopped = true;
                throw new ChatInterrupted('client_left');
            }

            if ($type === 'reset') {
                if ($released !== '') {
                    $emit('replace', ['text' => '', 'notice' => null]);
                }
                $released = $raw = $pending = $reasoningText = '';
                $blanks = 0;
                $failed = false;
                $wrote = false;

                return;
            }

            if ($type === 'reasoning') {
                $reasoningText .= $delta;
                $emit('reasoning', ['delta' => $delta]);

                return;
            }

            if ($type !== 'text' || $delta === '') {
                return;
            }

            if (! $wrote) {
                $wrote = true;
                $emit('status', ['stage' => 'writing', 'label' => 'Writing the answer']);
            }

            $raw .= $delta;
            $pending .= $delta;
            while (($position = strpos($pending, "\n")) !== false) {
                $line = substr($pending, 0, $position);
                $pending = substr($pending, $position + 1);
                if (! $release($line)) {
                    $failed = true;
                    throw new ChatInterrupted('guard');
                }
            }
        };

        $result = null;
        if ($allowedModel) {
            $emit('status', ['stage' => 'thinking', 'label' => 'Thinking it through']);
            try {
                $result = $this->ai->converse(AiInstructions::askAiChat(), $messages, 1400, $onEvent);
            } catch (ChatInterrupted) {
                $result = null;
            } catch (Throwable $e) {
                report($e);
                $result = null;
            }
        }

        if ($stopped || ($aborted !== null && $aborted())) {
            if (trim($released) === '') {
                return null;
            }

            return $this->finishModel($user, $conversation, $userMessage, $intent, $payloadBase, $det, trim($released), $result, $reasoningText, $started, 'stopped', null, $linkCheck);
        }

        if ($result !== null && ! $failed && $pending !== '') {
            $line = $pending;
            $pending = '';
            if (! $release($line)) {
                $failed = true;
            }
        }

        if ($failed) {
            $emit('replace', ['text' => $deterministicText, 'notice' => self::GUARD_NOTICE]);

            return $this->finishDeterministic($user, $conversation, $userMessage, $intent, $payloadBase, $det, $deterministicText, $started, self::GUARD_NOTICE, $allowedModel ? 'guard' : null);
        }

        $modelText = $result === null ? '' : trim(AnswerMarkdown::sanitize($raw === '' ? (string) $result['text'] : $raw, $linkCheck));
        if ($result === null || $modelText === '') {
            if ($released !== '') {
                $emit('replace', ['text' => $deterministicText, 'notice' => null]);
            } else {
                $this->emitLines($deterministicText, $emit, ! $wrote);
            }

            return $this->finishDeterministic($user, $conversation, $userMessage, $intent, $payloadBase, $det, $deterministicText, $started, null, null);
        }

        if (rtrim($released) !== $modelText) {
            if ($released === '') {
                $this->emitLines($modelText, $emit, ! $wrote);
            } else {
                $emit('replace', ['text' => $modelText, 'notice' => null]);
            }
        }

        return $this->finishModel($user, $conversation, $userMessage, $intent, $payloadBase, $det, $modelText, $result, $reasoningText, $started, 'completed', null, $linkCheck);
    }

    private function emitLines(string $text, callable $emit, bool $announce): void
    {
        if ($announce) {
            $emit('status', ['stage' => 'writing', 'label' => 'Writing the answer']);
        }
        foreach (explode("\n", $text) as $index => $line) {
            $emit('delta', ['text' => ($index === 0 ? '' : "\n").$line]);
        }
    }

    private function finishModel(User $user, AiConversation $conversation, AiMessage $userMessage, string $intent, array $payloadBase, array $det, string $content, ?array $result, string $reasoningText, float $started, string $status, ?string $notice, callable $linkCheck): AiMessage
    {
        $summary = $result['reasoning'] ?? ($reasoningText !== '' ? $reasoningText : null);
        $summary = $summary === null ? null : (trim(mb_substr(AnswerMarkdown::sanitize($summary, $linkCheck), 0, 1500)) ?: null);

        $steps = $this->steps($intent, $det);
        $steps[] = $status === 'stopped' ? 'Stopped writing when you asked; kept the checked part' : 'Wrote the answer in plain words from those records';
        $steps[] = 'Checked every number in the answer against those records';

        $engine = $this->engineFor($result['model'] ?? null);

        return $this->storeAnswer($user, $conversation, $userMessage, $intent, $payloadBase, $content, $engine, true, $this->reasoning($started, $steps, $summary), $notice, $status, $result['model'] ?? null, $det);
    }

    private function finishDeterministic(User $user, AiConversation $conversation, AiMessage $userMessage, string $intent, array $payloadBase, array $det, string $content, float $started, ?string $notice, ?string $why): AiMessage
    {
        $steps = $this->steps($intent, $det);
        $steps[] = $why === 'guard'
            ? 'Found a figure that did not match your records, so used the verified summary instead'
            : 'Wrote the answer directly from your records';

        return $this->storeAnswer($user, $conversation, $userMessage, $intent, $payloadBase, $content, 'records', false, $this->reasoning($started, $steps, null), $notice, 'completed', null, $det);
    }

    private function storeAnswer(User $user, AiConversation $conversation, AiMessage $userMessage, string $intent, array $payloadBase, string $content, string $engine, bool $modelWritten, array $reasoning, ?string $notice, string $status, ?string $modelName, ?array $det = null): AiMessage
    {
        $payload = [
            'title' => $payloadBase['title'] ?? 'Answer',
            'intent' => $intent,
            'engine' => $engine,
            'model_written' => $modelWritten,
            'highlights' => $payloadBase['highlights'] ?? [],
            'sections' => $payloadBase['sections'] ?? [],
            'charts' => $payloadBase['charts'] ?? [],
            'recommended_action' => $payloadBase['formatted_blocks']['recommended_action'] ?? null,
            'follow_ups' => $payloadBase['follow_ups'] ?? [],
            'reasoning' => $reasoning,
            'notice' => $notice,
        ];

        $output = AiOutput::create([
            'organization_id' => $user->organization_id,
            'feature_type' => 'ASK_AI_ASSISTANT',
            'reference_type' => User::class,
            'reference_id' => $user->school_id,
            'prompt_text' => $userMessage->content,
            'output_text' => $content,
            'model_name' => $modelName,
            'context_version' => 'ask-ai-chat-v1',
            'structured_input' => [
                'question' => $userMessage->content,
                'conversation_id' => $conversation->id,
                'intent' => $intent,
                'role' => $user->role,
            ],
            'structured_output' => [
                'title' => $payload['title'],
                'highlights' => $payload['highlights'],
                'section_count' => count($payload['sections']),
                'model_written' => $modelWritten,
                'rag_metadata' => $det['rag_metadata'] ?? null,
            ],
            'status' => 'completed',
            'decision_status' => 'accepted',
            'requested_by' => $user->school_id,
            'decided_by' => $user->school_id,
            'decided_at' => now(),
            'created_at' => now(),
        ]);

        return AiMessage::create([
            'conversation_id' => $conversation->id,
            'role' => 'assistant',
            'content' => $content,
            'payload' => $payload,
            'status' => $status,
            'ai_output_id' => $output->id,
            'created_at' => now(),
        ]);
    }

    // -------------------------------------------------------------------------
    // Intent, facts, history
    // -------------------------------------------------------------------------

    private function resolveIntent(User $user, string $question, ?string $topic, AiConversation $conversation, AiMessage $userMessage): string
    {
        $intent = $this->askAi->classifyIntent($question, $topic, $user->role);
        if ($intent !== 'semantic_rag' || ! $this->looksLikeFollowUp($question)) {
            return $intent;
        }

        $previous = $conversation->messages()->reorder()
            ->where('role', 'assistant')->where('id', '<', $userMessage->id)
            ->orderByDesc('id')->first();
        $previousIntent = $previous?->payload['intent'] ?? null;

        return is_string($previousIntent) && ! in_array($previousIntent, self::LOCAL_INTENTS, true) ? $previousIntent : $intent;
    }

    private function looksLikeFollowUp(string $question): bool
    {
        $words = preg_split('/\s+/u', trim($question), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $count = count($words);

        if ($count <= 5) {
            return true;
        }

        return $count <= 12 && preg_match('/\b(?:that|those|it|them|this|these|more|why|explain|elaborate|what about|how about|and|also)\b/iu', $question) === 1;
    }

    /** @return array<int, array{role: string, content: string}> oldest first */
    private function history(AiConversation $conversation, AiMessage $userMessage): array
    {
        return $conversation->messages()->reorder()
            ->where('id', '<', $userMessage->id)
            ->whereIn('status', ['completed', 'stopped'])
            ->orderByDesc('id')
            ->limit(self::HISTORY_LIMIT)
            ->get(['role', 'content'])
            ->reverse()
            ->map(fn (AiMessage $message) => ['role' => $message->role, 'content' => mb_substr($message->content, 0, self::HISTORY_CHARS)])
            ->values()
            ->all();
    }

    /**
     * Turns alternate and start with the user; the last turn carries the facts and the question.
     *
     * @param  array<int, array{role: string, content: string}>  $history
     * @return array<int, array{role: string, content: string}>
     */
    private function modelMessages(array $history, array $facts, string $question): array
    {
        while ($history !== [] && $history[0]['role'] !== 'user') {
            array_shift($history);
        }

        $current = [
            'role' => 'user',
            'content' => "Facts for this question (JSON):\n```json\n".json_encode($facts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)."\n```\n\nQuestion: ".$question,
        ];

        $turns = [];
        foreach ([...$history, $current] as $turn) {
            $last = count($turns) - 1;
            if ($last >= 0 && $turns[$last]['role'] === $turn['role']) {
                $turns[$last]['content'] .= "\n\n".$turn['content'];
            } else {
                $turns[] = $turn;
            }
        }

        return $turns;
    }

    private function facts(User $user, string $question, string $intent, array $payload, array $det, array $memories): array
    {
        $context = $this->askAi->chatContext($user);
        $rowFields = ['primary', 'secondary', 'status', 'meta', 'href', 'action_label'];
        $sections = [];
        $steps = [];

        foreach ($payload['sections'] ?? [] as $section) {
            $rows = array_map(
                fn (array $row) => array_filter(array_intersect_key($row, array_flip([...$rowFields, 'step'])), fn ($value) => $value !== null && $value !== ''),
                array_slice($section['rows'] ?? [], 0, self::FACT_ROWS)
            );

            if ($intent === 'how_to_guide' && ($section['layout'] ?? null) === 'steps') {
                $steps = array_merge($steps, $rows);

                continue;
            }

            $sections[] = ['title' => $section['title'] ?? '', 'rows' => $rows];
        }

        $facts = [
            'question' => $question,
            'user_first_name' => $context['first_name'],
            'role' => $context['role'],
            'scope' => $context['scope'],
            'today' => $context['today'],
            'semester' => $context['semester'],
            'memories' => $memories,
            'deterministic_answer' => $det['answer'],
            'highlights' => $payload['highlights'] ?? [],
            'sections' => $sections,
            'records' => $det['rag_chunks'] ?? [],
        ];

        if ($steps !== []) {
            $facts['guide_steps'] = $steps;
        }

        return $facts;
    }

    // -------------------------------------------------------------------------
    // Payload hygiene
    // -------------------------------------------------------------------------

    /** Drops every href the asking role may not open, from sections and the recommended action. */
    private function cleanPayload(User $user, array $det): array
    {
        $det['sections'] = array_map(function (array $section) use ($user): array {
            $section['rows'] = array_map(function (array $row) use ($user): array {
                if (isset($row['href'])) {
                    $href = $this->routeAccess->hrefFor($user->role, (string) $row['href']);
                    if ($href === null) {
                        unset($row['href'], $row['action_label']);
                    } else {
                        $row['href'] = $href;
                    }
                }

                return $row;
            }, $section['rows'] ?? []);

            return $section;
        }, $det['sections'] ?? []);

        $action = $det['formatted_blocks']['recommended_action'] ?? null;
        if (is_array($action)) {
            $href = $this->routeAccess->hrefFor($user->role, (string) ($action['href'] ?? ''));
            $det['formatted_blocks']['recommended_action'] = $href === null ? null : ['href' => $href] + $action;
        }

        return $det;
    }

    /** @return array<int, string> */
    private function hrefsIn(array $payload): array
    {
        $hrefs = [];
        foreach ($payload['sections'] ?? [] as $section) {
            foreach ($section['rows'] ?? [] as $row) {
                if (! empty($row['href'])) {
                    $hrefs[] = $row['href'];
                }
            }
        }
        if (! empty($payload['formatted_blocks']['recommended_action']['href'])) {
            $hrefs[] = $payload['formatted_blocks']['recommended_action']['href'];
        }

        return array_values(array_unique($hrefs));
    }

    /** @param array<int, string> $factHrefs */
    private function linkCheck(User $user, array $factHrefs): callable
    {
        return fn (string $target): bool => in_array($target, $factHrefs, true)
            || $this->routeAccess->hrefFor($user->role, $target) !== null;
    }

    // -------------------------------------------------------------------------
    // Reasoning trace: only what the server actually did, in plain words
    // -------------------------------------------------------------------------

    /** @return array<int, string> */
    private function steps(string $intent, array $det): array
    {
        $steps = [
            isset(self::INTENT_PHRASES[$intent])
                ? 'Understood this as a question about '.self::INTENT_PHRASES[$intent]
                : 'Understood this as a general question about your records',
        ];

        $meta = $det['rag_metadata'] ?? null;
        if ($intent === 'how_to_guide') {
            $steps[] = 'Found the matching HIUSA guide for your role';
        } elseif (is_array($meta) && (int) ($meta['corpus_size'] ?? 0) > 0) {
            $records = (int) $meta['corpus_size'];
            $areas = (int) ($meta['domains_searched'] ?? 0);
            $steps[] = 'Read '.number_format($records).' '.Str::plural('record', $records).($areas > 0 ? ' across '.$areas.' '.Str::plural('area', $areas) : '');
        } else {
            $steps[] = 'Looked through the records your account can open';
        }

        return $steps;
    }

    private function reasoning(float $started, array $steps, ?string $summary): array
    {
        return [
            'seconds' => max(0, (int) round(microtime(true) - $started)),
            'steps' => array_values($steps),
            'summary' => $summary,
        ];
    }

    private function engineFor(?string $model): string
    {
        if ($model === null || $model === '') {
            return 'records';
        }

        return str_starts_with($model, 'claude') ? 'claude' : 'groq';
    }
}
