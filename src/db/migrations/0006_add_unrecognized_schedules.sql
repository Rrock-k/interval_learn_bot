CREATE TABLE IF NOT EXISTS "unrecognized_schedules" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL,
  "input" text NOT NULL,
  "created_at" text NOT NULL
);
