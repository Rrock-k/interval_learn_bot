import { pgTable, text, integer, index, check } from 'drizzle-orm/pg-core';
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
    sourceChatId: text('source_chat_id').notNull(),
    sourceMessageId: integer('source_message_id').notNull(),
    sourceMessageIds: text('source_message_ids'),
    contentType: text('content_type').notNull(),
    contentPreview: text('content_preview'),
    contentFileId: text('content_file_id'),
    contentFileUniqueId: text('content_file_unique_id'),
    reminderMode: text('reminder_mode').notNull().default('sm2'),
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
      sql`${table.reminderMode} IN ('sm2', 'daily', 'weekly')`,
    ),
  ],
);
