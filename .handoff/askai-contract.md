# Ask AI rebuild: the contract both builders implement

Ask AI becomes a conversational assistant (in the manner of ChatGPT or Claude) for every role that has the page today:
SUPER_ADMIN (the SAO), DEPARTMENT_HEAD, ADMIN, SBO_OFFICER, STUDENT. The backend builder owns `/server`. The frontend
builder owns the client files listed in section 7. Neither edits the other's files. This file is the interface.

Fixed product rules (already true in HIUSA, keep them true):

- HIUSA computes every figure. The model only puts words around facts the server supplies. An answer that introduces a
  number that is not in the supplied facts is never shown.
- The assistant reads; it never writes records, approves, assigns or publishes.
- An answer may only use records the asking user's role and organization scope can already open.
- With no model provider configured or reachable, every answer still works from the server's own deterministic text.
- No AI model name appears in user-facing copy except the small "engine" label already used by the app.

## 1. Data model (new forward migration, MySQL 8.4 + MariaDB 10.4 + SQLite safe)

`ai_conversations`
- `id`
- `user_id` unsigned integer, FK `users.school_id`, cascade on delete
- `organization_id` nullable FK `organizations.id`, cascade on delete
- `role` string(30): the role the user held when the conversation started
- `title` string(160)
- `last_message_at` timestamp nullable
- timestamps
- index (`user_id`, `last_message_at`)

`ai_messages`
- `id`
- `conversation_id` FK `ai_conversations.id`, cascade on delete
- `role` string(12): `user` or `assistant`
- `content` longText: the user's text, or the assistant's Markdown
- `payload` json nullable: assistant only, see section 3
- `status` string(12): `completed`, `stopped` or `failed`
- `feedback` string(4) nullable: `up` or `down`
- `ai_output_id` nullable FK `ai_outputs.id`, null on delete
- `created_at` timestamp
- index (`conversation_id`, `id`)

`ai_memories`
- `id`
- `user_id` unsigned integer, FK `users.school_id`, cascade on delete
- `organization_id` nullable FK, cascade on delete
- `role` string(30)
- `content` string(300)
- timestamps
- index (`user_id`)

Scope rule (privacy): a conversation or a memory is visible and usable only when `user_id` is the signed-in user AND
`role` equals the user's current role AND `organization_id` equals the user's current organization (null-safe). A row
that fails the rule is treated as not found (404), never listed, never sent to the model. Put this in one model scope
(`scopeOwnedBy(User $user)`) and use it everywhere.

Every assistant answer still writes one `ai_outputs` row with `feature_type = ASK_AI_ASSISTANT` exactly as today (the
audit trail and `ai:live-eval` rely on it). `context_version` becomes `ask-ai-chat-v1`.

## 2. Routes

All under `auth:sanctum` with the same role middleware the two existing routes use
(`role:SUPER_ADMIN,ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT`). Reads use `throttle:api-read`, writes `throttle:api-write`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ai/assistant` | Overview (extended, section 4) |
| POST | `/api/ai/assistant/ask` | Legacy one-shot answer. Keep its response shape; tests and `ai:live-eval` use it |
| POST | `/api/ai/assistant/chat` | Send a message; SSE stream or JSON (section 5) |
| GET | `/api/ai/assistant/conversations` | List, newest first, `?search=` optional, 50 at most |
| GET | `/api/ai/assistant/conversations/{conversation}` | One conversation with all messages |
| PATCH | `/api/ai/assistant/conversations/{conversation}` | Rename: `{ title }` (1 to 160 chars) |
| DELETE | `/api/ai/assistant/conversations/{conversation}` | Delete one |
| DELETE | `/api/ai/assistant/conversations` | Delete all of the user's conversations in the current scope |
| POST | `/api/ai/assistant/messages/{message}/feedback` | `{ rating: "up" | "down" | null }`, assistant messages only |
| GET | `/api/ai/assistant/memories` | List |
| POST | `/api/ai/assistant/memories` | `{ content }` (3 to 300 chars), 30 per user scope at most (422 beyond) |
| DELETE | `/api/ai/assistant/memories/{memory}` | Delete one |
| DELETE | `/api/ai/assistant/memories` | Delete all in the current scope |

None of these is a client page route, so `server/config/client_routes.php` does not change. The page stays at
`/dashboard/ask-ai`; a conversation is addressed as `/dashboard/ask-ai?c=<id>`, and the existing deep link
`/dashboard/ask-ai?q=<question>&topic=<topic>` starts a new conversation with that question.

## 3. JSON shapes

Conversation (list item and detail header):
```json
{ "id": 12, "title": "Who has not submitted requirements", "last_message_at": "2026-11-14T09:12:00+08:00",
  "preview": "Three organizations still owe ...", "message_count": 6 }
