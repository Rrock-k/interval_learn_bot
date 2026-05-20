import { pgTable, text, integer, index, check, serial, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    status: text('status').notNull(), // 'pending' | 'approved' | 'rejected'
    notificationChatId: text('notification_chat_id'),
    timezone: text('timezone').notNull().default('Asia/Tbilisi'),
    activeHoursStart: integer('active_hours_start').notNull().default(600),
    activeHoursEnd: integer('active_hours_end').notNull().default(1320),
    reminderMinGapMinutes: integer('reminder_min_gap_minutes').notNull().default(30),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'users_status_check',
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
  ],
);

export const cards = pgTable(
  'cards',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    queueScopeType: text('queue_scope_type').notNull().default('user'),
    queueScopeId: text('queue_scope_id').notNull(),
    sourceChatId: text('source_chat_id').notNull(),
    sourceMessageId: integer('source_message_id').notNull(),
    sourceMessageIds: text('source_message_ids'),
    contentType: text('content_type').notNull(),
    contentPreview: text('content_preview'),
    contentFileId: text('content_file_id'),
    contentFileUniqueId: text('content_file_unique_id'),
    reminderMode: text('reminder_mode').notNull().default('sm2'),
    scheduleRule: text('schedule_rule'),
    status: text('status').notNull(), // 'pending' | 'learning' | 'awaiting_grade' | 'archived'
    repetition: integer('repetition').notNull().default(0),
    nextReviewAt: text('next_review_at'),
    lastReviewedAt: text('last_reviewed_at'),
    pendingChannelId: text('pending_channel_id'),
    pendingChannelMessageId: integer('pending_channel_message_id'),
    baseChannelMessageId: integer('base_channel_message_id'),
    awaitingGradeSince: text('awaiting_grade_since'),
    lastNotificationAt: text('last_notification_at'),
    lastNotificationReason: text('last_notification_reason'),
    lastNotificationMessageId: integer('last_notification_message_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_cards_status_next_review').on(
      table.status,
      table.nextReviewAt,
    ),
    index('idx_cards_status_awaiting_since').on(
      table.status,
      table.awaitingGradeSince,
    ),
    check(
      'cards_status_check',
      sql`${table.status} IN ('pending', 'learning', 'awaiting_grade', 'archived')`,
    ),
    check(
      'cards_reminder_mode_check',
      sql`${table.reminderMode} IN ('sm2', 'schedule')`,
    ),
    check(
      'cards_queue_scope_type_check',
      sql`${table.queueScopeType} IN ('user', 'chat')`,
    ),
    index('idx_cards_queue_scope_status_next_review').on(
      table.queueScopeType,
      table.queueScopeId,
      table.status,
      table.nextReviewAt,
    ),
  ],
);

export const backlogItems = pgTable(
  'backlog_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    sourceChatId: text('source_chat_id').notNull(),
    sourceMessageId: integer('source_message_id').notNull(),
    sourceMessageIds: text('source_message_ids'),
    contentType: text('content_type').notNull(),
    contentPreview: text('content_preview'),
    contentFileId: text('content_file_id'),
    contentFileUniqueId: text('content_file_unique_id'),
    status: text('status').notNull().default('open'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_backlog_items_status_created').on(table.status, table.createdAt),
    check(
      'backlog_items_status_check',
      sql`${table.status} IN ('open', 'done', 'archived')`,
    ),
  ],
);

export const unrecognizedSchedules = pgTable('unrecognized_schedules', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  input: text('input').notNull(),
  createdAt: text('created_at').notNull(),
});

export const appUsers = pgTable(
  'app_users',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name'),
    email: text('email'),
    avatarUrl: text('avatar_url'),
    primaryTelegramUserId: text('primary_telegram_user_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_app_users_primary_telegram_user_id').on(table.primaryTelegramUserId),
    index('idx_app_users_email').on(table.email),
  ],
);

