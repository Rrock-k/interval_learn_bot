ALTER TABLE "cards" ADD COLUMN "schedule_rule" text;
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_reminder_mode_check";
--> statement-breakpoint
UPDATE "cards" SET schedule_rule = '{"type":"days","interval":1}', reminder_mode = 'schedule' WHERE reminder_mode = 'daily';
--> statement-breakpoint
UPDATE "cards" SET schedule_rule = '{"type":"days","interval":7}', reminder_mode = 'schedule' WHERE reminder_mode = 'weekly';
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_reminder_mode_check" CHECK ("cards"."reminder_mode" IN ('sm2', 'schedule'));
