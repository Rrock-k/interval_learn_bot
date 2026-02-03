ALTER TABLE "cards" ADD COLUMN "reminder_mode" text NOT NULL DEFAULT 'sm2';
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_reminder_mode_check" CHECK (reminder_mode IN ('sm2', 'daily', 'weekly'));
