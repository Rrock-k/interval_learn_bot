import { Pool, PoolClient, PoolConfig } from 'pg';
import { v4 as uuid } from 'uuid';
import { withDbRetry } from './utils/dbRetry';
import {
  DEFAULT_DELIVERY_SETTINGS,
  DeliverySettings,
  planReminderDelivery,
} from './reminderPlanner';
import {
  ReminderRebalancePreview,
  ReminderRebalancePreviewChange,
  buildReminderRebalancePreview,
} from './reminderRebalance';
import { buildCourseStepCardText, CourseStepKind } from './courses';

export type CardStatus = 'pending' | 'learning' | 'awaiting_grade' | 'archived';
export type BacklogItemStatus = 'open' | 'done' | 'archived';
export type NotificationReason = 'scheduled' | 'manual_now' | 'manual_override' | 'one_time';
export type ReminderJobKind = 'review' | 'one_time' | 'manual_now';
export type ReminderJobStatus =
  | 'pending'
  | 'sending'
  | 'awaiting_action'
  | 'completed'
  | 'snoozed'
  | 'cancelled'
  | 'failed';
export type QueueScopeType = 'user' | 'chat';
export type CourseStatus = 'draft' | 'active' | 'archived';
export type CourseEnrollmentStatus = 'active' | 'completed' | 'paused' | 'archived';
export type CourseCadence = 'after_view' | 'daily';
export type AuthProvider = 'telegram' | 'google';

export interface QueueScope {
  type: QueueScopeType;
  id: string;
}

