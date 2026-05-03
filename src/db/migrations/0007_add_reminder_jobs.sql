ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Tbilisi',
  ADD COLUMN IF NOT EXISTS active_hours_start integer NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS active_hours_end integer NOT NULL DEFAULT 1320,
  ADD COLUMN IF NOT EXISTS reminder_min_gap_minutes integer NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS reminder_jobs (
  id text PRIMARY KEY,
  card_id text NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  source text NOT NULL,
  status text NOT NULL,
  due_at text NOT NULL,
  scheduled_at text NOT NULL,
  sent_at text,
  completed_at text,
  delivery_chat_id text,
  delivery_message_id integer,
  base_message_id integer,
  snoozed_from_job_id text REFERENCES reminder_jobs(id) ON DELETE SET NULL,
  error text,
  metadata text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT reminder_jobs_kind_check CHECK (kind IN ('review', 'one_time', 'manual_now')),
  CONSTRAINT reminder_jobs_status_check CHECK (status IN ('pending', 'sending', 'awaiting_action', 'completed', 'snoozed', 'cancelled', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_reminder_jobs_pending_schedule
  ON reminder_jobs(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_reminder_jobs_card_status
  ON reminder_jobs(card_id, status);

INSERT INTO reminder_jobs (
  id,
  card_id,
  user_id,
  kind,
  source,
  status,
  due_at,
  scheduled_at,
  sent_at,
  completed_at,
  delivery_chat_id,
  delivery_message_id,
  base_message_id,
  created_at,
  updated_at
)
SELECT
  md5(random()::text || clock_timestamp()::text || id),
  id,
  user_id,
  'review',
  'migration',
  CASE WHEN status = 'awaiting_grade' THEN 'awaiting_action' ELSE 'pending' END,
  COALESCE(next_review_at, updated_at),
  COALESCE(next_review_at, updated_at),
  CASE WHEN status = 'awaiting_grade' THEN awaiting_grade_since ELSE NULL END,
  NULL,
  pending_channel_id,
  pending_channel_message_id,
  base_channel_message_id,
  updated_at,
  updated_at
FROM cards
WHERE status IN ('learning', 'awaiting_grade')
  AND next_review_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM reminder_jobs
    WHERE reminder_jobs.card_id = cards.id
      AND reminder_jobs.kind = 'review'
      AND reminder_jobs.status IN ('pending', 'awaiting_action')
  );
