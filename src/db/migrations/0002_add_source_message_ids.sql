ALTER TABLE "cards"
  ADD COLUMN IF NOT EXISTS "source_message_ids" text;
