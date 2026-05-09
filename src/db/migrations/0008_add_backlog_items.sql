CREATE TABLE IF NOT EXISTS "backlog_items" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "source_chat_id" text NOT NULL,
  "source_message_id" integer NOT NULL,
  "source_message_ids" text,
  "content_type" text NOT NULL,
  "content_preview" text,
  "content_file_id" text,
  "content_file_unique_id" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "backlog_items_status_check" CHECK ("status" IN ('open', 'done', 'archived'))
);

CREATE INDEX IF NOT EXISTS "idx_backlog_items_status_created"
  ON "backlog_items" ("status", "created_at");
