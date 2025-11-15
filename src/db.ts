import { Pool, PoolConfig } from 'pg';
import { withDbRetry } from './utils/dbRetry';

export type CardStatus = 'pending' | 'learning' | 'awaiting_grade' | 'archived';
export type NotificationReason = 'scheduled' | 'manual_now' | 'manual_override';

export interface CardRecord {
  id: string;
  userId: string;
  sourceChatId: string;
  sourceMessageId: number;
  contentType: string;
  contentPreview: string | null;
  contentFileId: string | null;
  contentFileUniqueId: string | null;
  status: CardStatus;
  repetition: number;
  interval: number;
  easiness: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  lastGrade: number | null;
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

export interface CreatePendingCardInput {
  id: string;
  userId: string;
  sourceChatId: string;
  sourceMessageId: number;
  contentType: string;
  contentPreview: string | null;
  contentFileId: string | null;
  contentFileUniqueId: string | null;
}

export interface ActivateCardInput {
  nextReviewAt: string;
}

export interface AwaitingGradeInput {
  cardId: string;
  channelId: string;
  channelMessageId: number;
  pendingSince: string;
}

export interface ReviewResultInput {
  cardId: string;
  grade: number;
  nextReviewAt: string;
  repetition: number;
  interval: number;
  easiness: number;
  reviewedAt: string;
}

export interface ListCardsParams {
  status?: CardStatus | undefined;
  limit?: number | undefined;
}

export interface RecordNotificationInput {
  cardId: string;
  messageId: number;
  reason: NotificationReason;
  sentAt: string;
}

const rowToCard = (row: any): CardRecord => ({
  id: row.id,
  userId: row.user_id,
  sourceChatId: row.source_chat_id,
  sourceMessageId: Number(row.source_message_id),
  contentType: row.content_type,
  contentPreview: row.content_preview,
  contentFileId: row.content_file_id,
  contentFileUniqueId: row.content_file_unique_id,
  status: row.status as CardStatus,
  repetition: Number(row.repetition),
  interval: Number(row.interval_days),
  easiness: Number(row.easiness),
  nextReviewAt: row.next_review_at,
  lastReviewedAt: row.last_reviewed_at,
  lastGrade: row.last_grade === null ? null : Number(row.last_grade),
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

export class CardStore {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool(buildPoolConfig(connectionString));
  }

  async init() {
    await withDbRetry(() => this.pool.query('SELECT 1'));
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_chat_id TEXT NOT NULL,
        source_message_id INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        content_preview TEXT,
        content_file_id TEXT,
        content_file_unique_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','learning','awaiting_grade','archived')),
        repetition INTEGER NOT NULL DEFAULT 0,
        interval_days INTEGER NOT NULL DEFAULT 0,
        easiness REAL NOT NULL DEFAULT 2.5,
        next_review_at TEXT,
        last_reviewed_at TEXT,
        last_grade INTEGER,
        pending_channel_id TEXT,
        pending_channel_message_id INTEGER,
        base_channel_message_id INTEGER,
        awaiting_grade_since TEXT,
        last_notification_at TEXT,
        last_notification_reason TEXT,
        last_notification_message_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cards_status_next_review
        ON cards(status, next_review_at)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cards_status_awaiting_since
        ON cards(status, awaiting_grade_since)
    `);

    await this.pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS content_file_id TEXT
    `);
    await this.pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS content_file_unique_id TEXT
    `);
    await this.pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS base_channel_message_id INTEGER
    `);
    await this.pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS awaiting_grade_since TEXT
    `);
    await this.pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS last_notification_at TEXT
    `);
    await this.pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS last_notification_reason TEXT
    `);
    await this.pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS last_notification_message_id INTEGER
    `);
  }

  async createPendingCard(input: CreatePendingCardInput): Promise<CardRecord> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `
      INSERT INTO cards (
        id, user_id, source_chat_id, source_message_id,
        content_type, content_preview, content_file_id, content_file_unique_id, status,
        repetition, interval_days, easiness,
        next_review_at,
        last_reviewed_at,
        last_grade,
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
        $5, $6, $7, $8, 'pending',
        0, 0, 2.5,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        $9, $9
      )
      RETURNING *
    `,
      [
        input.id,
        input.userId,
        input.sourceChatId,
        input.sourceMessageId,
        input.contentType,
        input.contentPreview,
        input.contentFileId,
        input.contentFileUniqueId,
        now,
      ],
    );
    return rowToCard(rows[0]);
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
    return this.getCardById(id);
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

  async markAwaitingGrade(input: AwaitingGradeInput): Promise<void> {
    await this.pool.query(
      `
      UPDATE cards
      SET status = 'awaiting_grade',
          pending_channel_id = $1,
          pending_channel_message_id = $2,
          awaiting_grade_since = $3,
          updated_at = $3
      WHERE id = $4
    `,
      [input.channelId, input.channelMessageId, input.pendingSince, input.cardId],
    );
  }

  async findAwaitingCard(cardId: string): Promise<CardRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM cards WHERE id = $1 AND status = 'awaiting_grade'`,
      [cardId],
    );
    return rows.length ? rowToCard(rows[0]) : null;
  }

  async saveReviewResult(input: ReviewResultInput): Promise<void> {
    await this.pool.query(
      `
      UPDATE cards
      SET status = 'learning',
          last_reviewed_at = $1,
          last_grade = $2,
          repetition = $3,
          interval_days = $4,
          easiness = $5,
          next_review_at = $6,
          pending_channel_id = NULL,
          pending_channel_message_id = NULL,
          awaiting_grade_since = NULL,
          updated_at = $1
      WHERE id = $7
    `,
      [
        input.reviewedAt,
        input.grade,
        input.repetition,
        input.interval,
        input.easiness,
        input.nextReviewAt,
        input.cardId,
      ],
    );
  }

  async rescheduleCard(cardId: string, nextReviewAt: string): Promise<void> {
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
      [nextReviewAt, new Date().toISOString(), cardId],
    );
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
    await this.pool.query(
      `
      UPDATE cards
      SET status = 'learning',
          pending_channel_id = NULL,
          pending_channel_message_id = NULL,
          awaiting_grade_since = NULL,
          updated_at = $1
      WHERE id = $2
    `,
      [new Date().toISOString(), cardId],
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
  }

  async updateStatus(cardId: string, status: CardStatus): Promise<void> {
    await this.pool.query(
      `
      UPDATE cards
      SET status = $1,
          updated_at = $2
      WHERE id = $3
    `,
      [status, new Date().toISOString(), cardId],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
