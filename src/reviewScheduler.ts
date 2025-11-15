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
      let current = card;
      if (current.status === 'awaiting_grade') {
        await this.cleanupPendingMessage(current);
        await withDbRetry(() => this.store.clearAwaitingGrade(current.id));
        current = await withDbRetry(() => this.store.getCardById(current.id));
      }
      await this.sendCardToChannel(current, 'scheduled');
    }
    await this.recoverExpiredAwaiting();
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
      const keyboard = buildGradeKeyboard(card.id);
      let messageId: number;
      let wasCopied = false;
      const copyOriginal = async () => {
        const response = await this.bot.telegram.copyMessage(
          config.reviewChannelId,
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
        messageId = await copyOriginal();
        wasCopied = true;
      } else {
        try {
          const reminder = await this.bot.telegram.sendMessage(
            config.reviewChannelId,
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
            messageId = await copyOriginal();
            wasCopied = true;
          } else {
            messageId = reminder.message_id;
          }
        } catch (err) {
          if (this.isMissingReplyTarget(err)) {
            logger.warn(
              `Базовое сообщение ${card.baseChannelMessageId} для карточки ${card.id} удалено, копирую заново`,
            );
            await withDbRetry(() => this.store.setBaseChannelMessage(card.id, null));
            messageId = await copyOriginal();
            wasCopied = true;
          } else {
            throw err;
          }
        }
      }

      await withDbRetry(() =>
        this.store.markAwaitingGrade({
          cardId: card.id,
          channelId: config.reviewChannelId,
          channelMessageId: messageId,
          pendingSince: new Date().toISOString(),
        }),
      );
      await withDbRetry(() =>
        this.store.recordNotification({
          cardId: card.id,
          messageId,
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

  private async recoverExpiredAwaiting() {
    const timeoutMs = config.scheduler.awaitingGradeTimeoutMs;
    const cutoff = dayjs().subtract(timeoutMs, 'millisecond').toISOString();
    const expired = await withDbRetry(() =>
      this.store.listExpiredAwaitingCards(cutoff),
    );
    if (!expired.length) {
      return;
    }
    for (const card of expired) {
      try {
        await this.cleanupPendingMessage(card);
        await withDbRetry(() => this.store.clearAwaitingGrade(card.id));
        logger.info(
          `Карточка ${card.id} возвращена в статус learning после ${Math.round(
            timeoutMs / 1000,
          )} секунд ожидания оценки`,
        );
      } catch (error) {
        logger.error(`Ошибка возврата карточки ${card.id} после таймаута`, error);
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
