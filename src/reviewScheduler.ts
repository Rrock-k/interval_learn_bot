import dayjs from 'dayjs';
import { Markup, Telegraf } from 'telegraf';
import { CardRecord, CardStore, NotificationReason } from './db';
import { config } from './config';
import { computeReview, gradeOptions, GradeKey } from './spacedRepetition';
import { logger } from './logger';

const buildGradeKeyboard = (cardId: string) =>
  Markup.inlineKeyboard([
    gradeOptions.map((option) =>
      Markup.button.callback(
        `${option.emoji} ${option.label}`,
        `grade|${cardId}|${option.key}`,
      ),
    ),
  ]);

const DEFAULT_TIMEOUT_GRADE: GradeKey = 'again';

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
    const dueCards = this.store.listDueCards(config.scheduler.batchSize);
    for (const card of dueCards) {
      await this.sendCardToChannel(card, 'scheduled');
    }
    await this.autoGradeExpired();
  }

  public async triggerImmediate(cardId: string) {
    const card = this.store.getCardById(cardId);
    if (card.status === 'pending') {
      throw new Error('Карточка ещё не активирована');
    }
    if (card.status === 'awaiting_grade') {
      throw new Error('Карточка уже ожидает оценку');
    }
    await this.sendCardToChannel(card, 'manual_now');
  }

  private async sendCardToChannel(card: CardRecord, reason: NotificationReason) {
    try {
      const keyboard = buildGradeKeyboard(card.id);
      let messageId: number;
      let wasCopied = false;
      if (!card.baseChannelMessageId) {
        const response = await this.bot.telegram.copyMessage(
          config.reviewChannelId,
          card.sourceChatId,
          card.sourceMessageId,
          {
            reply_markup: keyboard.reply_markup,
          },
        );
        messageId = response.message_id;
        wasCopied = true;
        this.store.ensureBaseChannelMessage(card.id, messageId);
      } else {
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
        messageId = reminder.message_id;
      }

      this.store.markAwaitingGrade({
        cardId: card.id,
        channelId: config.reviewChannelId,
        channelMessageId: messageId,
        pendingSince: new Date().toISOString(),
      });
      this.store.recordNotification({
        cardId: card.id,
        messageId,
        reason,
        sentAt: new Date().toISOString(),
      });
      logger.info(
        `Отправлена карточка ${card.id} в канал (${reason})${wasCopied ? '' : ' (reply)'}`,
      );
    } catch (error) {
      logger.error(`Не удалось отправить карточку ${card.id}`, error);
      const retryAt = dayjs().add(1, 'hour').toISOString();
      this.store.rescheduleCard(card.id, retryAt);
    }
  }

  private async autoGradeExpired() {
    const cutoff = dayjs().subtract(1, 'minute').toISOString();
    const expired = this.store.listExpiredAwaitingCards(cutoff);
    if (!expired.length) {
      return;
    }
    for (const card of expired) {
      try {
        const result = computeReview(card, DEFAULT_TIMEOUT_GRADE);
        this.store.saveReviewResult({
          cardId: card.id,
          grade: result.quality,
          nextReviewAt: result.nextReviewAt,
          repetition: result.repetition,
          interval: result.interval,
          easiness: result.easiness,
          reviewedAt: new Date().toISOString(),
        });
        if (card.pendingChannelId && card.pendingChannelMessageId) {
          try {
            await this.bot.telegram.editMessageReplyMarkup(
              card.pendingChannelId,
              card.pendingChannelMessageId,
              undefined,
              undefined,
            );
          } catch (err) {
            logger.warn(
              `Не удалось убрать клавиатуру по таймауту для карточки ${card.id}`,
              err,
            );
          }
        }
        logger.info(
          `Карточка ${card.id} автоматически оценена как ${DEFAULT_TIMEOUT_GRADE} после таймаута`,
        );
      } catch (error) {
        logger.error(`Ошибка автооценки карточки ${card.id}`, error);
      }
    }
  }
}
