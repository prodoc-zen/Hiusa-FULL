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

    private const HIDDEN_ANSWER = 'This answer is no longer available for your access.';

    private const GUARD_NOTICE = 'The written answer was replaced with the verified summary.';

    private const PROVIDER_NOTICE = 'The writing service did not finish, so the written answer was replaced with the summary from your records.';

    public const CHAT_AUDIT_VERSION = 'ask-ai-chat-v1';

    public const ACTION_AUDIT_VERSION = 'ask-ai-action-v1';

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
        private readonly AskAiActions $actions,
    ) {}

    public function assertRegenerable(AiConversation $conversation): void
    {
        $lastQuestion = $conversation->messages()->reorder()->where('role', 'user')->orderByDesc('id')->first(['id']);
        if ($lastQuestion === null) {
            throw ValidationException::withMessages(['regenerate' => 'There is no question to answer again in this conversation.']);
        }

        $carriesAction = $conversation->messages()->reorder()->where('role', 'assistant')->where('id', '>', $lastQuestion->id)->get(['id', 'payload'])
            ->contains(fn (AiMessage $answer) => is_array($answer->payload['action'] ?? null));
        if ($carriesAction) {
            throw ValidationException::withMessages(['regenerate' => 'That answer is a request you can confirm or cancel, so it cannot be answered again. Ask again to start a new request.']);
        }
    }

    /**
     * @param  callable(string, array): void  $emit  receives each stream event name and its data
     * @param  null|callable(): bool  $aborted  true when the client has left
     * @return array{conversation: array, user_message: array, message: ?array}
     */
    public function respond(User $user, ?AiConversation $conversation, ?string $text, ?string $topic, bool $regenerate, callable $emit, ?callable $aborted = null, string $source = 'typed'): array
    {
        $started = microtime(true);

        if ($regenerate) {
            $this->assertRegenerable($conversation);
            $userMessage = $conversation->messages()->reorder()->where('role', 'user')->orderByDesc('id')->first();
            $source = ($userMessage->payload['source'] ?? null) === 'typed' ? 'typed' : 'link';
            $conversation->messages()->reorder()->where('role', 'assistant')->where('id', '>', $userMessage->id)->get()
                ->each(fn (AiMessage $replaced) => $replaced->supersede());
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
                'payload' => ['source' => $source],
                'status' => 'completed',
                'created_at' => now(),
            ]);
        }

        $conversation->forceFill(['last_message_at' => now()])->save();
        $question = $userMessage->content;

        $emit('meta', ['conversation' => $this->presentConversation($conversation, $user), 'user_message' => $this->presentMessage($userMessage)]);

        $local = $this->localAnswer($user, $question, $source === 'typed');
        $message = $local !== null
            ? $this->answerLocally($user, $conversation, $userMessage, $local, $emit, $started)
            : ($this->actions->propose($user, $conversation, $userMessage, $source, $emit)
                ?? $this->answerFromRecords($user, $conversation, $userMessage, $topic, $emit, $aborted, $started));

        $conversation->forceFill(['last_message_at' => now()])->save();

        return [
            'conversation' => $this->presentConversation($conversation, $user),
            'user_message' => $this->presentMessage($userMessage),
            'message' => $message === null ? null : $this->presentMessage($message),
        ];
    }

    public function presentConversation(AiConversation $conversation, User $user): array
    {
        $row = AiConversation::query()->whereKey($conversation->id)->withSummary()->first() ?? $conversation;

        return $this->conversationRow($row, $user);
    }

    public function conversationRow(AiConversation $row, User $user): array
    {
        $source = (string) ($row->getAttribute('preview_source') ?? '');
        $previewIntent = $row->getAttribute('preview_intent');
        if ($source !== '' && ! $this->intentVisibleTo($user, is_string($previewIntent) ? $previewIntent : null)) {
            $source = self::HIDDEN_ANSWER;
        }

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
            'payload' => $message->role === 'user' ? null : $this->withErrorsAsMap($message->payload),
        ];
    }

    /** The stored JSON turns an empty map into a list, but the action card's errors are a map from field name to messages. */
    private function withErrorsAsMap(mixed $payload): mixed
    {
        if (is_array($payload) && is_array($payload['action'] ?? null) && ($payload['action']['errors'] ?? null) === []) {
            $payload['action']['errors'] = new \stdClass;
        }

        return $payload;
    }

    /** An answer from an area the person's access no longer covers is shown as unavailable and never sent to the model. */
    public function visibleTo(User $user, AiMessage $message): bool
    {
        return $message->role !== 'assistant' || $this->intentVisibleTo($user, $this->intentOf($message->payload));
    }

    public function presentMessageFor(User $user, AiMessage $message): array
    {
        if ($this->visibleTo($user, $message)) {
            return $this->presentMessage($message);
        }

        return [...$this->presentMessage($message), 'content' => self::HIDDEN_ANSWER, 'payload' => null];
    }

    private function intentOf(mixed $payload): ?string
    {
        if (is_string($payload)) {
            $payload = json_decode($payload, true);
        }
        $intent = is_array($payload) ? ($payload['intent'] ?? null) : null;

        return is_string($intent) ? $intent : null;
    }

    private function intentVisibleTo(User $user, ?string $intent): bool
    {
        return $intent === null || in_array($intent, self::LOCAL_INTENTS, true) || $this->askAi->canAsk($user, $intent);
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
    private function localAnswer(User $user, string $question, bool $typed): ?array
    {
        $plain = trim($question);

        $polite = '(?:(?:please|pls|hey|hi|hello)[\s,]+)?';

        if ($typed && preg_match('/^(?:(?:please|pls|hey)[\s,]+)?remember\b(?:\s+that\b)?\s*[:\-,]?\s*(?<content>.+)$/isu', $plain, $match) === 1 && ! $this->readsAsQuestion((string) $match['content'])) {
            return ['intent' => 'memory', 'payload' => $this->saveMemory($user, (string) $match['content'])];
        }

        if ($typed && preg_match('/^'.$polite.'(?:forget\s+(?:everything|it\s+all|all(?:\s+(?:of\s+)?(?:it|that|your\s+memor(?:y|ies)))?)|(?:clear|delete|erase|wipe)\s+(?:all\s+)?(?:(?:your|my)\s+)?memor(?:y|ies))(?:\s+please)?[\s.!]*$/iu', $plain) === 1) {
            $count = AiMemory::ownedBy($user)->count();
            AiMemory::ownedBy($user)->delete();

            return ['intent' => 'memory', 'payload' => $this->plainPayload('Memory cleared', $count === 0 ? 'I was not holding anything in memory.' : 'Done. I have forgotten everything you asked me to keep in mind.')];
        }

        if ($typed && preg_match('/^'.$polite.'(?:what\s+do\s+you\s+(?:currently\s+)?remember|what\s+have\s+you\s+remembered|what(?:\'s|\s+is)\s+in\s+your\s+memory|(?:show|list)(?:\s+me)?\s+(?:your\s+|my\s+)?memor(?:y|ies)|show\s+me\s+what\s+you\s+remember|what\s+are\s+my\s+memories)(?:\s+about\s+me)?[\s?.!]*$/iu', $plain) === 1) {
            return ['intent' => 'memory', 'payload' => $this->listMemories($user)];
        }

        if (preg_match('/^(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening)|greetings|hola|kumusta)(?:\s+(?:there|again|everyone|hiusa|assistant))?[\s!.,?]*$/iu', $plain) === 1) {
            return ['intent' => 'greeting', 'payload' => $this->askAi->greetingAnswer($user, false)];
        }

        if (preg_match('/^(?:thanks?|thank\s+you|thank\s+you\s+(?:so|very)\s+much|thanks\s+(?:a\s+lot|so\s+much)|salamat|ty|thx|much\s+appreciated)[\s!.,?]*$/iu', $plain) === 1
            || preg_match('/^(?=[^\pL]*\pL)(?:ok(?:ay)?|great|nice|cool|good|got\s+it|i\s+see|noted|alright|sige)?[\s,!.]*(?:thanks?|thank\s+you|salamat|ty|thx)?[\s!.]*$/iu', $plain) === 1) {
            return ['intent' => 'greeting', 'payload' => $this->askAi->greetingAnswer($user, true)];
        }

        if (preg_match('/^'.$polite.'(?:what\s+can\s+you\s+do|what\s+do\s+you\s+do|what\s+can\s+i\s+ask(?:\s+you)?|how\s+can\s+you\s+help(?:\s+me)?|what\s+can\s+you\s+help(?:\s+me)?\s+with|what\s+are\s+you\s+able\s+to\s+do|what\s+are\s+your\s+capabilities|who\s+are\s+you)(?:\s+for\s+me)?[\s?.!]*$/iu', $plain) === 1) {
            return ['intent' => 'capabilities', 'payload' => $this->askAi->capabilitiesAnswer($user)];
        }

        return null;
    }

    /** "remember when the fee was due?" asks something; only a statement is worth saving. */
    private function readsAsQuestion(string $content): bool
    {
        $content = trim($content);

        return str_ends_with($content, '?') || preg_match('/^(?:when|what|who|where|why|how|if|the\s+time)\b/iu', $content) === 1;
    }

    private function saveMemory(User $user, string $raw): array
    {
        $content = trim(preg_replace('/\s+/u', ' ', $raw) ?? $raw);
        $content = mb_substr($content, 0, 300);

        if (mb_strlen($content) < 3 || mb_strtolower($content) === 'that') {
            return $this->plainPayload('Nothing to remember', 'Tell me what to remember, for example: remember that I am the treasurer and want short answers.');
        }

        if (AiMemory::remember($user, $content) === null) {
            return $this->plainPayload('Memory is full', 'I already hold '.AiMemory::LIMIT.' memories. Delete one from Memory, then ask me again.');
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
        $content = trim(AnswerMarkdown::sanitize($local['payload']['answer'], $this->linkCheck($user)));
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

        $history = $this->history($user, $conversation, $userMessage);
        $intent = $this->resolveIntent($user, $question, $topic, $conversation, $userMessage);
        $det = $this->askAi->deterministicAnswer($user, $question, $intent);
        $payloadBase = $this->cleanPayload($user, $det);
        $linkCheck = $this->linkCheck($user);
        $memories = AiMemory::ownedBy($user)->orderBy('id')->limit(AiMemory::LIMIT)->pluck('content')->all();
        $facts = $this->facts($user, $question, $intent, $payloadBase, $det, $memories);
        $deterministicText = trim(AnswerMarkdown::sanitize(AnswerMarkdown::escape((string) $det['answer']), $linkCheck));
        $allowedModel = $this->askAi->canAsk($user, $intent);

        $messages = $this->modelMessages($history, $facts, $question);
        // Numbers may come from the facts built for this question (which carry the question and the memories) and
        // from what the person typed earlier, never from text the assistant wrote in earlier turns.
        $guardFacts = ['facts' => $facts, 'typed' => array_column(array_filter($history, fn (array $turn) => $turn['role'] === 'user'), 'content')];

        $deadline = $started + $this->answerSeconds();
        $released = '';
        $raw = '';
        $pending = '';
        $reasoningText = '';
        $reasoningPending = '';
        $reasoningOpen = false;
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

        $keepReasoning = function (string $line, bool $continues = false) use (&$reasoningText, $guardFacts, $emit): void {
            $clean = $this->reasoningLine($line, $guardFacts);
            if ($clean === null) {
                return;
            }
            $piece = ($reasoningText === '' ? '' : ($continues ? ' ' : "\n")).$clean;
            $reasoningText .= $piece;
            $emit('reasoning', ['delta' => $piece]);
        };

        $onEvent = function (string $type, string $delta) use (&$released, &$raw, &$pending, &$reasoningText, &$reasoningPending, &$reasoningOpen, &$failed, &$stopped, &$wrote, &$blanks, $release, $keepReasoning, $emit, $aborted, $deadline): void {
            if ($aborted !== null && $aborted()) {
                $stopped = true;
                throw new ChatInterrupted('client_left');
            }
            if (microtime(true) > $deadline) {
                throw new ChatInterrupted('deadline');
            }

            if ($type === 'reset') {
                if ($released !== '') {
                    $emit('replace', ['text' => '', 'notice' => null]);
                }
                $released = $raw = $pending = $reasoningText = $reasoningPending = '';
                $reasoningOpen = false;
                $blanks = 0;
                $failed = false;
                $wrote = false;

                return;
            }

            if ($type === 'reasoning') {
                $reasoningPending .= $delta;
                while (($position = strpos($reasoningPending, "\n")) !== false) {
                    $keepReasoning(substr($reasoningPending, 0, $position), $reasoningOpen);
                    $reasoningPending = substr($reasoningPending, $position + 1);
                    $reasoningOpen = false;
                }
                // A summary is usually one paragraph without a newline: release it sentence by sentence as it arrives.
                while (preg_match('/^(.+?[.!?])\s+(.*)$/su', $reasoningPending, $sentence) === 1) {
                    $keepReasoning($sentence[1], $reasoningOpen);
                    $reasoningPending = $sentence[2];
                    $reasoningOpen = true;
                }

                return;
            }

            if ($type !== 'text' || $delta === '') {
                return;
            }

            if (trim($reasoningPending) !== '') {
                $keepReasoning($reasoningPending, $reasoningOpen);
            }
            $reasoningPending = '';
            $reasoningOpen = false;

            if (! $wrote) {
                $wrote = true;
                $emit('status', ['stage' => 'writing', 'label' => 'Writing the answer']);
            }

            $raw .= $delta;
            $pending .= $delta;
            while (($position = strpos($pending, "\n")) !== false) {
                $line = substr($pending, 0, $position);
                $pending = substr($pending, $position + 1);
                if ($aborted !== null && $aborted()) {
                    $stopped = true;
                    throw new ChatInterrupted('client_left');
                }
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

        if (trim($reasoningPending) !== '') {
            $keepReasoning($reasoningPending, $reasoningOpen);
            $reasoningPending = '';
        }
        $thinking = $reasoningText !== '' ? $reasoningText : $this->reasoningSummary($result['reasoning'] ?? null, $guardFacts);

        if ($stopped || ($aborted !== null && $aborted())) {
            if (trim($released) === '') {
                return null;
            }

            return $this->finishModel($user, $conversation, $userMessage, $intent, $payloadBase, $det, trim($released), $result, $thinking, $started, 'stopped', null);
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

            return $this->finishDeterministic($user, $conversation, $userMessage, $intent, $payloadBase, $det, $deterministicText, $started, self::GUARD_NOTICE, 'guard');
        }

        $modelText = $result === null ? '' : trim(AnswerMarkdown::sanitize($raw === '' ? (string) $result['text'] : $raw, $linkCheck));
        if ($result === null || $modelText === '') {
            $why = $allowedModel ? 'provider' : (isset($det['rag_metadata']) ? null : 'refused');
            $notice = null;
            if ($released !== '') {
                $notice = $why === 'provider' ? self::PROVIDER_NOTICE : null;
                $emit('replace', ['text' => $deterministicText, 'notice' => $notice]);
            } else {
                $this->emitLines($deterministicText, $emit, ! $wrote);
            }

            return $this->finishDeterministic($user, $conversation, $userMessage, $intent, $payloadBase, $det, $deterministicText, $started, $notice, $why);
        }

        if (rtrim($released) !== $modelText) {
            if ($released === '') {
                $this->emitLines($modelText, $emit, ! $wrote);
            } else {
                $emit('replace', ['text' => $modelText, 'notice' => null]);
            }
        }

        return $this->finishModel($user, $conversation, $userMessage, $intent, $payloadBase, $det, $modelText, $result, $thinking, $started, 'completed', null);
    }

    /** One line of the model's thinking, cleaned and held to the same numbers as the answer; null drops it. */
    private function reasoningLine(string $line, array $guardFacts): ?string
    {
        if (trim($line) === '' || ! $this->ai->preservesNumericFacts($line, $guardFacts)) {
            return null;
        }
        $clean = trim(AnswerMarkdown::plainLine($line));

        return $clean === '' ? null : $clean;
    }

    private function reasoningSummary(?string $summary, array $guardFacts): string
    {
        if ($summary === null) {
            return '';
        }
        $kept = [];
        foreach (explode("\n", str_replace(["\r\n", "\r"], "\n", $summary)) as $line) {
            $clean = $this->reasoningLine($line, $guardFacts);
            if ($clean !== null) {
                $kept[] = $clean;
            }
        }

        return implode("\n", $kept);
    }

    protected function answerSeconds(): int
    {
        return FallbackTextGenerator::chatDeadlineSeconds();
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

    private function finishModel(User $user, AiConversation $conversation, AiMessage $userMessage, string $intent, array $payloadBase, array $det, string $content, ?array $result, string $reasoningText, float $started, string $status, ?string $notice): AiMessage
    {
        $summary = $reasoningText === '' ? null : mb_substr($reasoningText, 0, 1500);

        $steps = $this->steps($intent, $det);
        $steps[] = $status === 'stopped' ? 'Writing stopped before the end; kept the checked part' : 'Wrote the answer in plain words from those records';
        $steps[] = 'Checked every number in the answer against those records';

        $engine = $this->engineFor($result['model'] ?? null);

        return $this->storeAnswer($user, $conversation, $userMessage, $intent, $payloadBase, $content, $engine, true, $this->reasoning($started, $steps, $summary), $notice, $status, $result['model'] ?? null, $det);
    }

    private function finishDeterministic(User $user, AiConversation $conversation, AiMessage $userMessage, string $intent, array $payloadBase, array $det, string $content, float $started, ?string $notice, ?string $why): AiMessage
    {
        $steps = $this->steps($intent, $det);
        if ($why === 'refused') {
            $steps = [$steps[0], 'This is outside what your account can open, so no records were read'];
        } else {
            $steps[] = match ($why) {
                'guard' => 'Found a figure that did not match your records, so used the verified summary instead',
                'provider' => 'The writing service did not finish, so this is the summary from your records',
                default => 'Wrote the answer directly from your records',
            };
        }

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
            'context_version' => self::CHAT_AUDIT_VERSION,
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

    /**
     * The audit row for an action card that was carried out: which action, by whom, and how it ended. It holds the
     * action key and the created record's id only, never the field values, and is not tied to the conversation,
     * so deleting the conversation leaves it.
     */
    public function recordAction(User $user, AiMessage $card, string $outcome, ?int $recordId): void
    {
        $key = (string) ($card->payload['action']['key'] ?? '');

        AiOutput::create([
            'organization_id' => $user->organization_id,
            'feature_type' => 'ASK_AI_ASSISTANT',
            'reference_type' => User::class,
            'reference_id' => $user->school_id,
            'prompt_text' => 'Ask AI action: '.$key,
            'output_text' => $key.': '.$outcome,
            'context_version' => self::ACTION_AUDIT_VERSION,
            'structured_input' => ['action' => $key, 'role' => $user->role],
            'structured_output' => ['outcome' => $outcome, 'record_id' => $recordId],
            'status' => 'completed',
            'decision_status' => 'accepted',
            'requested_by' => $user->school_id,
            'decided_by' => $user->school_id,
            'decided_at' => now(),
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

        // A thanks or a memory answer in between does not end the subject; the latest answer about records does.
        $recent = $conversation->messages()->reorder()
            ->where('role', 'assistant')->where('id', '<', $userMessage->id)
            ->orderByDesc('id')->limit(5)->get(['id', 'payload']);

        foreach ($recent as $answer) {
            $previousIntent = $answer->payload['intent'] ?? null;
            if (is_string($previousIntent) && ! in_array($previousIntent, self::LOCAL_INTENTS, true)) {
                return $previousIntent;
            }
        }

        return $intent;
    }

    /** Only a message that leans on what came before is read against the previous answer; being short is not enough. */
    private function looksLikeFollowUp(string $question): bool
    {
        $words = preg_split('/\s+/u', trim($question), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return count($words) <= 12
            && preg_match('/\b(?:that|those|it|its|them|they|this|these|more|why|explain|elaborate|what about|how about|same|again|else|instead|the (?:first|second|third|last) one)\b|^\s*(?:and|but|so|also)\b/iu', $question) === 1;
    }

    /** @return array<int, array{role: string, content: string}> oldest first */
    private function history(User $user, AiConversation $conversation, AiMessage $userMessage): array
    {
        return $conversation->messages()->reorder()
            ->where('id', '<', $userMessage->id)
            ->whereIn('status', ['completed', 'stopped'])
            ->orderByDesc('id')
            ->limit(self::HISTORY_LIMIT)
            ->get(['role', 'content', 'payload'])
            ->filter(fn (AiMessage $message) => $this->visibleTo($user, $message))
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
                fn (array $row) => $this->escapedText(array_filter(array_intersect_key($row, array_flip([...$rowFields, 'step'])), fn ($value) => $value !== null && $value !== ''), ['primary', 'secondary', 'status', 'meta', 'action_label']),
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
            'deterministic_answer' => AnswerMarkdown::escape((string) $det['answer']),
            'highlights' => $payload['highlights'] ?? [],
            'sections' => $sections,
            'records' => array_map(fn (array $chunk) => $this->escapedText($chunk, ['primary', 'secondary', 'status', 'meta']), $det['rag_chunks'] ?? []),
        ];

        if ($steps !== []) {
            $facts['guide_steps'] = $steps;
        }

        $nextStep = $payload['formatted_blocks']['recommended_action'] ?? null;
        if (! empty($nextStep['href'])) {
            $facts['next_step'] = ['label' => $nextStep['action_label'] ?? $nextStep['title'] ?? null, 'href' => $nextStep['href']];
        }

        return $facts;
    }

    /** Text people typed into records must not read as Markdown once it sits in an answer or in the facts. */
    private function escapedText(array $row, array $keys): array
    {
        foreach ($keys as $key) {
            if (isset($row[$key]) && is_string($row[$key])) {
                $row[$key] = AnswerMarkdown::escape($row[$key]);
            }
        }

        return $row;
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
                    $href = $this->pageHref($user, (string) $row['href']);
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
            $href = $this->pageHref($user, (string) ($action['href'] ?? ''));
            $det['formatted_blocks']['recommended_action'] = $href === null ? null : ['href' => $href] + $action;
        }

        return $det;
    }

    /**
     * A link target an answer may carry: a plain in-app page this role can open. Never the Ask AI page itself and
     * never a link that carries a question, so no answer can send a message on the reader's behalf.
     */
    private function pageHref(User $user, string $target): ?string
    {
        $href = $this->routeAccess->hrefFor($user->role, $target);
        if ($href === null) {
            return null;
        }

        parse_str((string) parse_url($href, PHP_URL_QUERY), $query);
        if (parse_url($href, PHP_URL_PATH) === '/dashboard/ask-ai' || array_intersect(['q', 'topic', 'c'], array_keys($query)) !== []) {
            return null;
        }

        return $href;
    }

    private function linkCheck(User $user): callable
    {
        return fn (string $target): bool => $this->pageHref($user, $target) !== null;
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
