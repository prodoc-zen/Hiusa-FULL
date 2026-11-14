<?php

namespace App\Http\Controllers;

use App\Models\AiConversation;
use App\Models\AiMessage;
use App\Models\User;
use App\Services\Ai\AskAiActions;
use App\Services\Ai\AskAiChatService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class AskAiActionController extends Controller
{
    public function __construct(
        private readonly AskAiActions $actions,
        private readonly AskAiChatService $chat,
    ) {}

    public function confirm(Request $request, int $message): JsonResponse
    {
        $user = $request->user();
        $row = $this->ownedAction($request, $message);
        $definition = $this->actions->definitionFor($user, $row->payload['action']['key']);
        abort_if($definition === null, 404);

        $submitted = $request->validate(['fields' => ['sometimes', 'array']])['fields'] ?? [];
        $claimed = $this->claim($row);
        if (is_string($claimed)) {
            return response()->json(['message' => $claimed], 409);
        }

        $checked = $this->actions->normalise($definition, $user, $submitted);
        if ($checked['errors'] !== []) {
            return $this->refuse($claimed, $definition, $user, $checked['values'], $checked['errors']);
        }

        try {
            $outcome = $this->actions->execute($user, $request, $definition, $checked['values']);
        } catch (Throwable $e) {
            Log::warning('Ask AI action failed to run.', ['action' => $claimed->payload['action']['key'], 'exception' => $e::class]);
            $outcome = ['outcome' => 'failed', 'message' => 'I could not do that. Nothing was confirmed, so check the page before trying again.'];
        }

        if ($outcome['outcome'] === 'invalid') {
            return $this->refuse($claimed, $definition, $user, $checked['values'], $outcome['errors']);
        }

        $done = $outcome['outcome'] === 'done';
        $this->store($claimed, $outcome['message'], function (array $action) use ($done, $outcome, $definition, $user, $checked): array {
            $action['status'] = $done ? 'done' : 'failed';
            $action['errors'] = [];
            $action['fields'] = $this->actions->presentFields($definition, $user, $checked['values']);
            $action['result'] = $done ? ['message' => $outcome['message'], 'href' => $outcome['href'], 'action_label' => $outcome['action_label']] : null;

            return $action;
        });

        return response()->json(['message' => $this->chat->presentMessage($claimed->refresh())]);
    }

    public function cancel(Request $request, int $message): JsonResponse
    {
        $row = $this->ownedAction($request, $message);

        $claimed = $this->claim($row);
        if (is_string($claimed)) {
            return response()->json(['message' => $claimed], 409);
        }

        $this->store($claimed, 'Cancelled. Nothing was changed.', function (array $action): array {
            $action['status'] = 'cancelled';
            $action['errors'] = [];

            return $action;
        });

        return response()->json(['message' => $this->chat->presentMessage($claimed->refresh())]);
    }

    private function ownedAction(Request $request, int $message): AiMessage
    {
        $row = AiMessage::query()
            ->whereIn('conversation_id', AiConversation::ownedBy($request->user())->select('id'))
            ->where('role', 'assistant')
            ->findOrFail($message);
        abort_unless(is_array($row->payload['action'] ?? null) && is_string($row->payload['action']['key'] ?? null), 404);

        return $row;
    }

    /**
     * Moves the action out of awaiting_confirmation under a row lock, so two presses cannot both run it. Returns the
     * claimed row, or the sentence for a 409 when it is no longer waiting or has expired.
     */
    private function claim(AiMessage $row): AiMessage|string
    {
        return DB::transaction(function () use ($row): AiMessage|string {
            $locked = AiMessage::query()->whereKey($row->id)->lockForUpdate()->firstOrFail();
            $payload = $locked->payload;
            $action = $payload['action'];

            if (($action['status'] ?? null) !== 'awaiting_confirmation') {
                return 'This request is no longer waiting for confirmation.';
            }

            if (! isset($action['expires_at']) || Carbon::parse($action['expires_at'])->isPast()) {
                $payload['action']['status'] = 'expired';
                $locked->update(['payload' => $payload, 'content' => 'This request expired. Ask me again if you still want it.']);

                return 'This request expired. Ask me again if you still want it.';
            }

            $payload['action']['status'] = 'confirming';
            $locked->update(['payload' => $payload]);

            return $locked;
        });
    }

    /** @param callable(array): array $change */
    private function store(AiMessage $row, string $content, callable $change): void
    {
        $payload = $row->refresh()->payload;
        $payload['action'] = $change($payload['action']);
        $row->update(['payload' => $payload, 'content' => $content]);
    }

    /** Puts the action back to waiting, with the person's values and the errors for the card. */
    private function refuse(AiMessage $row, array $definition, User $user, array $values, array $errors): JsonResponse
    {
        $this->store($row, $row->content, function (array $action) use ($definition, $user, $values, $errors): array {
            $action['status'] = 'awaiting_confirmation';
            $action['errors'] = $errors;
            $action['fields'] = $this->actions->presentFields($definition, $user, $values);

            return $action;
        });

        return response()->json([
            'message' => collect($errors)->flatten()->first() ?? 'Some details were not accepted.',
            'errors' => $errors,
            'assistant_message' => $this->chat->presentMessage($row->refresh()),
        ], 422);
    }
}
