# Reminder Queue API

Backend contract for the Mini App pull-to-view reminder queue.

All endpoints are Telegram Mini App authenticated and owner-only for now. The current owner check uses `BACKLOG_OWNER_USER_ID`.

## Scope model

Reminders now have an explicit queue scope:

- `queueScopeType = "user"` and `queueScopeId = userId` — personal queue.
- `queueScopeType = "chat"` and `queueScopeId = telegramChatId` — queue bound to a Telegram chat.

`cards.user_id` and `reminder_jobs.user_id` still mean the creating/owning Telegram user. Queue ordering, delivery collision planning, and reminder delivery use the queue scope. Existing Mini App endpoints below continue to read the personal user scope only; chat-scoped queues are backend-ready but do not yet have a Mini App selector.

Telegram group entrypoint:

- with BotFather privacy mode disabled, the primary UX is `@BotUsername text` in a group, or replying to a message with `@BotUsername`;
- group/supergroup messages that do not start with `@BotUsername` are dropped before auth, DB writes, parsers, or app logs;
- fallback explicit commands remain supported: `/add@BotUsername text`, `/learn@BotUsername text`, `/remind@BotUsername text`, or a reply command;
- inline mode can show helper actions, but it is not the source of truth for creating a chat queue item because selected inline results do not provide a normal chat-bound creation command to this bot.

## Queue

`GET /api/miniapp/queue?limit=20`

Returns reminders in consumption order:

1. Active reminders waiting for action (`awaiting_action` jobs).
2. Orphan cards in `awaiting_grade`.
3. Future `learning` cards ordered by `nextReviewAt`.

Response shape:

```json
{
  "data": {
    "items": [
      {
        "id": "job-or-card-id",
        "kind": "awaiting_review",
        "card": {},
        "job": {},
        "availableAt": "2026-05-20T10:00:00.000Z",
        "isDue": true
      }
    ],
    "count": 1,
    "next": {}
  }
}
```

`kind` is one of:

- `awaiting_review`
- `one_time`
- `scheduled_review`

If `job` is present, the frontend should pass `job.id` as `jobId` in action calls.

## Actions

All action endpoints use:

```json
{
  "jobId": "optional-current-job-id"
}
```

`POST /api/miniapp/queue/cards/:id/viewed`

Marks the pulled card as consumed. For review cards this applies the normal `ok` review result and schedules the next review. For one-time jobs it completes only the one-time job.

`POST /api/miniapp/queue/cards/:id/not-viewed`

Keeps an active waiting reminder in the queue. If the card is already back in `learning`, it requeues it for now.

`POST /api/miniapp/queue/cards/:id/again`

Applies `again` for review cards. For one-time jobs, snoozes for one hour.

`POST /api/miniapp/queue/cards/:id/reschedule`

Moves the reminder. Body supports either:

```json
{ "jobId": "optional-current-job-id", "minutes": 60 }
```

or:

```json
{ "jobId": "optional-current-job-id", "remindAt": "2026-05-20T15:00:00.000Z" }
```

`POST /api/miniapp/queue/cards/:id/archive`

Archives the card and cancels active reminder jobs.
