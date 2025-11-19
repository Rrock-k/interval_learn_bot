DO $$ BEGIN
 ALTER TABLE "cards" ADD CONSTRAINT "cards_status_check" CHECK ("cards"."status" IN ('pending', 'learning', 'awaiting_grade', 'archived'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('pending', 'approved', 'rejected'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
