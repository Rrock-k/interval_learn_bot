ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS queue_scope_type text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS queue_scope_id text;

UPDATE cards
SET queue_scope_id = user_id
WHERE queue_scope_id IS NULL;

ALTER TABLE cards
  ALTER COLUMN queue_scope_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cards_queue_scope_type_check'
  ) THEN
    ALTER TABLE cards
      ADD CONSTRAINT cards_queue_scope_type_check
      CHECK (queue_scope_type IN ('user', 'chat'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cards_queue_scope_status_next_review
  ON cards(queue_scope_type, queue_scope_id, status, next_review_at);

ALTER TABLE reminder_jobs
  ADD COLUMN IF NOT EXISTS queue_scope_type text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS queue_scope_id text;

UPDATE reminder_jobs
SET
  queue_scope_type = COALESCE(cards.queue_scope_type, 'user'),
  queue_scope_id = COALESCE(cards.queue_scope_id, reminder_jobs.user_id)
FROM cards
WHERE reminder_jobs.card_id = cards.id
  AND reminder_jobs.queue_scope_id IS NULL;

UPDATE reminder_jobs
SET queue_scope_id = user_id
WHERE queue_scope_id IS NULL;

ALTER TABLE reminder_jobs
  ALTER COLUMN queue_scope_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminder_jobs_queue_scope_type_check'
  ) THEN
    ALTER TABLE reminder_jobs
      ADD CONSTRAINT reminder_jobs_queue_scope_type_check
      CHECK (queue_scope_type IN ('user', 'chat'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reminder_jobs_scope_pending_schedule
  ON reminder_jobs(queue_scope_type, queue_scope_id, status, scheduled_at);
