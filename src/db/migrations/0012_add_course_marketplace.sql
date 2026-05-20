ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS owner_app_user_id text REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS public_slug text,
  ADD COLUMN IF NOT EXISTS published_at text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'courses_visibility_check'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_visibility_check
      CHECK (visibility IN ('private', 'public'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_public_slug
  ON courses(public_slug);

CREATE INDEX IF NOT EXISTS idx_courses_visibility_published
  ON courses(visibility, published_at);

CREATE INDEX IF NOT EXISTS idx_courses_owner_app_user
  ON courses(owner_app_user_id);
