CREATE TABLE IF NOT EXISTS "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_chat_id" text NOT NULL,
	"source_message_id" integer NOT NULL,
	"content_type" text NOT NULL,
	"content_preview" text,
	"content_file_id" text,
	"content_file_unique_id" text,
	"status" text NOT NULL,
	"repetition" integer DEFAULT 0 NOT NULL,
	"interval_days" integer DEFAULT 0 NOT NULL,
	"easiness" real DEFAULT 2.5 NOT NULL,
	"next_review_at" text,
	"last_reviewed_at" text,
	"last_grade" integer,
	"pending_channel_id" text,
	"pending_channel_message_id" integer,
	"base_channel_message_id" integer,
	"awaiting_grade_since" text,
	"last_notification_at" text,
	"last_notification_reason" text,
	"last_notification_message_id" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"status" text NOT NULL,
	"notification_chat_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cards_status_next_review" ON "cards" USING btree ("status","next_review_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cards_status_awaiting_since" ON "cards" USING btree ("status","awaiting_grade_since");
