CREATE TABLE IF NOT EXISTS courses (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT courses_status_check CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_courses_owner_status
  ON courses(owner_user_id, status);

CREATE TABLE IF NOT EXISTS course_steps (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position integer NOT NULL,
  kind text NOT NULL DEFAULT 'material',
  title text NOT NULL,
  body text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT course_steps_kind_check CHECK (kind IN ('material', 'practice', 'question'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_steps_course_position
  ON course_steps(course_id, position);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  queue_scope_type text NOT NULL DEFAULT 'user',
  queue_scope_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  cadence text NOT NULL DEFAULT 'after_view',
  next_step_position integer NOT NULL DEFAULT 1,
  started_at text NOT NULL,
  completed_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT course_enrollments_status_check CHECK (status IN ('active', 'completed', 'paused', 'archived')),
  CONSTRAINT course_enrollments_cadence_check CHECK (cadence IN ('after_view', 'daily')),
  CONSTRAINT course_enrollments_queue_scope_type_check CHECK (queue_scope_type IN ('user', 'chat'))
);

CREATE INDEX IF NOT EXISTS idx_course_enrollments_scope_status
  ON course_enrollments(queue_scope_type, queue_scope_id, status);

CREATE TABLE IF NOT EXISTS course_step_deliveries (
  id text PRIMARY KEY,
  enrollment_id text NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  step_id text NOT NULL REFERENCES course_steps(id) ON DELETE CASCADE,
  card_id text REFERENCES cards(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued',
  released_at text NOT NULL,
  viewed_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT course_step_deliveries_status_check CHECK (status IN ('queued', 'viewed', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_step_deliveries_enrollment_step
  ON course_step_deliveries(enrollment_id, step_id);

CREATE INDEX IF NOT EXISTS idx_course_step_deliveries_card_status
  ON course_step_deliveries(card_id, status);