export const userAuthAccounts = pgTable(
  'user_auth_accounts',
  {
    id: text('id').primaryKey(),
    appUserId: text('app_user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    email: text('email'),
    username: text('username'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    rawProfile: text('raw_profile'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_user_auth_accounts_provider_account').on(table.provider, table.providerAccountId),
    index('idx_user_auth_accounts_app_user').on(table.appUserId),
    check(
      'user_auth_accounts_provider_check',
      sql`${table.provider} IN ('telegram', 'google')`,
    ),
  ],
);

export const webSessions = pgTable(
  'web_sessions',
  {
    id: text('id').primaryKey(),
    appUserId: text('app_user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_web_sessions_token_hash').on(table.tokenHash),
    index('idx_web_sessions_app_user').on(table.appUserId),
    index('idx_web_sessions_expires_at').on(table.expiresAt),
  ],
);

export const courses = pgTable(
  'courses',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('draft'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_courses_owner_status').on(table.ownerUserId, table.status),
    check(
      'courses_status_check',
      sql`${table.status} IN ('draft', 'active', 'archived')`,
    ),
  ],
);

export const courseSteps = pgTable(
  'course_steps',
  {
    id: text('id').primaryKey(),
    courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').notNull().default('material'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_course_steps_course_position').on(table.courseId, table.position),
    check(
      'course_steps_kind_check',
      sql`${table.kind} IN ('material', 'practice', 'question')`,
    ),
  ],
);

export const courseEnrollments = pgTable(
  'course_enrollments',
  {
    id: text('id').primaryKey(),
    courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    queueScopeType: text('queue_scope_type').notNull().default('user'),
    queueScopeId: text('queue_scope_id').notNull(),
    status: text('status').notNull().default('active'),
    cadence: text('cadence').notNull().default('after_view'),
    nextStepPosition: integer('next_step_position').notNull().default(1),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_course_enrollments_scope_status').on(
      table.queueScopeType,
      table.queueScopeId,
      table.status,
    ),
    check(
      'course_enrollments_status_check',
      sql`${table.status} IN ('active', 'completed', 'paused', 'archived')`,
    ),
    check(
      'course_enrollments_cadence_check',
      sql`${table.cadence} IN ('after_view', 'daily')`,
    ),
    check(
      'course_enrollments_queue_scope_type_check',
      sql`${table.queueScopeType} IN ('user', 'chat')`,
    ),
  ],
);

export const courseStepDeliveries = pgTable(
  'course_step_deliveries',
  {
    id: text('id').primaryKey(),
    enrollmentId: text('enrollment_id').notNull().references(() => courseEnrollments.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull().references(() => courseSteps.id, { onDelete: 'cascade' }),
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('queued'),
    releasedAt: text('released_at').notNull(),
    viewedAt: text('viewed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_course_step_deliveries_enrollment_step').on(table.enrollmentId, table.stepId),
    index('idx_course_step_deliveries_card_status').on(table.cardId, table.status),
    check(
      'course_step_deliveries_status_check',
      sql`${table.status} IN ('queued', 'viewed', 'skipped')`,
    ),
  ],
);

export const reminderJobs = pgTable(
  'reminder_jobs',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    queueScopeType: text('queue_scope_type').notNull().default('user'),
    queueScopeId: text('queue_scope_id').notNull(),
    kind: text('kind').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull(),
    dueAt: text('due_at').notNull(),
    scheduledAt: text('scheduled_at').notNull(),
    sentAt: text('sent_at'),
    completedAt: text('completed_at'),
    deliveryChatId: text('delivery_chat_id'),
    deliveryMessageId: integer('delivery_message_id'),
    baseMessageId: integer('base_message_id'),
    snoozedFromJobId: text('snoozed_from_job_id'),
    error: text('error'),
    metadata: text('metadata'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_reminder_jobs_pending_schedule').on(table.status, table.scheduledAt),
    index('idx_reminder_jobs_card_status').on(table.cardId, table.status),
    check(
      'reminder_jobs_kind_check',
      sql`${table.kind} IN ('review', 'one_time', 'manual_now')`,
    ),
    check(
      'reminder_jobs_status_check',
      sql`${table.status} IN ('pending', 'sending', 'awaiting_action', 'completed', 'snoozed', 'cancelled', 'failed')`,
    ),
    check(
      'reminder_jobs_queue_scope_type_check',
      sql`${table.queueScopeType} IN ('user', 'chat')`,
    ),
    index('idx_reminder_jobs_scope_pending_schedule').on(
      table.queueScopeType,
      table.queueScopeId,
      table.status,
      table.scheduledAt,
    ),
  ],
);
