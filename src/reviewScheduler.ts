import dayjs from 'dayjs';
import { Telegraf } from 'telegraf';
import { CardRecord, CardStore, NotificationReason } from './db';
import { config } from './config';
import { buildReviewKeyboard } from './reviewKeyboards';
import { logger } from './logger';
import { withDbRetry } from './utils/dbRetry';

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
        logger.info(`Re-sending unreviewed card ${card.id} (awaiting since ${card.awaitingGradeSince})`);

        // Mark old message as "не просмотрено"
        if (card.pendingChannelId && card.pendingChannelMessageId) {
          await this.markMessageNotViewed(card);
        }

        // Clear awaiting state so sendCardToChannel can re-send
        await withDbRetry(() => this.store.clearAwaitingGrade(card.id));
        const freshCard = await withDbRetry(() => this.store.getCardById(card.id));

        // Send new reminder immediately
        await this.sendCardToChannel(freshCard, 'scheduled');

        logger.info(`Re-sent unreviewed card ${card.id}`);
      } catch (error) {
        logger.error(`Failed to re-send card ${card.id}`, error);
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
    let targetChatId = card.userId;
    try {
      if (card.pendingChannelId && card.pendingChannelMessageId) {
        await this.cleanupPendingMessage(card);
        await withDbRetry(() => this.store.clearAwaitingGrade(card.id));
        card = await withDbRetry(() => this.store.getCardById(card.id));
      }

      // Determine target chat ID
      const user = await withDbRetry(() => this.store.getUser(card.userId));
      targetChatId = user?.notificationChatId || card.userId; // Fallback to user ID (DM)

      const keyboard = buildReviewKeyboard(card.id);
      let pendingMessageId: number;
      let usedReply = false;
      const reminderText = '🔔 Время повторить запись';

      const normalizePreview = (value?: string | null): string | null => {
        const normalized = (value ?? '').trim();
        return normalized === '' ? null : normalized;
      };

      const sendReminderWithReply = async (baseMessageId: number) => {
        const reminder = await this.bot.telegram.sendMessage(targetChatId, reminderText, {
          reply_markup: keyboard.reply_markup,
          reply_parameters: {
            message_id: baseMessageId,
            allow_sending_without_reply: false,
          },
        });
        if (!reminder.reply_to_message) {
          throw new Error('replied message not found');
        }
        return reminder.message_id;
      };

      const sendStoredBaseMessage = async (withKeyboard = false) => {
        const preview =
          normalizePreview(card.contentPreview) ??
          (card.contentType === 'photo'
            ? '[Фото]'
            : card.contentType === 'video'
              ? '[Видео]'
              : 'Карточка без текста');
        const replyMarkup = withKeyboard ? { reply_markup: keyboard.reply_markup } : {};
        let messageId: number;
        if (card.contentType === 'photo' && card.contentFileId) {
          try {
            const baseMessage = await this.bot.telegram.sendPhoto(
              targetChatId,
              card.contentFileId,
              { caption: preview.slice(0, 1024), ...replyMarkup },
            );
            messageId = baseMessage.message_id;
          } catch (error) {
            logger.warn(`Не удалось отправить фото карточки ${card.id} как базу`, error);
            const baseMessage = await this.bot.telegram.sendMessage(
              targetChatId,
              preview,
              replyMarkup,
            );
            messageId = baseMessage.message_id;
          }
        } else if (card.contentType === 'video' && card.contentFileId) {
          try {
            const baseMessage = await this.bot.telegram.sendVideo(
              targetChatId,
              card.contentFileId,
              { caption: preview.slice(0, 1024), ...replyMarkup },
            );
            messageId = baseMessage.message_id;
          } catch (error) {
            logger.warn(`Не удалось отправить видео карточки ${card.id} как базу`, error);
            const baseMessage = await this.bot.telegram.sendMessage(
              targetChatId,
              preview,
              replyMarkup,
            );
            messageId = baseMessage.message_id;
          }
        } else {
          const baseMessage = await this.bot.telegram.sendMessage(
            targetChatId,
            preview,
            replyMarkup,
          );
          messageId = baseMessage.message_id;
        }
        card.baseChannelMessageId = messageId;
        await withDbRetry(() =>
          this.store.setBaseChannelMessage(card.id, card.baseChannelMessageId),
        );
        return messageId;
      };

      if (!card.baseChannelMessageId) {
        try {
          pendingMessageId = await sendStoredBaseMessage(true);
        } catch (error) {
          logger.warn(
            `Не удалось отправить полную карточку для карточки ${card.id}, попробую ещё раз из сохранённых данных`,
            error,
          );
          pendingMessageId = await sendStoredBaseMessage(true);
        }
      } else {
        try {
          pendingMessageId = await sendReminderWithReply(card.baseChannelMessageId);
          usedReply = true;
        } catch (err) {
          if (this.isMissingReplyTarget(err)) {
            logger.warn(
              `Базовое сообщение ${card.baseChannelMessageId} для карточки ${card.id} удалено, копирую заново`,
            );
            await withDbRetry(() => this.store.setBaseChannelMessage(card.id, null));
            try {
              pendingMessageId = await sendStoredBaseMessage(true);
            } catch (error) {
              logger.warn(
                `Не удалось восстановить полную карточку для карточки ${card.id}, пробую ещё раз из сохранённых данных`,
                error,
              );
              pendingMessageId = await sendStoredBaseMessage(true);
            }
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
        `Отправлена карточка ${card.id} в канал (${reason})${usedReply ? ' (reply)' : ''}`,
      );
    } catch (error) {
      logger.error(`Не удалось отправить карточку ${card.id}`, error);
      try {
        const errorMessage =
          error instanceof Error ? error.message : 'неизвестная ошибка';
        const compactMessage = errorMessage.replace(/\s+/g, ' ').slice(0, 240);
        await this.bot.telegram.sendMessage(
          targetChatId,
          `⚠ Не удалось отправить напоминание по карточке ${card.id}. Ошибка: ${compactMessage}`,
        );
      } catch (notifyErr) {
        logger.warn(`Не удалось отправить уведомление об ошибке карточки ${card.id}`, notifyErr);
      }
      const retryAt = dayjs().add(1, 'hour').toISOString();
      await withDbRetry(() => this.store.rescheduleCard(card.id, retryAt));
    }
  }

  private async markMessageNotViewed(card: CardRecord) {
    if (!card.pendingChannelId || !card.pendingChannelMessageId) return;
    const isActualCardMessage =
      card.baseChannelMessageId !== null &&
      card.baseChannelMessageId === card.pendingChannelMessageId;
    if (isActualCardMessage) {
      return;
    }

    const label = '⏭ Не просмотрено — отправлено снова';
    try {
      await this.bot.telegram.editMessageText(
        card.pendingChannelId,
        card.pendingChannelMessageId,
        undefined,
        label,
        { reply_markup: { inline_keyboard: [] } },
      );
    } catch {
      try {
        await this.bot.telegram.editMessageCaption(
          card.pendingChannelId,
          card.pendingChannelMessageId,
          undefined,
          label,
          { reply_markup: { inline_keyboard: [] } },
        );
      } catch (err) {
        logger.warn(`Не удалось отметить карточку ${card.id} как не просмотренную`, err);
      }
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
    const description = this.extractErrorDescription(err);
    if (!description) {
      return false;
    }
    const fullText = [description].join(' ');
    return /reply message not found|message to reply not found|replied message not found|message is not found/i.test(
      fullText,
    );
  }

  private extractErrorDescription(error: unknown): string | null {
    if (!error || typeof error !== 'object') {
      if (typeof error === 'string') return error;
      return null;
    }

    const asError = error as {
      message?: unknown;
      description?: unknown;
      cause?: unknown;
      response?: unknown;
    };

    const candidates: unknown[] = [
      asError.message,
      asError.description,
      asError.cause,
      asError.response,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        return candidate;
      }
        if (candidate && typeof candidate === 'object') {
        const asObject = candidate as {
          description?: unknown;
          message?: unknown;
          response?: unknown;
        };
        if (typeof asObject.description === 'string') {
          return asObject.description;
        }
        if (typeof asObject.message === 'string') {
          return asObject.message;
        }
        if (typeof asObject.response !== 'undefined') {
          const nested = this.extractErrorDescription(asObject.response);
          if (nested) return nested;
        }
      }
    }
    return null;
  }

  private async deleteMessageSafe(chatId: string | number, messageId: number) {
    try {
      await this.bot.telegram.deleteMessage(chatId, messageId);
    } catch (err) {
      logger.warn(`Не удалось удалить временное сообщение ${messageId}`, err);
    }
  }
}