```
`preview` is the first 140 characters of the last assistant message with Markdown stripped.

Message:
```json
{
  "id": 88,
  "conversation_id": 12,
  "role": "assistant",
  "content": "Markdown text of the answer",
  "status": "completed",
  "feedback": null,
  "created_at": "2026-11-14T09:12:04+08:00",
  "payload": {
    "title": "Missing requirements",
    "intent": "missing_submissions",
    "engine": "claude",
    "model_written": true,
    "highlights": [ { "label": "Organizations missing files", "value": "3", "tone": "danger" } ],
    "sections": [ { "id": "...", "title": "...", "description": "...", "layout": "table|steps", "empty_message": "...",
                    "rows": [ { "id": "...", "primary": "...", "secondary": "...", "status": "...", "status_tone": "...",
                                "meta": "...", "href": "/dashboard/...", "action_label": "Open", "ask_question": "...",
                                "step": 1, "progress_percent": 40 } ] } ],
    "charts": [ { "id": "...", "type": "bar|distribution", "title": "...", "items": [ { "label": "...", "value": 3,
                  "display_value": "3", "percent": 60, "tone": "primary" } ] } ],
    "recommended_action": { "title": "...", "detail": "...", "href": "/dashboard/...", "action_label": "Open" },
    "follow_ups": [ { "label": "...", "question": "...", "topic": "..." } ],
    "reasoning": {
      "seconds": 6,
      "steps": [ "Understood this as a question about missing requirements",
                 "Read 142 records across compliance and finance",
                 "Checked every number in the answer against those records" ],
      "summary": "The model's own summarized thinking, or null"
    },
    "notice": "null, or one short sentence such as: The written answer was replaced with the verified summary."
  }
}
```
A user message has `payload: null`, `status: "completed"`.

`engine` is `claude`, `groq` or `records` (deterministic text). `sections`, `highlights`, `charts`,
`recommended_action` and `follow_ups` are the same structures `AskAiService` builds today (`recommended_action` is today's
`formatted_blocks.recommended_action`). Every `href` anywhere in a payload has passed `ClientRouteAccess` for the user's
role; a link that fails is dropped, never sent.

Memory: `{ "id": 4, "content": "I am the treasurer, keep answers short", "created_at": "..." }`.

## 4. Overview (`GET /api/ai/assistant`) additions

Keep every existing key. Add:
```json
{
  "user_first_name": "Jade",
  "model_enabled": true,
  "memory_count": 2,
  "starter_prompts": [ { "id": "...", "label": "What should I do today?", "question": "...", "topic": "daily_priorities" } ]
}
```
`starter_prompts` is at most 6 for the role (the existing `suggested_questions`, filtered by what the role may ask, are the
source; `suggested_questions` itself stays for compatibility). `model_enabled` is true when a provider key is configured.

## 5. `POST /api/ai/assistant/chat`

Request body:
```json
{ "conversation_id": 12, "message": "what about finance?", "topic": null, "regenerate": false }
```
- `message`: required unless `regenerate` is true; string, 1 to 2000 characters after trim.
- `conversation_id`: nullable. Null starts a new conversation (title = the question, trimmed to 80 characters on a word
  boundary, no trailing punctuation).
- `topic`: nullable intent key from a starter prompt or follow-up chip.
- `regenerate`: when true, `conversation_id` is required; the last assistant message of that conversation is deleted and
  answered again from the last user message. 422 when there is nothing to regenerate.

Response, chosen by the `Accept` header:

**`Accept: text/event-stream`** returns `200 text/event-stream` with headers `Cache-Control: no-cache, no-transform`,
`X-Accel-Buffering: no`, `Connection: keep-alive`. Validation, auth and throttle failures are still ordinary JSON error
responses with their usual status, sent before any stream starts. Each event is `event: <name>\n` + `data: <one-line JSON>\n\n`:

| Event | Data | When |
|---|---|---|
| `meta` | `{ "conversation": Conversation, "user_message": Message }` | First, once the user message is stored |
| `status` | `{ "stage": "reading" | "thinking" | "writing", "label": "Reading your records" }` | As the stage changes |
| `reasoning` | `{ "delta": "text" }` | Model thinking summary as it arrives (may never fire) |
| `delta` | `{ "text": "verified Markdown fragment" }` | Answer text, already checked (see 6.4) |
| `replace` | `{ "text": "full replacement Markdown", "notice": "..." }` | The streamed text must be discarded and replaced |
| `done` | `{ "conversation": Conversation, "message": Message }` | Last event on success; `message` is the stored assistant message |
| `error` | `{ "message": "Could not answer that right now. Try again." }` | Last event on failure after the stream began |

A `: keep-alive` comment line may be sent at any time. Concatenating every `delta.text` (or the last `replace.text`) equals
`done.message.content`.

**Any other `Accept`** returns `200 application/json`:
`{ "conversation": Conversation, "user_message": Message, "message": Message }`.

Stop: the client aborts the request. The server notices the closed connection, stores what was verified so far as the
assistant message with `status: "stopped"` (or stores nothing if no text was verified), and ends quietly.

## 6. Server behaviour

6.1 **Intent with context.** Classify with the existing `classifyIntent`. When the result is the generic `semantic_rag`
and the message reads as a follow-up (short, or leans on "that", "those", "it", "them", "more", "why", "explain",
"what about", "and ...") and the conversation's last assistant message has an intent, reuse that intent so the same
records are read again. New small intents handled without record lookups: greeting or thanks, "what can you do" (a
role-specific capabilities answer built from the role's allowed intents), and memory commands (6.5).

6.2 **Facts.** Build the deterministic payload exactly as `AskAiService::answer` does (expose what is needed; do not
duplicate the builders). Facts sent to the model: the user's first name, role name, scope label, today's date written out
(for example "Saturday, November 14, 2026") and the active semester label when one exists, the saved memories, the
deterministic answer, highlights, sections (up to 12 rows each, including `href` and `action_label`), the retrieved record
chunks, and for a how-to question the guide's steps. How-to answers now also go through the model.

6.3 **Model call.** Add to `App\Contracts\TextGenerator`:
```php
/**
 * A multi-turn answer. $messages is oldest first and ends with the user's turn.
 * $onEvent, when given, receives ('reasoning', string $delta), ('text', string $delta) and ('reset', '') when
 * everything streamed so far must be thrown away because another provider is about to answer.
 *
 * @param  array<int, array{role: 'user'|'assistant', content: string}>  $messages
 * @return array{text: string, reasoning: ?string, model: string, response_id: ?string}|null
 */
