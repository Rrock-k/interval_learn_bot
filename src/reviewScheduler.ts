import dayjs from 'dayjs';
import { Markup, Telegraf } from 'telegraf';
import { CardRecord, CardStore, NotificationReason } from './db';
import { config } from './config';
import { gradeOptions } from './spacedRepetition';
import { logger } from './logger';
import { withDbRetry } from './utils/dbRetry';

const buildGradeKeyboard = (cardId: string) =>
  Markup.inlineKeyboard([
    gradeOptions.map((option) =>
      Markup.button.callback(
        `${option.emoji} ${option.label}`,
        `grade|${cardId}|${option.key}`,
      ),
    ),
  ]);

export class ReviewScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: CardStore,
    private readonly bot: Telegraf,
  ) {}

  start() {
    this.stop();
    this.timer = setInterval(
      () => {
        this.tick().catch((error) =>
          logger.error('Ошибка при проверке карточек', error),
        );
      },
      config.scheduler.scanIntervalMs,
    );
    // моментальный запуск при старте
    this.tick().catch((error) =>
      logger.error('Ошибка при первой проверке карточек', error),
    );
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    const dueCards = await withDbRetry(() =>
      this.store.listDueCards(config.scheduler.batchSize),
    );
    for (const card of dueCards) {
      await this.sendCardToChannel(card, 'scheduled');
    }

    // Auto-grade overdue cards
    await this.checkOverdueGrades();
  }

  private async checkOverdueGrades() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 1); // 24 hours ago
    const cutoffIso = cutoffDate.toISOString();

    const overdueCards = await withDbRetry(() =>
      this.store.listExpiredAwaitingCards(cutoffIso),
    );

    for (const card of overdueCards) {
      try {
        logger.info(`Auto-grading overdue card ${card.id} (awaiting since ${card.awaitingGradeSince})`);
        
        // Apply 'hard' grade (quality 2 in SM-2)
        const { computeReview } = await import('./spacedRepetition');
        const result = computeReview(card, 'hard');
        
        await withDbRetry(() =>
          this.store.saveReviewResult({
            cardId: card.id,
            grade: result.quality,
            nextReviewAt: result.nextReviewAt,
            repetition: result.repetition,
            interval: result.interval,
            easiness: result.easiness,
            reviewedAt: new Date().toISOString(),
          }),
        );

        // Clean up pending message keyboard
        if (card.pendingChannelId && card.pendingChannelMessageId) {
          await this.cleanupPendingMessage(card);
        }

        logger.info(`Auto-graded card ${card.id}: next review ${result.nextReviewAt}`);
      } catch (error) {
        logger.error(`Failed to auto-grade card ${card.id}`, error);
      }
    }
  }

  public async triggerImmediate(cardId: string) {
    let card = await withDbRetry(() => this.store.getCardById(cardId));
    if (card.status === 'pending') {
      throw new Error('Карточка ещё не активирована');
    }
    if (card.status === 'awaiting_grade') {
      await this.cleanupPendingMessage(card);
      await withDbRetry(() => this.store.clearAwaitingGrade(card.id));
      card = await withDbRetry(() => this.store.getCardById(cardId));
    }
    await this.sendCardToChannel(card, 'manual_now');
  }

  private async sendCardToChannel(card: CardRecord, reason: NotificationReason) {
    try {
      if (card.pendingChannelId && card.pendingChannelMessageId) {
        await this.cleanupPendingMessage(card);
        await withDbRetry(() => this.store.clearAwaitingGrade(card.id));
        card = await withDbRetry(() => this.store.getCardById(card.id));
      }

      // Determine target chat ID
      const user = await withDbRetry(() => this.store.getUser(card.userId));
      const targetChatId = user?.notificationChatId || card.userId; // Fallback to user ID (DM)

      const keyboard = buildGradeKeyboard(card.id);
      let pendingMessageId: number;
      let wasCopied = false;
      const copyOriginal = async () => {
        const sourceIds = (card.sourceMessageIds || [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id));
        const uniqueIds = Array.from(new Set(sourceIds)).sort((a, b) => a - b);
        if (uniqueIds.length > 1) {
          const copies = await this.bot.telegram.copyMessages(
            targetChatId,
            card.sourceChatId,
            uniqueIds,
          );
          const lastCopiedId = copies[copies.length - 1]?.message_id;
          if (!lastCopiedId) {
            throw new Error(`Не удалось скопировать медиагруппу карточки ${card.id}`);
          }
          card.baseChannelMessageId = lastCopiedId;
          await withDbRetry(() =>
            this.store.setBaseChannelMessage(card.id, card.baseChannelMessageId),
          );
          const prompt = await this.bot.telegram.sendMessage(
            targetChatId,
            '🔔 Время повторить запись',
            {
              reply_markup: keyboard.reply_markup,
              reply_parameters: {
                message_id: lastCopiedId,
                allow_sending_without_reply: true,
              },
            },
          );
          return prompt.message_id;
        }
        const response = await this.bot.telegram.copyMessage(
          targetChatId,
          card.sourceChatId,
          card.sourceMessageId,
          {
            reply_markup: keyboard.reply_markup,
          },
        );
        card.baseChannelMessageId = response.message_id;
        await withDbRetry(() =>
          this.store.setBaseChannelMessage(card.id, card.baseChannelMessageId),
        );
        return response.message_id;
      };

      if (!card.baseChannelMessageId) {
        pendingMessageId = await copyOriginal();
        wasCopied = true;
      } else {
        try {
          const reminder = await this.bot.telegram.sendMessage(
            targetChatId,
            '🔔 Время повторить запись',
            {
              reply_markup: keyboard.reply_markup,
              reply_parameters: {
                message_id: card.baseChannelMessageId,
                allow_sending_without_reply: true,
              },
            },
          );
          if (!reminder.reply_to_message) {
            await this.deleteMessageSafe(reminder.chat.id, reminder.message_id);
            pendingMessageId = await copyOriginal();
            wasCopied = true;
          } else {
            pendingMessageId = reminder.message_id;
          }
        } catch (err) {
          if (this.isMissingReplyTarget(err)) {
            logger.warn(
              `Базовое сообщение ${card.baseChannelMessageId} для карточки ${card.id} удалено, копирую заново`,
            );
            await withDbRetry(() => this.store.setBaseChannelMessage(card.id, null));
            pendingMessageId = await copyOriginal();
            wasCopied = true;
          } else {
            throw err;
          }
        }
      }

      await withDbRetry(() =>
        this.store.markAwaitingGrade({
          cardId: card.id,
          channelId: targetChatId,
          channelMessageId: pendingMessageId,
          pendingSince: new Date().toISOString(),
        }),
      );
      await withDbRetry(() =>
        this.store.recordNotification({
          cardId: card.id,
          messageId: pendingMessageId,
          reason,
          sentAt: new Date().toISOString(),
        }),
      );
      logger.info(
        `Отправлена карточка ${card.id} в канал (${reason})${wasCopied ? '' : ' (reply)'}`,
      );
    } catch (error) {
      logger.error(`Не удалось отправить карточку ${card.id}`, error);
      const retryAt = dayjs().add(1, 'hour').toISOString();
      await withDbRetry(() => this.store.rescheduleCard(card.id, retryAt));
    }
  }

  private async cleanupPendingMessage(card: CardRecord) {
    if (card.pendingChannelId && card.pendingChannelMessageId) {
      try {
        await this.bot.telegram.editMessageReplyMarkup(
          card.pendingChannelId,
          card.pendingChannelMessageId,
          undefined,
          undefined,
        );
      } catch (err) {
        logger.warn(`Не удалось очистить клавиатуру карточки ${card.id}`, err);
      }
    }
  }

  private isMissingReplyTarget(err: unknown): boolean {
    if (!(err instanceof Error) || !err.message) {
      return false;
    }
    return /reply message not found|message to reply not found|replied message not found/i.test(
      err.message,
    );
  }

  private async deleteMessageSafe(chatId: string | number, messageId: number) {
    try {
      await this.bot.telegram.deleteMessage(chatId, messageId);
    } catch (err) {
      logger.warn(`Не удалось удалить временное сообщение ${messageId}`, err);
    }
  }
}
