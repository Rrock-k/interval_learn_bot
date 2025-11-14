import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

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

const ensureDirectory = (filePath: string) => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
};

const rowToCard = (row: any): CardRecord => ({
  id: row.id,
  userId: row.user_id,
  sourceChatId: row.source_chat_id,
  sourceMessageId: row.source_message_id,
  contentType: row.content_type,
  contentPreview: row.content_preview,
  contentFileId: row.content_file_id,
  contentFileUniqueId: row.content_file_unique_id,
  status: row.status as CardStatus,
  repetition: row.repetition,
  interval: row.interval_days,
  easiness: row.easiness,
  nextReviewAt: row.next_review_at,
  lastReviewedAt: row.last_reviewed_at,
  lastGrade: row.last_grade,
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

export class CardStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    ensureDirectory(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.prepareSchema();
  }

  private prepareSchema() {
    const createSql = `
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
      );
      CREATE INDEX IF NOT EXISTS idx_cards_status_next_review
        ON cards(status, next_review_at);
    `;
    this.db.exec(createSql);

    const columns = this.db
      .prepare(`PRAGMA table_info(cards)`)
      .all()
      .map((row: any) => row.name as string);

    const ensureColumn = (name: string, ddl: string) => {
      if (!columns.includes(name)) {
        this.db.prepare(ddl).run();
      }
    };

    ensureColumn('content_file_id', 'ALTER TABLE cards ADD COLUMN content_file_id TEXT');
    ensureColumn(
      'content_file_unique_id',
      'ALTER TABLE cards ADD COLUMN content_file_unique_id TEXT',
    );
    ensureColumn(
      'base_channel_message_id',
      'ALTER TABLE cards ADD COLUMN base_channel_message_id INTEGER',
    );
    ensureColumn(
      'awaiting_grade_since',
      'ALTER TABLE cards ADD COLUMN awaiting_grade_since TEXT',
    );
    ensureColumn(
      'last_notification_at',
      'ALTER TABLE cards ADD COLUMN last_notification_at TEXT',
    );
    ensureColumn(
      'last_notification_reason',
      'ALTER TABLE cards ADD COLUMN last_notification_reason TEXT',
    );
    ensureColumn(
      'last_notification_message_id',
      'ALTER TABLE cards ADD COLUMN last_notification_message_id INTEGER',
    );

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cards_status_awaiting_since
        ON cards(status, awaiting_grade_since);
    `);
  }

  public createPendingCard(input: CreatePendingCardInput): CardRecord {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
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
        @id, @userId, @sourceChatId, @sourceMessageId,
        @contentType, @contentPreview, @contentFileId, @contentFileUniqueId, @status,
        @repetition, @intervalDays, @easiness,
        @nextReviewAt,
        @lastReviewedAt,
        @lastGrade,
        @pendingChannelId,
        @pendingChannelMessageId,
        @baseChannelMessageId,
        @awaitingGradeSince,
        @lastNotificationAt,
        @lastNotificationReason,
        @lastNotificationMessageId,
        @createdAt, @updatedAt
      )
    `);
    stmt.run({
      ...input,
      status: 'pending',
      repetition: 0,
      intervalDays: 0,
      easiness: 2.5,
      nextReviewAt: null,
      lastReviewedAt: null,
      lastGrade: null,
      pendingChannelId: null,
      pendingChannelMessageId: null,
      baseChannelMessageId: null,
      awaitingGradeSince: null,
      lastNotificationAt: null,
      lastNotificationReason: null,
      lastNotificationMessageId: null,
      createdAt: now,
      updatedAt: now,
    });
    return this.getCardById(input.id);
  }

  public deleteCard(id: string) {
    this.db.prepare(`DELETE FROM cards WHERE id = ?`).run(id);
  }

  public getCardById(id: string): CardRecord {
    const row = this.db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id);
    if (!row) {
      throw new Error(`Card ${id} not found`);
    }
    return rowToCard(row);
  }

  public activateCard(id: string, input: ActivateCardInput): CardRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE cards
        SET status = 'learning',
            next_review_at = @nextReviewAt,
            updated_at = @updatedAt
        WHERE id = @id
      `,
      )
      .run({ id, nextReviewAt: input.nextReviewAt, updatedAt: now });
    return this.getCardById(id);
  }

  public listDueCards(limit: number): CardRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM cards
        WHERE status = 'learning'
          AND next_review_at IS NOT NULL
          AND next_review_at <= @now
        ORDER BY next_review_at ASC
        LIMIT @limit
      `,
      )
      .all({ now: new Date().toISOString(), limit });
    return rows.map(rowToCard);
  }

  public listCards(params: ListCardsParams = {}): CardRecord[] {
    const limit = params.limit ?? 100;
    if (params.status) {
      const rows = this.db
        .prepare(
          `
          SELECT *
          FROM cards
          WHERE status = @status
          ORDER BY updated_at DESC
          LIMIT @limit
        `,
        )
        .all({ status: params.status, limit });
      return rows.map(rowToCard);
    }
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM cards
        ORDER BY updated_at DESC
        LIMIT @limit
      `,
      )
      .all({ limit });
    return rows.map(rowToCard);
  }

  public markAwaitingGrade(input: AwaitingGradeInput) {
    const stmt = this.db.prepare(
      `
      UPDATE cards
      SET status = 'awaiting_grade',
          pending_channel_id = @channelId,
          pending_channel_message_id = @channelMessageId,
          awaiting_grade_since = @pendingSince,
          updated_at = @updatedAt
      WHERE id = @cardId
    `,
    );
    stmt.run({
      cardId: input.cardId,
      channelId: input.channelId,
      channelMessageId: input.channelMessageId,
      pendingSince: input.pendingSince,
      updatedAt: input.pendingSince,
    });
  }

  public findAwaitingCard(cardId: string): CardRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM cards WHERE id = ? AND status = 'awaiting_grade'`)
      .get(cardId);
    return row ? rowToCard(row) : null;
  }

  public saveReviewResult(input: ReviewResultInput) {
    const stmt = this.db.prepare(
      `
      UPDATE cards
      SET status = 'learning',
          last_reviewed_at = @reviewedAt,
          last_grade = @grade,
          repetition = @repetition,
          interval_days = @interval,
          easiness = @easiness,
          next_review_at = @nextReviewAt,
          pending_channel_id = NULL,
          pending_channel_message_id = NULL,
          awaiting_grade_since = NULL,
          updated_at = @reviewedAt
      WHERE id = @cardId
    `,
    );
    stmt.run({
      cardId: input.cardId,
      grade: input.grade,
      repetition: input.repetition,
      interval: input.interval,
      easiness: input.easiness,
      nextReviewAt: input.nextReviewAt,
      reviewedAt: input.reviewedAt,
    });
  }

  public rescheduleCard(cardId: string, nextReviewAt: string) {
    this.db
      .prepare(
        `
        UPDATE cards
      SET status = 'learning',
          next_review_at = @nextReviewAt,
          pending_channel_id = NULL,
          pending_channel_message_id = NULL,
          awaiting_grade_since = NULL,
          updated_at = @updatedAt
      WHERE id = @cardId
      `,
      )
      .run({
        cardId,
        nextReviewAt,
        updatedAt: new Date().toISOString(),
      });
  }

  public recordNotification(input: RecordNotificationInput) {
    this.db
      .prepare(
        `
        UPDATE cards
        SET last_notification_at = @sentAt,
            last_notification_reason = @reason,
            last_notification_message_id = @messageId
        WHERE id = @cardId
      `,
      )
      .run({
        cardId: input.cardId,
        messageId: input.messageId,
        reason: input.reason,
        sentAt: input.sentAt,
      });
  }

  public setBaseChannelMessage(cardId: string, messageId: number | null) {
    this.db
      .prepare(
        `
        UPDATE cards
        SET base_channel_message_id = @messageId
        WHERE id = @cardId
      `,
      )
      .run({ cardId, messageId });
  }

  public clearAwaitingGrade(cardId: string) {
    this.db
      .prepare(
        `
        UPDATE cards
        SET status = 'learning',
            pending_channel_id = NULL,
            pending_channel_message_id = NULL,
            awaiting_grade_since = NULL,
            updated_at = @updatedAt
        WHERE id = @cardId
      `,
      )
      .run({
        cardId,
        updatedAt: new Date().toISOString(),
      });
  }

  public listExpiredAwaitingCards(cutoffIso: string): CardRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM cards
        WHERE status = 'awaiting_grade'
          AND awaiting_grade_since IS NOT NULL
          AND awaiting_grade_since <= @cutoff
      `,
      )
      .all({ cutoff: cutoffIso });
    return rows.map(rowToCard);
  }

  public overrideNextReview(cardId: string, isoDate: string) {
    this.db
      .prepare(
        `
        UPDATE cards
        SET next_review_at = @isoDate,
            updated_at = @isoDate
        WHERE id = @cardId
      `,
      )
      .run({ cardId, isoDate });
  }

  public updateStatus(cardId: string, status: CardStatus) {
    this.db
      .prepare(
        `
        UPDATE cards
        SET status = @status,
            updated_at = @updatedAt
        WHERE id = @cardId
      `,
      )
      .run({ cardId, status, updatedAt: new Date().toISOString() });
  }
}