public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array;
```
- `ClaudeMessagesService::converse` uses `messages->createStream(...)` with
  `thinking: ['type' => 'adaptive', 'display' => 'summarized']`, `outputConfig` effort from the new config key
  `services.anthropic.chat_effort` (env `ANTHROPIC_CHAT_EFFORT`, default `medium`), and a total timeout from
  `services.anthropic.chat_timeout` (env `ANTHROPIC_CHAT_TIMEOUT`, default 60 seconds). The system prompt is sent as an
  array of text blocks with `cacheControl => ['type' => 'ephemeral']` on the stable instructions block. Do not send
  `temperature`, `top_p`, `top_k` or `budget_tokens` (the model rejects them). A stop reason other than `end_turn` is a
  failure (null), as it is today. Never log prompt text or user text. Read the installed SDK under
  `server/vendor/anthropic-ai/sdk` for the exact event and delta class names; do not guess them.
- `GroqResponsesService::converse` sends the turns as the Responses API `input` array, non-streaming, and reports the
  whole text through one `('text', ...)` event.
- `FallbackTextGenerator::converse` tries the primary then the secondary, and fires `('reset', '')` before the secondary
  when the primary had already emitted anything.
- Every other `TextGenerator` implementation in the repository (`Evaluation\RecordingTextGenerator`, test fakes) gains the
  method so the suite still passes.

History sent to the model: the last 8 messages of the conversation at most (user text and assistant Markdown only, each cut
to 1,500 characters), then the current user turn, which carries the facts as a JSON block followed by the question.

6.4 **Checked streaming.** Buffer the model's text and release it line by line (on `\n`, and at the end). Before a
line is released it must pass the numeric guard against the facts, the conversation text, the memories and the question.
The guard becomes Markdown-aware: ordered-list markers (`1.`, `2)`), heading hashes, table pipes and link targets are not
numbers; a date in the facts written `2026-11-14` allows 2026, 11 and 14. On the first line that fails: stop releasing,
send `replace` with the deterministic answer and a one-sentence `notice`, store that, and set `model_written: false`.
After the guard, sanitize: strip every HTML tag that is not in the allow-list of section 8, strip every attribute except
`class` (allow-listed values) and `value`/`max` on `progress`, and rewrite any Markdown link whose target is not an
`href` that appears in the facts or passes `ClientRouteAccess` for the role into plain text.

6.5 **Memory.** "remember that ...", "remember: ...", "please remember ..." saves the rest as a memory (trimmed, 300
characters, 30 at most) and answers "Saved to memory: ..." without a model call. "what do you remember" lists them.
"forget everything" / "clear your memory" deletes them all. Memories are passed to the model as things the user asked it
to keep in mind; they are data and never override the rules.

6.6 **Instructions.** Add `AiInstructions::askAiChat()` for the conversation. It keeps the grounding and money rules and
replaces the "three sentences, plain text" rule with: answer the question in the first sentence; then give what matters
most and why, in the order the user should act; name records exactly; end with the next step and link the page when a
link is supplied in the facts (`[Open compliance](/dashboard/...)`); use Markdown (short paragraphs, bullets, numbered
steps, a small table only when comparing a few items on two or more attributes) and the HTML components of section 8
only where they make the answer easier to scan; do not repeat the full record list because the page shows the records
under the answer; 180 words at most unless the user asks for more detail; write for the role; help with general
student-organization work (drafting a message, an agenda, a checklist, explaining how HIUSA works) using a bracketed
placeholder for any fact that was not supplied; decline anything unrelated to school or organization work in one sentence.
`AiInstructions::askAi()` (the one-shot text) stays for the legacy endpoint.

6.7 **Reasoning trace.** `payload.reasoning.steps` is built by the server from what it actually did (the intent in plain
words, how many records in which areas, whether the model wrote the answer, that numbers were checked). No engine jargon
("RAG", "BM25", "vector") in any step. `summary` is the model's summarized thinking when the provider returned one.

## 7. Client ownership

Frontend builder owns: `client/src/pages/modules/ai/*`, `client/src/components/ai/*` (new chat components go here),
`client/src/services/askAiService.js`, `client/src/components/dashboard/AskAiSpotlight.jsx`, the Ask AI entry of
`client/src/lib/pageMeta.js`, the client stylesheet (only to add the `.ai-prose` rules), and their tests. It may read but
not restructure anything else. `react-markdown`, `remark-gfm`, `rehype-raw` and `rehype-sanitize` are already installed;
add no other dependency.

`askAiService.js` exports (names are part of the contract): `getAiAssistantOverview`, `askAiAssistant` (legacy, used by
the dashboard spotlight), `streamAiChat({ conversationId, message, topic, regenerate, signal, onEvent })`,
`listAiConversations(params)`, `getAiConversation(id)`, `renameAiConversation(id, title)`, `deleteAiConversation(id)`,
`deleteAllAiConversations()`, `sendAiMessageFeedback(messageId, rating)`, `listAiMemories()`, `addAiMemory(content)`,
`deleteAiMemory(id)`, `deleteAllAiMemories()`.

`streamAiChat` uses `fetch` (Axios cannot stream in the browser) against the same base URL the Axios instance uses, sends
`Authorization: Bearer <auth_token>`, `Accept: text/event-stream`, `Content-Type: application/json` and the
`X-Academic-Semester` header exactly as `api.js` does, parses SSE incrementally with a `ReadableStream` reader, and
handles a JSON body (non-stream fallback) the same way as a stream that only sent `meta` and `done`. A 401 must behave
as the Axios interceptor does (clear the session, go to sign in). After a successful send it clears the API GET cache.

## 8. HTML the model may use inside Markdown (allow-list)

Tags: `div`, `span`, `details`, `summary`, `mark`, `kbd`, `sub`, `sup`, `br`, `hr`, `progress` (plus everything
Markdown itself produces). Attributes: `class` on `div` and `span` only, limited to these values, and `value` + `max` on
`progress`. No `style`, no `id`, no event handlers, no `img`, no `iframe`.

| Class | On | Renders as |
|---|---|---|
| `callout callout-info` / `callout-success` / `callout-warning` / `callout-danger` | `div` | A bordered note with a left accent in the tone colour |
| `badge badge-info` / `badge-success` / `badge-warning` / `badge-danger` / `badge-neutral` | `span` | A status pill (the app's badge look) |
| `stat-grid` | `div` | A responsive row of stats |
| `stat` | `div` inside `stat-grid` | One stat |
| `stat-value`, `stat-label` | `span` inside `stat` | The number and its label |

Colours and type come only from the HIUSA tokens (Poppins, the exact palette in CLAUDE.md). The server strips anything
outside this list; the client sanitizes again with the same list.
