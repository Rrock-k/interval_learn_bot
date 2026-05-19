# Reminder Queue API

Backend contract for the Mini App pull-to-view reminder queue.

All endpoints are Telegram Mini App authenticated and owner-only for now. The current owner check uses `BACKLOG_OWNER_USER_ID`.

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
