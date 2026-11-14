# Ask AI actions: the contract between server and client

The product owner's decision: "It should carry out actions itself if the user says it." The assistant now does
things, not only answers. A person types what they want; the assistant answers with an action card holding the
details it understood, editable; the person presses the card's button; the server carries the action out through the
same endpoint the normal form uses.

Why a button and not immediate execution: record text typed by other people reaches the assistant, and today's security
review showed such text can be shaped to make the assistant act. An action therefore runs only when the signed-in person
presses the button on a card that was proposed in reply to a message they typed.

## Rules

1. An action is proposed only in reply to a message whose `source` is `typed` (the chat request's `source` field;
   absent means typed). A message that came from a link or a prompt button never proposes an action; it gets the
   ordinary answer.
2. An action is carried out only by `POST .../action/confirm` for an assistant message the caller owns
   (`ownedBy`), whose action is `awaiting_confirmation` and not expired (30 minutes). Confirming is single use: the
   status moves in one guarded update, so two presses cannot run it twice.
3. The server executes the action by dispatching an internal request to the existing API route as the same
   authenticated person (same Authorization header), so the role middleware, `org.writable`, validation, approval
   flow, notifications and audit log all apply exactly as they do for the form. No business rule is copied.
4. Values the model extracted are only ever a pre-fill. What runs is what the person sees and confirms.
5. First set of actions: creations and drafts only. No approvals, endorsements, votes, payments, deletions, role
   changes or publishing.
6. With no language model configured the feature still works: the card arrives with the fields empty (or filled by
   simple parsing) and the person fills them in.

## Shapes

An assistant message that proposes an action carries, in `payload`:

```json
"action": {
  "key": "create_event",
  "title": "Create an event",
  "status": "awaiting_confirmation",
  "submit_label": "Create event",
  "fields": [
    { "name": "title", "label": "Title", "type": "text", "required": true, "value": "General Assembly",
      "max": 255, "help": null, "options": null },
    { "name": "start_time", "label": "Starts", "type": "datetime", "required": true, "value": "2026-12-05T15:00",
      "max": null, "help": null, "options": null },
    { "name": "assigned_to", "label": "Assign to", "type": "select", "required": false, "value": null,
      "max": null, "help": "Leave empty to decide later.", "options": [ { "value": "900004", "label": "Ana Cruz, Treasurer" } ] }
  ],
  "errors": {},
  "result": null,
  "expires_at": "2026-11-14T12:30:00+08:00"
}
```

- `type` is one of `text`, `textarea`, `datetime` (value `YYYY-MM-DDTHH:mm`, Asia/Manila wall time), `date`
  (`YYYY-MM-DD`), `number`, `select` (with `options`), `checkbox` (boolean).
- `status` is one of `awaiting_confirmation`, `done`, `cancelled`, `failed`, `expired`.
- `errors` maps a field name to a list of messages after a refused confirm (the real endpoint's 422), plus the key
  `_` for an error that belongs to no field.
- `result`, when `done`: `{ "message": "Event created. It is waiting for approval.", "href": "/dashboard/...",
  "action_label": "Open event" }`. `href` passes ClientRouteAccess for the role or is null.
- The message `content` is one or two plain sentences ("Here is the event I can create. Check the details, then
  press Create event."). Once done, `content` is replaced by the result sentence.

## Routes (auth:sanctum, the same role list as the other Ask AI routes, the AI rate limit)

| Method | Path | Body | Answers |
|---|---|---|---|
| POST | `/api/ai/assistant/messages/{message}/action/confirm` | `{ "fields": { "<name>": <value>, ... } }` | 200 `{ "message": Message }` with the action `done`; or 422 `{ "message": "...", "errors": {...}, "assistant_message": Message }` with the action still `awaiting_confirmation` and its `errors` and field values updated; 409 `{ "message": "..." }` when it is not awaiting confirmation or has expired; 404 outside the owner's scope |
| POST | `/api/ai/assistant/messages/{message}/action/cancel` | none | 200 `{ "message": Message }` with the action `cancelled` |

The chat stream for a proposal is `meta`, one `delta` with the content, then `done` with the stored message (no
`status` events are required). A proposal makes no change to any record.

## Client

`askAiService.js` gains `confirmAiAction(messageId, fields)` and `cancelAiAction(messageId)` (Axios promises). The
chat request gains `source: "typed" | "link"`: `typed` only when the person typed the message in the composer and
pressed send; every other origin (the `?q=` link, starter prompts, follow-up chips, "Show steps" buttons, Try again of
such a message) is `link`.

A new `ActionCard` component renders `payload.action` inside the assistant message, under the text: the title, the
fields as a real form built from the UI kit (labels above inputs, required marks, help text, errors under their
field), the primary button with `submit_label`, and a secondary Cancel. While confirming the button shows its loading
state and the fields are read only. `done` shows the result sentence and its link button and no form; `cancelled`,
`failed` and `expired` show one muted line and no form. Only the newest card in a conversation that is still
`awaiting_confirmation` is live; an older one is shown read only.