export interface CardRecord {
  id: string;
  userId: string;
  queueScopeType: QueueScopeType;
  queueScopeId: string;
  sourceChatId: string;
  sourceMessageId: number;
  sourceMessageIds: number[] | null;
  contentType: string;
  contentPreview: string | null;
  contentFileId: string | null;
  contentFileUniqueId: string | null;
  reminderMode: ReminderMode;
  scheduleRule: string | null;
  status: CardStatus;
  repetition: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  pendingChannelId: string | null;
  pendingChannelMessageId: number | null;
  baseChannelMessageId: number | null;
  awaitingGradeSince: string | null;
  lastNotificationAt: string | null;
  lastNotificationReason: NotificationReason | null;
  lastNotificationMessageId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BacklogItemRecord {
  id: string;
  userId: string;
  sourceChatId: string;
  sourceMessageId: number;
  sourceMessageIds: number[] | null;
  contentType: string;
  contentPreview: string | null;
  contentFileId: string | null;
  contentFileUniqueId: string | null;
  status: BacklogItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePendingCardInput {
  id: string;
  userId: string;
  queueScopeType?: QueueScopeType;
  queueScopeId?: string;
  sourceChatId: string;
  sourceMessageId: number;
  sourceMessageIds?: number[] | null;
  contentType: string;
  contentPreview: string | null;
  contentFileId: string | null;
  contentFileUniqueId: string | null;
  reminderMode: ReminderMode;
  scheduleRule?: string | null;
}

export interface ActivateCardInput {
  nextReviewAt: string;
}

export interface AwaitingGradeInput {
  cardId: string;
  channelId: string;
  channelMessageId: number;
  pendingSince: string;
  baseMessageId?: number | null;
}

export interface ReviewResultInput {
  cardId: string;
  nextReviewAt: string;
  repetition: number;
  reviewedAt: string;
}

export interface ListCardsParams {
  status?: CardStatus | undefined;
  limit?: number | undefined;
}

export interface ListBacklogItemsParams {
  status?: BacklogItemStatus | undefined;
  limit?: number | undefined;
}

export interface ReminderRebalanceOptions {
  horizonDays: number;
  bucketMinutes: number;
}

export interface RecordNotificationInput {
  cardId: string;
  jobId?: string | null;
  messageId: number;
  reason: NotificationReason;
  sentAt: string;
}

export interface ReminderJobRecord {
  id: string;
  cardId: string;
  userId: string;
  queueScopeType: QueueScopeType;
  queueScopeId: string;
  kind: ReminderJobKind;
  source: string;
  status: ReminderJobStatus;
  dueAt: string;
  scheduledAt: string;
  sentAt: string | null;
  completedAt: string | null;
  deliveryChatId: string | null;
  deliveryMessageId: number | null;
  baseMessageId: number | null;
  snoozedFromJobId: string | null;
  error: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderJobWithCard {
  job: ReminderJobRecord;
  card: CardRecord;
}

export type ReminderQueueItemKind =
  | 'awaiting_review'
  | 'one_time'
  | 'scheduled_review';

export interface ReminderQueueItem {
  id: string;
  kind: ReminderQueueItemKind;
  card: CardRecord;
  job: ReminderJobRecord | null;
  availableAt: string | null;
  isDue: boolean;
}

export interface CourseRecord {
  id: string;
  ownerUserId: string;
  title: string;
  description: string | null;
  status: CourseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CourseStepRecord {
  id: string;
  courseId: string;
  position: number;
  kind: CourseStepKind;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CourseEnrollmentRecord {
  id: string;
  courseId: string;
  userId: string;
  queueScopeType: QueueScopeType;
  queueScopeId: string;
  status: CourseEnrollmentStatus;
  cadence: CourseCadence;
  nextStepPosition: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseStepDeliveryRecord {
  id: string;
  enrollmentId: string;
  stepId: string;
  cardId: string | null;
  status: 'queued' | 'viewed' | 'skipped';
  releasedAt: string;
  viewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseStepReleaseResult {
  enrollment: CourseEnrollmentRecord;
  step: CourseStepRecord | null;
  card: CardRecord | null;
  delivery: CourseStepDeliveryRecord | null;
  completed: boolean;
}

export interface CourseAdvanceResult {
  enrollment: CourseEnrollmentRecord;
  viewedDelivery: CourseStepDeliveryRecord;
  next: CourseStepReleaseResult | null;
  completed: boolean;
}

export interface CourseSummaryRecord extends CourseRecord {
  stepCount: number;
  activeEnrollmentCount: number;
  completedEnrollmentCount: number;
}

export interface AppUserRecord {
  id: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  primaryTelegramUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserAuthAccountRecord {
  id: string;
  appUserId: string;
  provider: AuthProvider;
  providerAccountId: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  rawProfile: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebSessionRecord {
  id: string;
  appUserId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSessionRecord extends WebSessionRecord {
  user: AppUserRecord;
}

export interface AuthAccountProfileInput {
  provider: AuthProvider;
  providerAccountId: string;
  email?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  rawProfile?: unknown;
}

export interface CreateReminderJobInput {
  cardId: string;
  userId: string;
  kind: ReminderJobKind;
  dueAt: string;
  scheduledAt?: string | null;
  source?: string;
  snoozedFromJobId?: string | null;
  metadata?: string | null;
}

export type ReminderMode = 'sm2' | 'schedule';
export type UserReminderSettings = DeliverySettings;

export const buildUserQueueScope = (userId: string): QueueScope => ({
  type: 'user',
  id: userId,
});

export const buildChatQueueScope = (chatId: string | number): QueueScope => ({
  type: 'chat',
  id: String(chatId),
});

const normalizeQueueScopeType = (value: unknown): QueueScopeType =>
  value === 'chat' ? 'chat' : 'user';

const normalizeQueueScope = (input: {
  userId: string;
  queueScopeType?: QueueScopeType;
  queueScopeId?: string;
}): QueueScope => ({
  type: input.queueScopeType ?? 'user',
  id: input.queueScopeId ?? input.userId,
});

const parseSourceMessageIds = (value: unknown): number[] | null => {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    const parsed = value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    return parsed.length ? parsed : null;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry));
        return normalized.length ? normalized : null;
      }
    } catch (error) {
      return null;
    }
  }
  return null;
};

const serializeSourceMessageIds = (value?: number[] | null): string | null => {
  if (!value || value.length === 0) {
    return null;
  }
  return JSON.stringify(value);
};

const rowToCard = (row: any): CardRecord => ({
  id: row.id,
  userId: row.user_id,
  queueScopeType: normalizeQueueScopeType(row.queue_scope_type),
  queueScopeId: row.queue_scope_id ?? row.user_id,
  sourceChatId: row.source_chat_id,
  sourceMessageId: Number(row.source_message_id),
  sourceMessageIds: parseSourceMessageIds(row.source_message_ids),
  contentType: row.content_type,
  contentPreview: row.content_preview,
  contentFileId: row.content_file_id,
  contentFileUniqueId: row.content_file_unique_id,
  reminderMode: row.reminder_mode as ReminderMode,
  scheduleRule: row.schedule_rule ?? null,
  status: row.status as CardStatus,
  repetition: Number(row.repetition),
  nextReviewAt: row.next_review_at,
  lastReviewedAt: row.last_reviewed_at,
  pendingChannelId: row.pending_channel_id,
  pendingChannelMessageId: row.pending_channel_message_id,
  baseChannelMessageId: row.base_channel_message_id,
  awaitingGradeSince: row.awaiting_grade_since,
  lastNotificationAt: row.last_notification_at,
  lastNotificationReason: row.last_notification_reason as NotificationReason | null,
  lastNotificationMessageId: row.last_notification_message_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToBacklogItem = (row: any): BacklogItemRecord => ({
  id: row.id,
  userId: row.user_id,
  sourceChatId: row.source_chat_id,
  sourceMessageId: Number(row.source_message_id),
  sourceMessageIds: parseSourceMessageIds(row.source_message_ids),
  contentType: row.content_type,
  contentPreview: row.content_preview,
  contentFileId: row.content_file_id,
  contentFileUniqueId: row.content_file_unique_id,
  status: row.status as BacklogItemStatus,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToReminderJob = (row: any): ReminderJobRecord => ({
  id: row.id,
  cardId: row.card_id,
  userId: row.user_id,
  queueScopeType: normalizeQueueScopeType(row.queue_scope_type),
  queueScopeId: row.queue_scope_id ?? row.user_id,
  kind: row.kind as ReminderJobKind,
  source: row.source,
  status: row.status as ReminderJobStatus,
  dueAt: row.due_at,
  scheduledAt: row.scheduled_at,
  sentAt: row.sent_at,
  completedAt: row.completed_at,
  deliveryChatId: row.delivery_chat_id,
  deliveryMessageId: row.delivery_message_id,
  baseMessageId: row.base_message_id,
  snoozedFromJobId: row.snoozed_from_job_id,
  error: row.error,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToCourse = (row: any): CourseRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  title: row.title,
  description: row.description ?? null,
  status: row.status as CourseStatus,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToCourseStep = (row: any): CourseStepRecord => ({
  id: row.id,
  courseId: row.course_id,
  position: Number(row.position),
  kind: row.kind as CourseStepKind,
  title: row.title,
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToCourseEnrollment = (row: any): CourseEnrollmentRecord => ({
  id: row.id,
  courseId: row.course_id,
  userId: row.user_id,
  queueScopeType: normalizeQueueScopeType(row.queue_scope_type),
  queueScopeId: row.queue_scope_id ?? row.user_id,
  status: row.status as CourseEnrollmentStatus,
  cadence: row.cadence as CourseCadence,
  nextStepPosition: Number(row.next_step_position),
  startedAt: row.started_at,
  completedAt: row.completed_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToCourseStepDelivery = (row: any): CourseStepDeliveryRecord => ({
  id: row.id,
  enrollmentId: row.enrollment_id,
  stepId: row.step_id,
  cardId: row.card_id ?? null,
  status: row.status,
  releasedAt: row.released_at,
  viewedAt: row.viewed_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToAppUser = (row: any): AppUserRecord => ({
  id: row.id,
  displayName: row.display_name ?? null,
  email: row.email ?? null,
  avatarUrl: row.avatar_url ?? null,
  primaryTelegramUserId: row.primary_telegram_user_id ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToUserAuthAccount = (row: any): UserAuthAccountRecord => ({
  id: row.id,
  appUserId: row.app_user_id,
  provider: row.provider as AuthProvider,
  providerAccountId: row.provider_account_id,
  email: row.email ?? null,
  username: row.username ?? null,
  displayName: row.display_name ?? null,
  avatarUrl: row.avatar_url ?? null,
  rawProfile: row.raw_profile ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToWebSession = (row: any): WebSessionRecord => ({
  id: row.id,
  appUserId: row.app_user_id,
  tokenHash: row.token_hash,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildPoolConfig = (connectionString: string): PoolConfig => {
  const sslRequired =
    process.env.PGSSLMODE === 'require' ||
    process.env.POSTGRES_SSL === 'require' ||
    process.env.NODE_ENV === 'production';
  return {
    connectionString,
    ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PGPOOL_MAX ?? 10),
  };
};

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './db/schema';

// ... existing imports ...

export class CardStore {
  private pool: Pool;
  private db: ReturnType<typeof drizzle<typeof schema>>;

  constructor(connectionString: string) {
    this.pool = new Pool(buildPoolConfig(connectionString));
    this.db = drizzle(this.pool, { schema });
  }

  async init() {
    await withDbRetry(() => this.pool.query('SELECT 1'));
    
    // Run Drizzle migrations
    console.log('Running migrations...');
    try {
      await migrate(this.db, { migrationsFolder: 'src/db/migrations' });
      console.log('Migrations complete.');
    } catch (error: any) {
      // Check for wrapped error code (DrizzleQueryError wraps the actual PG error)
      const errorCode = error.code || error.cause?.code;
      if (errorCode === '42P07') { // duplicate_table
        console.log('Tables already exist, skipping migration (assuming first run on existing DB).');
      } else if (errorCode === '42710') { // duplicate_object (constraint)
        console.log('Constraints already exist, skipping migration step.');
      } else {
        throw error;
      }
    }
  }

  // ... existing methods ...

  async createUser(user: {
    id: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    // Default notification_chat_id to user.id (DM)
    const notificationChatId = user.id;
    await this.pool.query(
      `
      INSERT INTO users (id, username, first_name, last_name, status, notification_chat_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6, $6)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        updated_at = EXCLUDED.updated_at
    `,
      [user.id, user.username, user.firstName, user.lastName, notificationChatId, now],
    );
  }

  async getUser(id: string): Promise<{
    status: 'pending' | 'approved' | 'rejected';
    notificationChatId: string | null;
  } | null> {
    const { rows } = await this.pool.query(
      `SELECT status, notification_chat_id FROM users WHERE id = $1`,
      [id],
    );
    if (!rows.length) return null;
    return {
      status: rows[0].status,
      notificationChatId: rows[0].notification_chat_id,
    };
  }

  async updateUserStatus(id: string, status: 'approved' | 'rejected'): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE users
      SET status = $1,
          updated_at = $2
      WHERE id = $3
    `,
      [status, now, id],
    );
  }

  async updateUserNotificationChat(userId: string, chatId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE users
      SET notification_chat_id = $1,
          updated_at = $2
      WHERE id = $3
    `,
      [chatId, now, userId],
    );
    // Base messages belong to the old chat — reset them so the bot
    // re-copies originals into the new chat on next reminder.
    await this.resetUserBaseMessages(userId);
  }

  async resetUserBaseMessages(userId: string): Promise<void> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `
      UPDATE cards
      SET base_channel_message_id = NULL,
          pending_channel_id = NULL,
          pending_channel_message_id = NULL,
          awaiting_grade_since = NULL,
          status = CASE WHEN status = 'awaiting_grade' THEN 'learning' ELSE status END,
          next_review_at = CASE WHEN status = 'awaiting_grade' THEN $1 ELSE next_review_at END,
          updated_at = $1
      WHERE user_id = $2
        AND queue_scope_type = 'user'
        AND queue_scope_id = $2
        AND status IN ('learning', 'awaiting_grade')
      RETURNING *
    `,
      [now, userId],
    );
    await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'cancelled',
          completed_at = $1,
          updated_at = $1
      WHERE user_id = $2
        AND queue_scope_type = 'user'
        AND queue_scope_id = $2
        AND status IN ('pending', 'sending', 'awaiting_action')
        AND kind IN ('review', 'manual_now')
    `,
      [now, userId],
    );
    for (const row of rows) {
      const card = rowToCard(row);
      if (!card.nextReviewAt) continue;
      await this.createReminderJob({
        cardId: card.id,
        userId: card.userId,
        kind: 'review',
        dueAt: card.nextReviewAt,
        source: 'notification_chat_reset',
      });
    }
  }

  async resolveAppUserForAuthAccount(input: AuthAccountProfileInput, currentAppUserId?: string | null): Promise<{
    user: AppUserRecord;
    account: UserAuthAccountRecord;
    createdUser: boolean;
    linkedAccount: boolean;
  }> {
    const client = await this.pool.connect();
    const now = new Date().toISOString();
    const rawProfile = input.rawProfile === undefined ? null : JSON.stringify(input.rawProfile);
    const primaryTelegramUserId = input.provider === 'telegram' ? input.providerAccountId : null;
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        `
        SELECT *
        FROM user_auth_accounts
        WHERE provider = $1 AND provider_account_id = $2
        FOR UPDATE
      `,
        [input.provider, input.providerAccountId],
      );
      const existingAccount = existingRows[0] ? rowToUserAuthAccount(existingRows[0]) : null;

      let appUserId = currentAppUserId || existingAccount?.appUserId || null;
      let createdUser = false;
      let linkedAccount = false;

      if (currentAppUserId && existingAccount && existingAccount.appUserId !== currentAppUserId) {
        throw Object.assign(new Error('Этот аккаунт уже привязан к другому пользователю'), {
          statusCode: 409,
          code: 'AUTH_ACCOUNT_ALREADY_LINKED',
        });
      }

      if (appUserId) {
        const { rows: userRows } = await client.query(
          `SELECT * FROM app_users WHERE id = $1 FOR UPDATE`,
          [appUserId],
        );
        if (!userRows.length) {
          throw Object.assign(new Error('Пользователь не найден'), { statusCode: 404 });
        }
      } else {
        appUserId = uuid();
        await client.query(
          `
          INSERT INTO app_users (
            id, display_name, email, avatar_url, primary_telegram_user_id, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $6
          )
        `,
          [
            appUserId,
            input.displayName ?? null,
            input.email ?? null,
            input.avatarUrl ?? null,
            primaryTelegramUserId,
            now,
          ],
        );
        createdUser = true;
      }

      await client.query(
        `
        UPDATE app_users
        SET display_name = COALESCE($1, display_name),
            email = COALESCE($2, email),
            avatar_url = COALESCE($3, avatar_url),
            primary_telegram_user_id = COALESCE($4, primary_telegram_user_id),
            updated_at = $5
        WHERE id = $6
      `,
        [
          input.displayName ?? null,
          input.email ?? null,
          input.avatarUrl ?? null,
          primaryTelegramUserId,
          now,
          appUserId,
        ],
      );

      if (existingAccount) {
        const { rows: accountRows } = await client.query(
          `
          UPDATE user_auth_accounts
          SET email = $1,
              username = $2,
              display_name = $3,
              avatar_url = $4,
              raw_profile = $5,
              updated_at = $6
          WHERE id = $7
          RETURNING *
        `,
          [
            input.email ?? null,
            input.username ?? null,
            input.displayName ?? null,
            input.avatarUrl ?? null,
            rawProfile,
            now,
            existingAccount.id,
          ],
        );
        const { rows: userRows } = await client.query(
          `SELECT * FROM app_users WHERE id = $1`,
          [appUserId],
        );
        await client.query('COMMIT');
        return {
          user: rowToAppUser(userRows[0]),
          account: rowToUserAuthAccount(accountRows[0]),
          createdUser,
          linkedAccount,
        };
      }

      const { rows: accountRows } = await client.query(
        `
        INSERT INTO user_auth_accounts (
          id, app_user_id, provider, provider_account_id, email, username,
          display_name, avatar_url, raw_profile, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $10
        )
        RETURNING *
      `,
        [
          uuid(),
          appUserId,
          input.provider,
          input.providerAccountId,
          input.email ?? null,
          input.username ?? null,
          input.displayName ?? null,
          input.avatarUrl ?? null,
          rawProfile,
          now,
        ],
      );
      linkedAccount = true;

      const { rows: userRows } = await client.query(
        `SELECT * FROM app_users WHERE id = $1`,
        [appUserId],
      );
      await client.query('COMMIT');
      return {
        user: rowToAppUser(userRows[0]),
        account: rowToUserAuthAccount(accountRows[0]),
        createdUser,
        linkedAccount,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAppUserById(appUserId: string): Promise<AppUserRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM app_users WHERE id = $1`,
      [appUserId],
    );
    return rows.length ? rowToAppUser(rows[0]) : null;
  }

  async listAuthAccounts(appUserId: string): Promise<UserAuthAccountRecord[]> {
    const { rows } = await this.pool.query(
      `
      SELECT *
      FROM user_auth_accounts
      WHERE app_user_id = $1
      ORDER BY provider ASC, created_at ASC
    `,
      [appUserId],
    );
    return rows.map(rowToUserAuthAccount);
  }

  async createWebSession(input: {
    appUserId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<WebSessionRecord> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `
      INSERT INTO web_sessions (
        id, app_user_id, token_hash, expires_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $5
      )
      RETURNING *
    `,
      [uuid(), input.appUserId, input.tokenHash, input.expiresAt, now],
    );
    return rowToWebSession(rows[0]);
  }

  async findWebSessionByTokenHash(tokenHash: string): Promise<AppSessionRecord | null> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `
      SELECT web_sessions.*,
             app_users.id AS user_id,
             app_users.display_name,
             app_users.email,
             app_users.avatar_url,
             app_users.primary_telegram_user_id,
             app_users.created_at AS user_created_at,
             app_users.updated_at AS user_updated_at
      FROM web_sessions
      JOIN app_users ON app_users.id = web_sessions.app_user_id
      WHERE web_sessions.token_hash = $1
        AND web_sessions.expires_at > $2
      LIMIT 1
    `,
      [tokenHash, now],
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      ...rowToWebSession(row),
      user: {
        id: row.user_id,
        displayName: row.display_name ?? null,
        email: row.email ?? null,
        avatarUrl: row.avatar_url ?? null,
        primaryTelegramUserId: row.primary_telegram_user_id ?? null,
        createdAt: row.user_created_at,
        updatedAt: row.user_updated_at,
      },
    };
  }

  async deleteWebSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM web_sessions WHERE token_hash = $1`,
      [tokenHash],
    );
  }

  async deleteExpiredWebSessions(): Promise<number> {
    const now = new Date().toISOString();
    const { rowCount } = await this.pool.query(
      `DELETE FROM web_sessions WHERE expires_at <= $1`,
      [now],
    );
    return rowCount ?? 0;
  }

  private async getDeliverySettings(userId: string): Promise<DeliverySettings> {
    const { rows } = await this.pool.query(
      `
      SELECT timezone, active_hours_start, active_hours_end, reminder_min_gap_minutes
      FROM users
      WHERE id = $1
    `,
      [userId],
    );
    const row = rows[0] ?? {};
    return {
      timezone: row.timezone ?? DEFAULT_DELIVERY_SETTINGS.timezone,
      activeHoursStart: Number(row.active_hours_start ?? DEFAULT_DELIVERY_SETTINGS.activeHoursStart),
      activeHoursEnd: Number(row.active_hours_end ?? DEFAULT_DELIVERY_SETTINGS.activeHoursEnd),
      minGapMinutes: Number(row.reminder_min_gap_minutes ?? DEFAULT_DELIVERY_SETTINGS.minGapMinutes),
    };
  }

  async getUserReminderSettings(userId: string): Promise<UserReminderSettings> {
    return this.getDeliverySettings(userId);
  }

  async updateUserReminderSettings(
    userId: string,
    settings: UserReminderSettings,
  ): Promise<UserReminderSettings> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE users
      SET timezone = $1,
          active_hours_start = $2,
          active_hours_end = $3,
          reminder_min_gap_minutes = $4,
          updated_at = $5
      WHERE id = $6
    `,
      [
        settings.timezone,
        settings.activeHoursStart,
        settings.activeHoursEnd,
        settings.minGapMinutes,
        now,
        userId,
      ],
    );
    return this.getUserReminderSettings(userId);
  }

  async previewReminderRebalance(
    userId: string,
    options: ReminderRebalanceOptions,
  ): Promise<ReminderRebalancePreview> {
    const settings = await this.getDeliverySettings(userId);
    const generatedAt = new Date().toISOString();
    const horizonDays = Math.min(30, Math.max(1, Math.floor(options.horizonDays)));
    const horizonEnd = new Date(Date.parse(generatedAt) + horizonDays * 24 * 60 * 60_000);
    const fixedStart = new Date(Date.parse(generatedAt) - 24 * 60 * 60_000);
    const fixedEnd = new Date(horizonEnd.getTime() + 7 * 24 * 60 * 60_000);
    const { rows: movingRows } = await this.pool.query(
      `
      SELECT reminder_jobs.*, cards.content_preview
      FROM reminder_jobs
      JOIN cards ON cards.id = reminder_jobs.card_id
      WHERE reminder_jobs.user_id = $1
        AND reminder_jobs.queue_scope_type = 'user'
        AND reminder_jobs.queue_scope_id = $1
        AND reminder_jobs.status = 'pending'
        AND reminder_jobs.kind = 'review'
        AND reminder_jobs.scheduled_at >= $2
        AND reminder_jobs.scheduled_at < $3
        AND cards.queue_scope_type = 'user'
        AND cards.queue_scope_id = $1
        AND cards.status <> 'archived'
      ORDER BY reminder_jobs.scheduled_at ASC
      LIMIT 500
    `,
      [userId, generatedAt, horizonEnd.toISOString()],
    );
    const movingIds = movingRows.map((row) => row.id);
    const { rows: fixedRows } = await this.pool.query(
      `
      SELECT scheduled_at
      FROM reminder_jobs
      WHERE user_id = $1
        AND queue_scope_type = 'user'
        AND queue_scope_id = $1
        AND status = 'pending'
        AND scheduled_at >= $2
        AND scheduled_at < $3
        AND NOT (id = ANY($4::text[]))
      ORDER BY scheduled_at ASC
    `,
      [userId, fixedStart.toISOString(), fixedEnd.toISOString(), movingIds],
    );
    return buildReminderRebalancePreview({
      jobs: movingRows.map((row) => ({
        id: row.id,
        cardId: row.card_id,
        contentPreview: row.content_preview ?? null,
        dueAt: row.due_at,
        scheduledAt: row.scheduled_at,
      })),
      fixedScheduledAt: fixedRows.map((row) => row.scheduled_at),
      visibleFixedScheduledAt: fixedRows
        .map((row) => row.scheduled_at)
        .filter((scheduledAt) => {
          const value = Date.parse(scheduledAt);
          return value >= Date.parse(generatedAt) && value < horizonEnd.getTime();
        }),
      settings,
      generatedAt,
      horizonDays,
      bucketMinutes: options.bucketMinutes,
    });
  }

  async applyReminderRebalance(
    userId: string,
    changes: ReminderRebalancePreviewChange[],
  ): Promise<{ updated: number }> {
    if (changes.length > 500) {
      throw new Error('Too many reminder changes');
    }
    const now = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let updated = 0;
      for (const change of changes) {
        if (!change.jobId || !change.beforeScheduledAt || !change.afterScheduledAt) {
          throw new Error('Invalid reminder rebalance change');
        }
        if (Number.isNaN(Date.parse(change.beforeScheduledAt)) || Number.isNaN(Date.parse(change.afterScheduledAt))) {
          throw new Error('Invalid reminder rebalance date');
        }
        const { rows } = await client.query(
          `
          SELECT reminder_jobs.*, cards.status AS card_status
          FROM reminder_jobs
          JOIN cards ON cards.id = reminder_jobs.card_id
          WHERE reminder_jobs.id = $1
            AND reminder_jobs.user_id = $2
            AND reminder_jobs.queue_scope_type = 'user'
            AND reminder_jobs.queue_scope_id = $2
          FOR UPDATE OF reminder_jobs
        `,
          [change.jobId, userId],
        );
        if (!rows.length) {
          throw new Error(`Reminder job ${change.jobId} not found`);
        }
        const row = rows[0];
        if (row.kind !== 'review' || row.status !== 'pending' || row.card_status === 'archived') {
          throw new Error(`Reminder job ${change.jobId} is no longer movable`);
        }
        if (row.scheduled_at !== change.beforeScheduledAt) {
          throw new Error(`Reminder job ${change.jobId} changed since preview`);
        }
        if (change.beforeScheduledAt === change.afterScheduledAt) {
          continue;
        }
        await client.query(
          `
          UPDATE reminder_jobs
          SET scheduled_at = $1,
              updated_at = $2
          WHERE id = $3
        `,
          [change.afterScheduledAt, now, change.jobId],
        );
        await client.query(
          `
          UPDATE cards
          SET next_review_at = $1,
              updated_at = $2
          WHERE id = $3
            AND status <> 'archived'
        `,
          [change.afterScheduledAt, now, row.card_id],
        );
        updated += 1;
      }
      await client.query('COMMIT');
      return { updated };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async planScheduledAt(
    userId: string,
    queueScope: QueueScope,
    dueAt: string,
  ): Promise<string> {
    const settings = await this.getDeliverySettings(userId);
    const from = new Date(dueAt);
    from.setDate(from.getDate() - 1);
    const to = new Date(dueAt);
    to.setDate(to.getDate() + 7);
    const { rows } = await this.pool.query(
      `
      SELECT scheduled_at
      FROM reminder_jobs
      WHERE queue_scope_type = $1
        AND queue_scope_id = $2
        AND status = 'pending'
        AND scheduled_at >= $3
        AND scheduled_at <= $4
      ORDER BY scheduled_at ASC
    `,
      [queueScope.type, queueScope.id, from.toISOString(), to.toISOString()],
    );
    return planReminderDelivery({
      dueAt,
      existingScheduledAt: rows.map((row) => row.scheduled_at),
      settings,
    });
  }

  private async getCardQueueScope(cardId: string, fallbackUserId: string): Promise<QueueScope> {
    const { rows } = await this.pool.query(
      `
      SELECT queue_scope_type, queue_scope_id, user_id
      FROM cards
      WHERE id = $1
    `,
      [cardId],
    );
    const row = rows[0];
    if (!row) {
      return buildUserQueueScope(fallbackUserId);
    }
    return {
      type: normalizeQueueScopeType(row.queue_scope_type),
      id: row.queue_scope_id ?? row.user_id ?? fallbackUserId,
    };
  }

  private async releaseCourseStepForEnrollment(
    client: PoolClient,
    enrollmentId: string,
    releasedAt: string,
  ): Promise<CourseStepReleaseResult> {
    const { rows: enrollmentRows } = await client.query(
      `
      SELECT *
      FROM course_enrollments
      WHERE id = $1
      FOR UPDATE
    `,
      [enrollmentId],
    );
    if (!enrollmentRows.length) {
      throw new Error(`Course enrollment ${enrollmentId} not found`);
    }

    let enrollment = rowToCourseEnrollment(enrollmentRows[0]);
    if (enrollment.status !== 'active') {
      return {
        enrollment,
        step: null,
        card: null,
        delivery: null,
        completed: enrollment.status === 'completed',
      };
    }

    const { rows: stepRows } = await client.query(
      `
      SELECT course_steps.*,
             courses.title AS course_title,
             (
               SELECT COUNT(*)
               FROM course_steps all_steps
               WHERE all_steps.course_id = course_steps.course_id
             ) AS total_steps
      FROM course_steps
      JOIN courses ON courses.id = course_steps.course_id
      WHERE course_steps.course_id = $1
        AND course_steps.position = $2
    `,
      [enrollment.courseId, enrollment.nextStepPosition],
    );

    if (!stepRows.length) {
      const { rows: completedRows } = await client.query(
        `
        UPDATE course_enrollments
        SET status = 'completed',
            completed_at = $1,
            updated_at = $1
        WHERE id = $2
        RETURNING *
      `,
        [releasedAt, enrollment.id],
      );
      enrollment = rowToCourseEnrollment(completedRows[0]);
      return {
        enrollment,
        step: null,
        card: null,
        delivery: null,
        completed: true,
      };
    }

    const step = rowToCourseStep(stepRows[0]);
    const totalSteps = Number(stepRows[0].total_steps);
    const dueAt =
      enrollment.cadence === 'daily' && step.position > 1
        ? new Date(Date.parse(releasedAt) + 24 * 60 * 60_000).toISOString()
        : releasedAt;
    const cardText = buildCourseStepCardText({
      courseTitle: stepRows[0].course_title,
      stepPosition: step.position,
      totalSteps,
      stepKind: step.kind,
      stepTitle: step.title,
      body: step.body,
    });
    const cardId = uuid();
    const { rows: cardRows } = await client.query(
      `
      INSERT INTO cards (
        id, user_id, queue_scope_type, queue_scope_id,
        source_chat_id, source_message_id, source_message_ids,
        content_type, content_preview, content_file_id, content_file_unique_id,
        reminder_mode, schedule_rule, status,
        repetition, next_review_at, last_reviewed_at,
        pending_channel_id, pending_channel_message_id, base_channel_message_id,
        awaiting_grade_since, last_notification_at, last_notification_reason,
        last_notification_message_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, 0, NULL,
        'text', $6, NULL, NULL,
        'schedule', NULL, 'learning',
        0, $7, NULL,
        NULL, NULL, NULL,
        NULL, NULL, NULL,
        NULL, $8, $8
      )
      RETURNING *
    `,
      [
        cardId,
        enrollment.userId,
        enrollment.queueScopeType,
        enrollment.queueScopeId,
        enrollment.queueScopeType === 'chat' ? enrollment.queueScopeId : enrollment.userId,
        cardText,
        dueAt,
        releasedAt,
      ],
    );
    const card = rowToCard(cardRows[0]);
    const { rows: deliveryRows } = await client.query(
      `
      INSERT INTO course_step_deliveries (
        id, enrollment_id, step_id, card_id, status,
        released_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 'queued',
        $5, $5, $5
      )
      RETURNING *
    `,
      [uuid(), enrollment.id, step.id, card.id, releasedAt],
    );
    const delivery = rowToCourseStepDelivery(deliveryRows[0]);
    const { rows: updatedEnrollmentRows } = await client.query(
      `
      UPDATE course_enrollments
      SET next_step_position = $1,
          updated_at = $2
      WHERE id = $3
      RETURNING *
    `,
      [step.position + 1, releasedAt, enrollment.id],
    );
    enrollment = rowToCourseEnrollment(updatedEnrollmentRows[0]);

    return {
      enrollment,
      step,
      card,
      delivery,
      completed: false,
    };
  }

  async createCourse(input: {
    id?: string;
    ownerUserId: string;
    title: string;
    description?: string | null;
    status?: CourseStatus;
  }): Promise<CourseRecord> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `
      INSERT INTO courses (
        id, owner_user_id, title, description, status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $6
      )
      RETURNING *
    `,
      [
        input.id ?? uuid(),
        input.ownerUserId,
        input.title.trim(),
        input.description?.trim() || null,
        input.status ?? 'draft',
        now,
      ],
    );
    return rowToCourse(rows[0]);
  }

  async createCourseStep(input: {
    id?: string;
    courseId: string;
    position: number;
    kind?: CourseStepKind;
    title: string;
    body: string;
  }): Promise<CourseStepRecord> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `
      INSERT INTO course_steps (
        id, course_id, position, kind, title, body, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $7
      )
      RETURNING *
    `,
      [
        input.id ?? uuid(),
        input.courseId,
        input.position,
        input.kind ?? 'material',
        input.title.trim(),
        input.body.trim(),
        now,
      ],
    );
    return rowToCourseStep(rows[0]);
  }

  async listCourseSummariesByOwner(ownerUserId: string): Promise<CourseSummaryRecord[]> {
    const { rows } = await this.pool.query(
      `
      SELECT courses.*,
             COUNT(DISTINCT course_steps.id) AS step_count,
             COUNT(DISTINCT active_enrollments.id) AS active_enrollment_count,
             COUNT(DISTINCT completed_enrollments.id) AS completed_enrollment_count
      FROM courses
      LEFT JOIN course_steps
        ON course_steps.course_id = courses.id
      LEFT JOIN course_enrollments active_enrollments
        ON active_enrollments.course_id = courses.id
       AND active_enrollments.status = 'active'
      LEFT JOIN course_enrollments completed_enrollments
        ON completed_enrollments.course_id = courses.id
       AND completed_enrollments.status = 'completed'
      WHERE courses.owner_user_id = $1
      GROUP BY courses.id
      ORDER BY courses.updated_at DESC
    `,
      [ownerUserId],
    );
    return rows.map((row) => ({
      ...rowToCourse(row),
      stepCount: Number(row.step_count ?? 0),
      activeEnrollmentCount: Number(row.active_enrollment_count ?? 0),
      completedEnrollmentCount: Number(row.completed_enrollment_count ?? 0),
    }));
  }

  async findCourseById(courseId: string): Promise<CourseRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM courses WHERE id = $1`,
      [courseId],
    );
    return rows.length ? rowToCourse(rows[0]) : null;
  }

  async getCourseById(courseId: string): Promise<CourseRecord> {
    const course = await this.findCourseById(courseId);
    if (course) {
      return course;
    }
    throw new Error(`Course ${courseId} not found`);
  }

  async createCourseWithSteps(input: {
    ownerUserId: string;
    title: string;
    description?: string | null;
    status?: CourseStatus;
    steps: Array<{
      kind?: CourseStepKind;
      title: string;
      body: string;
    }>;
  }): Promise<{ course: CourseRecord; steps: CourseStepRecord[] }> {
    const client = await this.pool.connect();
    const now = new Date().toISOString();
    try {
      await client.query('BEGIN');
      const { rows: courseRows } = await client.query(
        `
        INSERT INTO courses (
          id, owner_user_id, title, description, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $6
        )
        RETURNING *
      `,
        [
          uuid(),
          input.ownerUserId,
          input.title.trim(),
          input.description?.trim() || null,
          input.status ?? 'active',
          now,
        ],
      );
      const course = rowToCourse(courseRows[0]);
      const steps: CourseStepRecord[] = [];
      for (const [index, step] of input.steps.entries()) {
        const { rows: stepRows } = await client.query(
          `
          INSERT INTO course_steps (
            id, course_id, position, kind, title, body, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $7
          )
          RETURNING *
        `,
          [
            uuid(),
            course.id,
            index + 1,
            step.kind ?? 'material',
            step.title.trim(),
            step.body.trim(),
            now,
          ],
        );
        steps.push(rowToCourseStep(stepRows[0]));
      }
      await client.query('COMMIT');
      return { course, steps };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async startCourseEnrollment(input: {
    id?: string;
    courseId: string;
    userId: string;
    queueScope?: QueueScope;
    cadence?: CourseCadence;
  }): Promise<CourseStepReleaseResult> {
    const client = await this.pool.connect();
    const now = new Date().toISOString();
    const queueScope = input.queueScope ?? buildUserQueueScope(input.userId);
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `
        INSERT INTO course_enrollments (
          id, course_id, user_id, queue_scope_type, queue_scope_id,
          status, cadence, next_step_position, started_at,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          'active', $6, 1, $7,
          $7, $7
        )
        RETURNING *
      `,
        [
          input.id ?? uuid(),
          input.courseId,
          input.userId,
          queueScope.type,
          queueScope.id,
          input.cadence ?? 'after_view',
          now,
        ],
      );
      const enrollment = rowToCourseEnrollment(rows[0]);
      const release = await this.releaseCourseStepForEnrollment(client, enrollment.id, now);
      await client.query('COMMIT');
      return release;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeCourseStepFromQueue(input: {
    cardId: string;
    jobId?: string | null;
  }): Promise<CourseAdvanceResult | null> {
    const client = await this.pool.connect();
    const now = new Date().toISOString();
    try {
      await client.query('BEGIN');
      const { rows: deliveryRows } = await client.query(
        `
        SELECT course_step_deliveries.*
        FROM course_step_deliveries
        JOIN course_enrollments
          ON course_enrollments.id = course_step_deliveries.enrollment_id
        WHERE course_step_deliveries.card_id = $1
          AND course_step_deliveries.status = 'queued'
          AND course_enrollments.status = 'active'
        FOR UPDATE OF course_step_deliveries, course_enrollments
      `,
        [input.cardId],
      );

      if (!deliveryRows.length) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `
        UPDATE reminder_jobs
        SET status = 'completed',
            completed_at = $1,
            updated_at = $1
        WHERE card_id = $2
          AND status IN ('pending', 'sending', 'awaiting_action')
      `,
        [now, input.cardId],
      );
      if (input.jobId) {
        await client.query(
          `
          UPDATE reminder_jobs
          SET status = 'completed',
              completed_at = $1,
              updated_at = $1
          WHERE id = $2
        `,
          [now, input.jobId],
        );
      }
      await client.query(
        `
        UPDATE cards
        SET status = 'archived',
            updated_at = $1
        WHERE id = $2
      `,
        [now, input.cardId],
      );
      const { rows: viewedRows } = await client.query(
        `
        UPDATE course_step_deliveries
        SET status = 'viewed',
            viewed_at = $1,
            updated_at = $1
        WHERE id = $2
        RETURNING *
      `,
        [now, deliveryRows[0].id],
      );
      const viewedDelivery = rowToCourseStepDelivery(viewedRows[0]);
      const next = await this.releaseCourseStepForEnrollment(
        client,
        viewedDelivery.enrollmentId,
        now,
      );
      await client.query('COMMIT');
      return {
        enrollment: next.enrollment,
        viewedDelivery,
        next,
        completed: next.completed,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createReminderJob(input: CreateReminderJobInput): Promise<ReminderJobRecord> {
    const now = new Date().toISOString();
    const queueScope = await this.getCardQueueScope(input.cardId, input.userId);
    if (input.kind === 'review' || input.kind === 'manual_now' || input.kind === 'one_time') {
      await this.pool.query(
        `
        UPDATE reminder_jobs
        SET status = 'cancelled',
            completed_at = $1,
            updated_at = $1
        WHERE card_id = $2
          AND kind = ANY($3::text[])
          AND status = 'pending'
      `,
        [
          now,
          input.cardId,
          input.kind === 'manual_now'
            ? ['review', 'manual_now']
            : input.kind === 'one_time'
              ? ['one_time']
              : ['review'],
        ],
      );
    }
    const scheduledAt =
      input.scheduledAt ??
      (input.kind === 'one_time'
        ? input.dueAt
        : await this.planScheduledAt(input.userId, queueScope, input.dueAt));
    const { rows } = await this.pool.query(
      `
      INSERT INTO reminder_jobs (
        id, card_id, user_id, queue_scope_type, queue_scope_id, kind, source, status,
        due_at, scheduled_at, snoozed_from_job_id, metadata,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'pending',
        $8, $9, $10, $11,
        $12, $12
      )
      RETURNING *
    `,
      [
        uuid(),
        input.cardId,
        input.userId,
        queueScope.type,
        queueScope.id,
        input.kind,
        input.source ?? input.kind,
        input.dueAt,
        scheduledAt,
        input.snoozedFromJobId ?? null,
        input.metadata ?? null,
        now,
      ],
    );
    const job = rowToReminderJob(rows[0]);
    if (job.kind === 'review') {
      await this.pool.query(
        `
        UPDATE cards
        SET next_review_at = $1,
            updated_at = $2
        WHERE id = $3
          AND status <> 'archived'
      `,
        [job.scheduledAt, now, job.cardId],
      );
    }
    return job;
  }

  async createPendingCard(input: CreatePendingCardInput): Promise<CardRecord> {
    const now = new Date().toISOString();
    const queueScope = normalizeQueueScope(input);
    const { rows } = await this.pool.query(
      `
      INSERT INTO cards (
        id, user_id, queue_scope_type, queue_scope_id,
        source_chat_id, source_message_id, source_message_ids,
        content_type, content_preview, content_file_id, content_file_unique_id,
        reminder_mode, schedule_rule, status,
        repetition,
        next_review_at,
        last_reviewed_at,
        pending_channel_id,
        pending_channel_message_id,
        base_channel_message_id,
        awaiting_grade_since,
        last_notification_at,
        last_notification_reason,
        last_notification_message_id,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, 'pending',
        0,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        $14, $14
      )
      RETURNING *
    `,
      [
        input.id,
        input.userId,
        queueScope.type,
        queueScope.id,
        input.sourceChatId,
        input.sourceMessageId,
        serializeSourceMessageIds(input.sourceMessageIds),
        input.contentType,
        input.contentPreview,
        input.contentFileId,
        input.contentFileUniqueId,
        input.reminderMode,
        input.scheduleRule ?? null,
        now,
      ],
    );
    return rowToCard(rows[0]);
  }

  async createBacklogItemFromPendingCard(cardId: string, ownerUserId: string): Promise<BacklogItemRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: cardRows } = await client.query(
        `SELECT * FROM cards WHERE id = $1 FOR UPDATE`,
        [cardId],
      );
      if (!cardRows.length) {
        throw new Error(`Card ${cardId} not found`);
      }
      const card = rowToCard(cardRows[0]);
      if (card.userId !== ownerUserId) {
        throw new Error(`Backlog is not allowed for user ${card.userId}`);
      }
      if (card.status !== 'pending') {
        throw new Error(`Card ${cardId} is already processed`);
      }

      const now = new Date().toISOString();
      const { rows: backlogRows } = await client.query(
        `
        INSERT INTO backlog_items (
          id, user_id, source_chat_id, source_message_id, source_message_ids,
          content_type, content_preview, content_file_id, content_file_unique_id,
          status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          'open', $10, $10
        )
        RETURNING *
      `,
        [
          uuid(),
          card.userId,
          card.sourceChatId,
          card.sourceMessageId,
          serializeSourceMessageIds(card.sourceMessageIds),
          card.contentType,
          card.contentPreview,
          card.contentFileId,
          card.contentFileUniqueId,
          now,
        ],
      );
      await client.query(`DELETE FROM cards WHERE id = $1`, [cardId]);
      await client.query('COMMIT');
      return rowToBacklogItem(backlogRows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteCard(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM cards WHERE id = $1`, [id]);
  }

  async getCardById(id: string): Promise<CardRecord> {
    const { rows } = await this.pool.query(`SELECT * FROM cards WHERE id = $1`, [id]);
    if (!rows.length) {
      throw new Error(`Card ${id} not found`);
    }
    return rowToCard(rows[0]);
  }

  async updateCardReminderMode(id: string, reminderMode: ReminderMode, scheduleRule?: string | null): Promise<CardRecord> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE cards
      SET reminder_mode = $1,
          schedule_rule = $2,
          updated_at = $3
      WHERE id = $4
    `,
      [reminderMode, scheduleRule ?? null, now, id],
    );
    return this.getCardById(id);
  }

  async activateCard(id: string, input: ActivateCardInput): Promise<CardRecord> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE cards
      SET status = 'learning',
          next_review_at = $1,
          updated_at = $2
      WHERE id = $3
    `,
      [input.nextReviewAt, now, id],
    );
    const card = await this.getCardById(id);
    await this.createReminderJob({
      cardId: card.id,
      userId: card.userId,
      kind: 'review',
      dueAt: input.nextReviewAt,
      source: 'activate',
    });
    return card;
  }

  async listDueCards(limit: number): Promise<CardRecord[]> {
    const { rows } = await this.pool.query(
      `
      SELECT *
      FROM cards
      WHERE status IN ('learning')
        AND next_review_at IS NOT NULL
        AND next_review_at <= $1
      ORDER BY next_review_at ASC
      LIMIT $2
    `,
      [new Date().toISOString(), limit],
    );
    return rows.map(rowToCard);
  }

  async listDueCardsWithoutActiveReviewJob(limit: number): Promise<CardRecord[]> {
    const { rows } = await this.pool.query(
      `
      SELECT *
      FROM cards
      WHERE status = 'learning'
        AND next_review_at IS NOT NULL
        AND next_review_at <= $1
        AND NOT EXISTS (
          SELECT 1
          FROM reminder_jobs
          WHERE reminder_jobs.card_id = cards.id
            AND reminder_jobs.kind IN ('review', 'manual_now')
            AND reminder_jobs.status IN ('pending', 'sending', 'awaiting_action')
        )
      ORDER BY next_review_at ASC
      LIMIT $2
    `,
      [new Date().toISOString(), limit],
    );
    return rows.map(rowToCard);
  }

  async listDueReminderJobs(limit: number): Promise<ReminderJobWithCard[]> {
    const { rows } = await this.pool.query(
      `
      SELECT to_jsonb(reminder_jobs) AS job, to_jsonb(cards) AS card
      FROM reminder_jobs
      JOIN cards ON cards.id = reminder_jobs.card_id
      WHERE reminder_jobs.status = 'pending'
        AND reminder_jobs.scheduled_at <= $1
        AND cards.status <> 'archived'
      ORDER BY reminder_jobs.scheduled_at ASC
      LIMIT $2
    `,
      [new Date().toISOString(), limit],
    );
    return rows.map((row) => ({
      job: rowToReminderJob(row.job),
      card: rowToCard(row.card),
    }));
  }

  async claimDueReminderJobs(limit: number): Promise<ReminderJobWithCard[]> {
    const now = new Date().toISOString();
    const staleSendingCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { rows } = await this.pool.query(
      `
      WITH picked AS (
        SELECT reminder_jobs.id
        FROM reminder_jobs
        JOIN cards ON cards.id = reminder_jobs.card_id
        WHERE (
            reminder_jobs.status = 'pending'
            OR (
              reminder_jobs.status = 'sending'
              AND reminder_jobs.updated_at <= $3
            )
          )
          AND reminder_jobs.scheduled_at <= $1
          AND cards.status <> 'archived'
        ORDER BY reminder_jobs.scheduled_at ASC
        LIMIT $2
        FOR UPDATE OF reminder_jobs SKIP LOCKED
      ),
      updated AS (
        UPDATE reminder_jobs
        SET status = 'sending',
            error = NULL,
            updated_at = $1
        WHERE id IN (SELECT id FROM picked)
        RETURNING *
      )
      SELECT to_jsonb(updated) AS job, to_jsonb(cards) AS card
      FROM updated
      JOIN cards ON cards.id = updated.card_id
      ORDER BY updated.scheduled_at ASC
    `,
      [now, limit, staleSendingCutoff],
    );
    return rows.map((row) => ({
      job: rowToReminderJob(row.job),
      card: rowToCard(row.card),
    }));
  }

  async listCards(params: ListCardsParams = {}): Promise<CardRecord[]> {
    const limit = params.limit ?? 100;
    if (params.status) {
      const { rows } = await this.pool.query(
        `
        SELECT *
        FROM cards
        WHERE status = $1
        ORDER BY updated_at DESC
        LIMIT $2
      `,
        [params.status, limit],
      );
      return rows.map(rowToCard);
    }
    const { rows } = await this.pool.query(
      `
      SELECT *
      FROM cards
      ORDER BY updated_at DESC
      LIMIT $1
    `,
      [limit],
    );
    return rows.map(rowToCard);
  }

  async listCardsByUser(
    params: ListCardsParams & { userId: string; queueScope?: QueueScope },
  ): Promise<CardRecord[]> {
    const limit = params.limit ?? 100;
    if (params.status) {
      if (params.queueScope) {
        const { rows } = await this.pool.query(
          `
          SELECT *
          FROM cards
          WHERE user_id = $1
            AND status = $2
            AND queue_scope_type = $3
            AND queue_scope_id = $4
          ORDER BY updated_at DESC
          LIMIT $5
        `,
          [
            params.userId,
            params.status,
            params.queueScope.type,
            params.queueScope.id,
            limit,
          ],
        );
        return rows.map(rowToCard);
      }
      const { rows } = await this.pool.query(
        `
        SELECT *
        FROM cards
        WHERE user_id = $1
          AND status = $2
        ORDER BY updated_at DESC
        LIMIT $3
      `,
        [params.userId, params.status, limit],
      );
      return rows.map(rowToCard);
    }
    if (params.queueScope) {
      const { rows } = await this.pool.query(
        `
        SELECT *
        FROM cards
        WHERE user_id = $1
          AND queue_scope_type = $2
          AND queue_scope_id = $3
        ORDER BY updated_at DESC
        LIMIT $4
      `,
        [params.userId, params.queueScope.type, params.queueScope.id, limit],
      );
      return rows.map(rowToCard);
    }
    const { rows } = await this.pool.query(
      `
      SELECT *
      FROM cards
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2
    `,
      [params.userId, limit],
    );
    return rows.map(rowToCard);
  }

  async listReminderQueueByUser(params: { userId: string; limit?: number }): Promise<ReminderQueueItem[]> {
    const queueScope = buildUserQueueScope(params.userId);
    if (params.limit === undefined) {
      return this.listReminderQueueByScope({ queueScope });
    }
    return this.listReminderQueueByScope({ queueScope, limit: params.limit });
  }

  async listReminderQueueByScope(params: { queueScope: QueueScope; limit?: number }): Promise<ReminderQueueItem[]> {
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const now = new Date().toISOString();
    const items: ReminderQueueItem[] = [];

    const { rows: activeRows } = await this.pool.query(
      `
      SELECT to_jsonb(reminder_jobs) AS job,
             to_jsonb(cards) AS card
      FROM reminder_jobs
      JOIN cards ON cards.id = reminder_jobs.card_id
      WHERE reminder_jobs.queue_scope_type = $1
        AND reminder_jobs.queue_scope_id = $2
        AND cards.queue_scope_type = $1
        AND cards.queue_scope_id = $2
        AND reminder_jobs.status = 'awaiting_action'
        AND cards.status IN ('learning', 'awaiting_grade')
      ORDER BY reminder_jobs.sent_at ASC NULLS LAST,
               reminder_jobs.updated_at ASC
      LIMIT $3
    `,
      [params.queueScope.type, params.queueScope.id, limit],
    );
    for (const row of activeRows) {
      const job = rowToReminderJob(row.job);
      const card = rowToCard(row.card);
      items.push({
        id: job.id,
        kind: job.kind === 'one_time' ? 'one_time' : 'awaiting_review',
        card,
        job,
        availableAt: job.sentAt ?? card.awaitingGradeSince ?? job.updatedAt,
        isDue: true,
      });
    }

    if (items.length < limit) {
      const remaining = limit - items.length;
      const { rows: orphanAwaitingRows } = await this.pool.query(
        `
        SELECT *
        FROM cards
        WHERE queue_scope_type = $1
          AND queue_scope_id = $2
          AND status = 'awaiting_grade'
          AND NOT EXISTS (
            SELECT 1
            FROM reminder_jobs
            WHERE reminder_jobs.card_id = cards.id
              AND reminder_jobs.status = 'awaiting_action'
          )
        ORDER BY awaiting_grade_since ASC NULLS LAST,
                 updated_at ASC
        LIMIT $3
      `,
        [params.queueScope.type, params.queueScope.id, remaining],
      );
      for (const row of orphanAwaitingRows) {
        const card = rowToCard(row);
        items.push({
          id: card.id,
          kind: 'awaiting_review',
          card,
          job: null,
          availableAt: card.awaitingGradeSince ?? card.updatedAt,
          isDue: true,
        });
      }
    }

    if (items.length < limit) {
      const remaining = limit - items.length;
      const { rows: scheduledRows } = await this.pool.query(
        `
        SELECT to_jsonb(cards) AS card,
               to_jsonb(reminder_jobs) AS job
        FROM cards
        LEFT JOIN LATERAL (
          SELECT *
          FROM reminder_jobs
          WHERE reminder_jobs.card_id = cards.id
            AND reminder_jobs.kind = 'review'
            AND reminder_jobs.status = 'pending'
          ORDER BY reminder_jobs.scheduled_at ASC
          LIMIT 1
        ) reminder_jobs ON true
        WHERE cards.queue_scope_type = $1
          AND cards.queue_scope_id = $2
          AND cards.status = 'learning'
          AND cards.next_review_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM reminder_jobs active_jobs
            WHERE active_jobs.card_id = cards.id
              AND active_jobs.status IN ('sending', 'awaiting_action')
          )
        ORDER BY cards.next_review_at ASC
        LIMIT $3
      `,
        [params.queueScope.type, params.queueScope.id, remaining],
      );
      for (const row of scheduledRows) {
        const card = rowToCard(row.card);
        const job = row.job ? rowToReminderJob(row.job) : null;
        const availableAt = job?.scheduledAt ?? card.nextReviewAt;
        items.push({
          id: job?.id ?? card.id,
          kind: 'scheduled_review',
          card,
          job,
          availableAt,
          isDue: Boolean(availableAt && Date.parse(availableAt) <= Date.parse(now)),
        });
      }
    }

    return items;
  }

  async listBacklogItems(params: ListBacklogItemsParams = {}): Promise<BacklogItemRecord[]> {
    const limit = params.limit ?? 100;
    if (params.status) {
      const { rows } = await this.pool.query(
        `
        SELECT *
        FROM backlog_items
        WHERE status = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
        [params.status, limit],
      );
      return rows.map(rowToBacklogItem);
    }
    const { rows } = await this.pool.query(
      `
      SELECT *
      FROM backlog_items
      ORDER BY created_at DESC
      LIMIT $1
    `,
      [limit],
    );
    return rows.map(rowToBacklogItem);
  }

  async markAwaitingGrade(input: AwaitingGradeInput & { jobId?: string | null }): Promise<void> {
    const result = await this.pool.query(
      `
      UPDATE cards
      SET status = 'awaiting_grade',
          pending_channel_id = $1,
          pending_channel_message_id = $2,
          awaiting_grade_since = $3,
          updated_at = $3
      WHERE id = $4
        AND status = 'learning'
    `,
      [input.channelId, input.channelMessageId, input.pendingSince, input.cardId],
    );
    if (result.rowCount === 0) {
      if (input.jobId) {
        await this.cancelReminderJob(input.jobId);
      }
      throw new Error(`Card ${input.cardId} is archived or not found`);
    }
    if (input.jobId) {
      await this.markReminderJobAwaitingAction({
        jobId: input.jobId,
        deliveryChatId: input.channelId,
        deliveryMessageId: input.channelMessageId,
        sentAt: input.pendingSince,
        baseMessageId: input.baseMessageId ?? null,
      });
    }
  }

  async markReminderJobSending(jobId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'sending',
          error = NULL,
          updated_at = $1
      WHERE id = $2
        AND status IN ('pending', 'sending')
    `,
      [now, jobId],
    );
  }

  async markReminderJobAwaitingAction(input: {
    jobId: string;
    deliveryChatId: string;
    deliveryMessageId: number;
    sentAt: string;
    baseMessageId?: number | null;
  }): Promise<void> {
    const result = await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'awaiting_action',
          sent_at = $1,
          delivery_chat_id = $2,
          delivery_message_id = $3,
          base_message_id = $4,
          updated_at = $1
      WHERE id = $5
        AND status = 'sending'
    `,
      [
        input.sentAt,
        input.deliveryChatId,
        input.deliveryMessageId,
        input.baseMessageId ?? null,
        input.jobId,
      ],
    );
    if (result.rowCount === 0) {
      throw new Error(`Reminder job ${input.jobId} is not sending`);
    }
  }

  async findAwaitingCard(cardId: string): Promise<CardRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM cards WHERE id = $1 AND status = 'awaiting_grade'`,
      [cardId],
    );
    return rows.length ? rowToCard(rows[0]) : null;
  }

  async getReminderJobWithCard(jobId: string): Promise<ReminderJobWithCard | null> {
    const { rows } = await this.pool.query(
      `
      SELECT to_jsonb(reminder_jobs) AS job, to_jsonb(cards) AS card
      FROM reminder_jobs
      JOIN cards ON cards.id = reminder_jobs.card_id
      WHERE reminder_jobs.id = $1
    `,
      [jobId],
    );
    if (!rows.length) return null;
    return {
      job: rowToReminderJob(rows[0].job),
      card: rowToCard(rows[0].card),
    };
  }

  async findAwaitingReminderJob(jobId: string): Promise<ReminderJobWithCard | null> {
    const found = await this.getReminderJobWithCard(jobId);
    if (!found || found.job.status !== 'awaiting_action') return null;
    return found;
  }

  async findAwaitingReviewJobByCard(cardId: string): Promise<ReminderJobWithCard | null> {
    const { rows } = await this.pool.query(
      `
      SELECT to_jsonb(reminder_jobs) AS job, to_jsonb(cards) AS card
      FROM reminder_jobs
      JOIN cards ON cards.id = reminder_jobs.card_id
      WHERE reminder_jobs.card_id = $1
        AND reminder_jobs.status = 'awaiting_action'
        AND reminder_jobs.kind IN ('review', 'manual_now')
      ORDER BY reminder_jobs.sent_at DESC NULLS LAST, reminder_jobs.updated_at DESC
      LIMIT 1
    `,
      [cardId],
    );
    if (!rows.length) return null;
    return {
      job: rowToReminderJob(rows[0].job),
      card: rowToCard(rows[0].card),
    };
  }

  async completeReminderJob(jobId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'completed',
          completed_at = $1,
          updated_at = $1
      WHERE id = $2
        AND status IN ('pending', 'sending', 'awaiting_action')
    `,
      [now, jobId],
    );
  }

  async cancelReminderJob(jobId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'cancelled',
          completed_at = $1,
          updated_at = $1
      WHERE id = $2
        AND status IN ('pending', 'sending', 'awaiting_action')
    `,
      [now, jobId],
    );
  }

  async failReminderJob(jobId: string, error: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'failed',
          completed_at = $1,
          error = $2,
          updated_at = $1
      WHERE id = $3
    `,
      [now, error.slice(0, 500), jobId],
    );
  }

  async snoozeReminderJob(jobId: string, minutes: number): Promise<ReminderJobRecord> {
    const found = await this.findAwaitingReminderJob(jobId);
    if (!found) {
      throw new Error(`Reminder job ${jobId} is not awaiting action`);
    }

    const now = new Date().toISOString();
    const delayMinutes = Math.max(1, Math.floor(minutes));
    const dueAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
    await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'snoozed',
          completed_at = $1,
          updated_at = $1
      WHERE id = $2
        AND status = 'awaiting_action'
    `,
      [now, jobId],
    );

    const snoozedJob = await this.createReminderJob({
      cardId: found.card.id,
      userId: found.card.userId,
      kind: found.job.kind,
      dueAt,
      source: 'snooze',
      snoozedFromJobId: found.job.id,
      metadata: found.job.metadata,
    });

    if (found.job.kind === 'review' || found.job.kind === 'manual_now') {
      await this.pool.query(
        `
        UPDATE cards
        SET status = 'learning',
            next_review_at = $1,
            pending_channel_id = NULL,
            pending_channel_message_id = NULL,
            awaiting_grade_since = NULL,
            updated_at = $2
        WHERE id = $3
      `,
        [dueAt, now, found.card.id],
      );
    }

    return snoozedJob;
  }

  async saveReviewResult(input: ReviewResultInput & { jobId?: string | null }): Promise<void> {
    await this.pool.query(
      `
      UPDATE cards
      SET status = 'learning',
          last_reviewed_at = $1,
          repetition = $2,
          next_review_at = $3,
          pending_channel_id = NULL,
          pending_channel_message_id = NULL,
          awaiting_grade_since = NULL,
          updated_at = $1
      WHERE id = $4
    `,
      [
        input.reviewedAt,
        input.repetition,
        input.nextReviewAt,
        input.cardId,
      ],
    );
    const completedAt = input.reviewedAt;
    if (input.jobId) {
      await this.pool.query(
        `
        UPDATE reminder_jobs
        SET status = 'completed',
            completed_at = $1,
            updated_at = $1
        WHERE id = $2
      `,
        [completedAt, input.jobId],
      );
    } else {
      await this.pool.query(
        `
        UPDATE reminder_jobs
        SET status = 'completed',
            completed_at = $1,
            updated_at = $1
        WHERE card_id = $2
          AND kind IN ('review', 'manual_now')
          AND status = 'awaiting_action'
      `,
        [completedAt, input.cardId],
      );
    }
    const card = await this.getCardById(input.cardId);
    await this.createReminderJob({
      cardId: card.id,
      userId: card.userId,
      kind: 'review',
      dueAt: input.nextReviewAt,
      source: 'review_result',
    });
  }

  async rescheduleCard(cardId: string, nextReviewAt: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE cards
      SET status = 'learning',
          next_review_at = $1,
          pending_channel_id = NULL,
          pending_channel_message_id = NULL,
          awaiting_grade_since = NULL,
          updated_at = $2
      WHERE id = $3
    `,
      [nextReviewAt, now, cardId],
    );
    await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'cancelled',
          completed_at = $1,
          updated_at = $1
      WHERE card_id = $2
        AND kind IN ('review', 'manual_now')
        AND status IN ('pending', 'sending', 'awaiting_action')
    `,
      [now, cardId],
    );
    const card = await this.getCardById(cardId);
    await this.createReminderJob({
      cardId: card.id,
      userId: card.userId,
      kind: 'review',
      dueAt: nextReviewAt,
      source: 'reschedule',
    });
  }

  async recordNotification(input: RecordNotificationInput): Promise<void> {
    await this.pool.query(
      `
      UPDATE cards
      SET last_notification_at = $1,
          last_notification_reason = $2,
          last_notification_message_id = $3
      WHERE id = $4
    `,
      [input.sentAt, input.reason, input.messageId, input.cardId],
    );
    if (input.jobId) {
      await this.pool.query(
        `
        UPDATE reminder_jobs
        SET sent_at = $1,
            delivery_message_id = $2,
            updated_at = $1
        WHERE id = $3
      `,
        [input.sentAt, input.messageId, input.jobId],
      );
    }
  }

  async setBaseChannelMessage(cardId: string, messageId: number | null): Promise<void> {
    await this.pool.query(
      `
      UPDATE cards
      SET base_channel_message_id = $1
      WHERE id = $2
    `,
      [messageId, cardId],
    );
  }

  async clearAwaitingGrade(cardId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE cards
      SET status = 'learning',
          pending_channel_id = NULL,
          pending_channel_message_id = NULL,
          awaiting_grade_since = NULL,
          updated_at = $1
      WHERE id = $2
        AND status = 'awaiting_grade'
    `,
      [now, cardId],
    );
    await this.pool.query(
      `
      UPDATE reminder_jobs
      SET status = 'cancelled',
          completed_at = $1,
          updated_at = $1
      WHERE card_id = $2
        AND kind IN ('review', 'manual_now')
        AND status = 'awaiting_action'
    `,
      [now, cardId],
    );
  }

  async listExpiredAwaitingCards(cutoffIso: string): Promise<CardRecord[]> {
    const { rows } = await this.pool.query(
      `
      SELECT *
      FROM cards
      WHERE status = 'awaiting_grade'
        AND awaiting_grade_since IS NOT NULL
        AND awaiting_grade_since <= $1
    `,
      [cutoffIso],
    );
    return rows.map(rowToCard);
  }

  async overrideNextReview(cardId: string, isoDate: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE cards
      SET next_review_at = $1,
          updated_at = $1
      WHERE id = $2
    `,
      [isoDate, cardId],
    );
    const card = await this.getCardById(cardId);
    await this.createReminderJob({
      cardId: card.id,
      userId: card.userId,
      kind: 'review',
      dueAt: isoDate,
      source: 'override',
    });
  }

  async updateStatus(cardId: string, status: CardStatus): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
      UPDATE cards
      SET status = $1,
          updated_at = $2
      WHERE id = $3
    `,
      [status, now, cardId],
    );

    if (status === 'archived' || status === 'pending') {
      await this.pool.query(
        `
        UPDATE cards
        SET pending_channel_id = NULL,
            pending_channel_message_id = NULL,
            awaiting_grade_since = NULL,
            updated_at = $1
        WHERE id = $2
      `,
        [now, cardId],
      );
      await this.pool.query(
        `
        UPDATE reminder_jobs
        SET status = 'cancelled',
            completed_at = $1,
            updated_at = $1
        WHERE card_id = $2
          AND status IN ('pending', 'sending', 'awaiting_action')
      `,
        [now, cardId],
      );
      return;
    }

    if (status === 'learning') {
      const card = await this.getCardById(cardId);
      if (card.nextReviewAt) {
        await this.createReminderJob({
          cardId: card.id,
          userId: card.userId,
          kind: 'review',
          dueAt: card.nextReviewAt,
          source: 'status_learning',
        });
      }
    }
  }

  async logUnrecognizedSchedule(userId: string, input: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO unrecognized_schedules (user_id, input, created_at) VALUES ($1, $2, $3)`,
      [userId, input.slice(0, 500), new Date().toISOString()],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
