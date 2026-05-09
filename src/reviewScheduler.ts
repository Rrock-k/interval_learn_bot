import { Telegraf } from 'telegraf';
import {
  CardRecord,
  CardStore,
  NotificationReason,
  ReminderJobKind,
  ReminderJobWithCard,
} from './db';
import { config } from './config';
import { buildReminderJobKeyboard } from './reviewKeyboards';
import { logger } from './logger';
import { withDbRetry } from './utils/dbRetry';

const reminderTextByKind: Record<ReminderJobKind, string> = {
  review: '🔔 Время повторить запись',
  manual_now: '🔔 Время повторить запись',
  one_time: '🔔 Одноразовое напоминание',
};

const notificationReasonByKind: Record<ReminderJobKind, NotificationReason> = {
  review: 'scheduled',
  manual_now: 'manual_now',
  one_time: 'one_time',
};

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
    const orphanDueCards = await withDbRetry(() =>
      this.store.listDueCardsWithoutActiveReviewJob(config.scheduler.batchSize),
    );
    for (const card of orphanDueCards) {
      const dueAt = card.nextReviewAt;
      if (!dueAt) continue;
      await withDbRetry(() =>
        this.store.createReminderJob({
          cardId: card.id,
          userId: card.userId,
          kind: 'review',
          dueAt,
          source: 'due_reconcile',
        }),
      );
    }

    const dueJobs = await withDbRetry(() =>
      this.store.claimDueReminderJobs(config.scheduler.batchSize),
    );
    for (const item of dueJobs) {
      await this.sendReminderJobToChannel(item);
    }

    await this.checkOverdueGrades();
  }

  private async checkOverdueGrades() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 1);
    const cutoffIso = cutoffDate.toISOString();

    const overdueCards = await withDbRetry(() =>
      this.store.listExpiredAwaitingCards(cutoffIso),
    );

    for (const card of overdueCards) {
      try {
        logger.info(`Re-sending unreviewed card ${card.id} (awaiting since ${card.awaitingGradeSince})`);

        if (card.pendingChannelId && card.pendingChannelMessageId) {
          await this.markMessageNotViewed(card);
        }

        await withDbRetry(() => this.store.clearAwaitingGrade(card.id));
        const freshCard = await withDbRetry(() => this.store.getCardById(card.id));
        const now = new Date().toISOString();
        const job = await withDbRetry(() =>
          this.store.createReminderJob({
            cardId: freshCard.id,
            userId: freshCard.userId,
            kind: 'review',
            dueAt: now,
            scheduledAt: now,
            source: 'overdue_retry',
          }),
        );

        await this.sendReminderJobToChannel({ job, card: freshCard });
        logger.info(`Re-sent unreviewed card ${card.id}`);
      } catch (error) {
        logger.error(`Failed to re-send card ${card.id}`, error);
      }
    }
  }

  public async triggerImmediate(cardId: string) {
    let card = await withDbRetry(() => this.store.getCardById(cardId));
    logger.info(
      `[ReviewScheduler triggerImmediate] card=${card.id} status=${card.status} base=${card.baseChannelMessageId ?? 'null'} pending=${card.pendingChannelMessageId ?? 'null'} awaiting=${card.awaitingGradeSince ?? 'null'}`,
    );
    if (card.status === 'pending') {
      throw new Error('Карточка ещё не активирована');
    }
    if (card.status === 'archived') {
      throw new Error('Карточка архивирована');
    }
    if (card.status === 'awaiting_grade') {
      await this.cleanupPendingMessage(card);
      await withDbRetry(() => this.store.clearAwaitingGrade(card.id));
      card = await withDbRetry(() => this.store.getCardById(cardId));
    }

    const now = new Date().toISOString();
    const job = await withDbRetry(() =>
      this.store.createReminderJob({
        cardId: card.id,
        userId: card.userId,
        kind: 'manual_now',
        dueAt: now,
        scheduledAt: now,
        source: 'manual_now',
      }),
    );
    await this.sendReminderJobToChannel({ job, card });
  }

  private async sendReminderJobToChannel(input: ReminderJobWithCard) {
    let { job, card } = input;
    let targetChatId = card.userId;
    try {
      logger.info(
        `[ReviewScheduler sendReminderJob:start] job=${job.id} kind=${job.kind} card=${card.id} status=${card.status} base=${card.baseChannelMessageId ?? 'null'} pending=${card.pendingChannelMessageId ?? 'null'} source=${card.sourceChatId}:${card.sourceMessageId}`,
      );

      card = await withDbRetry(() => this.store.getCardById(card.id));
      if (card.status === 'archived') {
        await withDbRetry(() => this.store.cancelReminderJob(job.id));
        logger.info(`[ReviewScheduler sendReminderJob:cancel_archived] job=${job.id} card=${card.id}`);
        return;
      }

      if (job.status === 'pending') {
        await withDbRetry(() => this.store.markReminderJobSending(job.id));
        job = { ...job, status: 'sending' };
      }

      if (job.kind !== 'one_time' && card.pendingChannelId && card.pendingChannelMessageId) {
        await this.cleanupPendingMessage(card);
        await withDbRetry(() => this.store.clearAwaitingGrade(card.id));
        card = await withDbRetry(() => this.store.getCardById(card.id));
      }

      const user = await withDbRetry(() => this.store.getUser(card.userId));
      targetChatId = user?.notificationChatId || card.userId;

      const keyboard = buildReminderJobKeyboard(card.id, job.id, job.kind);
      let pendingMessageId: number;
      let baseMessageId = card.baseChannelMessageId;
      let usedReply = false;
      const reminderText = reminderTextByKind[job.kind];

      const normalizePreview = (value?: string | null): string | null => {
        const normalized = (value ?? '').trim();
        return normalized === '' ? null : normalized;
      };
      const isTechnicalPreview = (value: string | null): boolean => {
        if (!value) return false;
        return value === '[Фото]' || value === '[Видео]' || value.startsWith('[Фото x') || value.startsWith('[Видео x') || value.startsWith('[Медиа x');
      };

      const sendReminderWithReply = async (replyBaseMessageId: number) => {
        logger.info(
          `[ReviewScheduler sendReminderWithReply] job=${job.id} card=${card.id} kind=${job.kind} mode=reply_to_message_id baseMessageId=${replyBaseMessageId} target=${targetChatId}`,
        );
        const reminder = await (this.bot.telegram as any).callApi('sendMessage', {
          chat_id: targetChatId,
          text: reminderText,
          reply_markup: keyboard.reply_markup,
          reply_to_message_id: replyBaseMessageId,
          allow_sending_without_reply: false,
        });
        const replyToMessage = reminder.reply_to_message as
          | { message_id?: number; chat?: { id?: string | number } }
          | undefined;
        const replyToMessageId = replyToMessage?.message_id ?? null;
        const replyToChatId =
          typeof replyToMessage?.chat?.id === 'undefined'
            ? null
            : String(replyToMessage.chat.id);
        logger.info(
          `[ReviewScheduler sendReminderWithReply:result] job=${job.id} card=${card.id} messageId=${reminder.message_id} replyTo=${replyToChatId ?? 'null'}:${replyToMessageId ?? 'null'}`,
        );
        if (
          !replyToMessage ||
          replyToMessageId !== replyBaseMessageId ||
          replyToChatId !== String(targetChatId)
        ) {
          throw new Error(
            `reply target mismatch: expected ${targetChatId}:${replyBaseMessageId}, got ${replyToChatId ?? 'null'}:${replyToMessageId ?? 'null'}`,
          );
        }
        return reminder.message_id;
      };

      const sendStoredBaseMessage = async (withKeyboard = false) => {
        logger.info(
          `[ReviewScheduler sendStoredBaseMessage] job=${job.id} card=${card.id} kind=${job.kind} withKeyboard=${withKeyboard} target=${targetChatId} contentType=${card.contentType}`,
        );
        const replyMarkup = withKeyboard ? { reply_markup: keyboard.reply_markup } : {};
        const sourceIds = (card.sourceMessageIds || [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id));
        const uniqueSourceIds = Array.from(new Set(sourceIds)).sort((a, b) => a - b);
        if (uniqueSourceIds.length > 1) {
          let lastCopiedMessageId: number | null = null;
          try {
            const copiedMessages = await this.bot.telegram.copyMessages(
              targetChatId,
              card.sourceChatId,
              uniqueSourceIds,
            );
            lastCopiedMessageId =
              copiedMessages[copiedMessages.length - 1]?.message_id ?? null;
            if (!lastCopiedMessageId) {
              throw new Error(`Не удалось скопировать медиагруппу карточки ${card.id}`);
            }
            card.baseChannelMessageId = lastCopiedMessageId;
            baseMessageId = lastCopiedMessageId;
            await withDbRetry(() =>
              this.store.setBaseChannelMessage(card.id, card.baseChannelMessageId),
            );
            logger.info(
              `[ReviewScheduler sendStoredBaseMessage:copied_media_group] job=${job.id} card=${card.id} source=${card.sourceChatId}:${uniqueSourceIds.join(',')} baseMessageId=${lastCopiedMessageId}`,
            );
          } catch (error) {
            logger.warn(
              `Не удалось скопировать медиагруппу карточки ${card.id}, пересобираю из сохранённых данных`,
              error,
            );
          }
          if (lastCopiedMessageId) {
            if (withKeyboard) {
              return await sendReminderWithReply(lastCopiedMessageId);
            }
            return lastCopiedMessageId;
          }
        }

        try {
          const sourceMessageId = uniqueSourceIds[0] ?? card.sourceMessageId;
          const copiedMessage = await this.bot.telegram.copyMessage(
            targetChatId,
            card.sourceChatId,
            sourceMessageId,
            replyMarkup,
          );
          const messageId = copiedMessage.message_id;
          card.baseChannelMessageId = messageId;
          baseMessageId = messageId;
          await withDbRetry(() =>
            this.store.setBaseChannelMessage(card.id, card.baseChannelMessageId),
          );
          logger.info(
            `[ReviewScheduler sendStoredBaseMessage:copied_source] job=${job.id} card=${card.id} source=${card.sourceChatId}:${sourceMessageId} messageId=${messageId}`,
          );
          return messageId;
        } catch (error) {
          logger.warn(
            `Не удалось скопировать исходное сообщение карточки ${card.id}, пересобираю из сохранённых данных`,
            error,
          );
        }
        const rawPreview = normalizePreview(card.contentPreview);
        const preview = rawPreview && !isTechnicalPreview(rawPreview) ? rawPreview : null;
        const textFallback = preview ?? 'Карточка без текста';
        let messageId: number;
        if (card.contentType === 'photo' && card.contentFileId) {
          try {
            const baseMessage = await this.bot.telegram.sendPhoto(
              targetChatId,
              card.contentFileId,
              preview
                ? { caption: preview.slice(0, 1024), ...replyMarkup }
                : replyMarkup,
            );
            messageId = baseMessage.message_id;
          } catch (error) {
            logger.warn(`Не удалось отправить фото карточки ${card.id} как базу`, error);
            const baseMessage = await this.bot.telegram.sendMessage(
              targetChatId,
              textFallback,
              replyMarkup,
            );
            messageId = baseMessage.message_id;
          }
        } else if (card.contentType === 'video' && card.contentFileId) {
          try {
            const baseMessage = await this.bot.telegram.sendVideo(
              targetChatId,
              card.contentFileId,
              preview
                ? { caption: preview.slice(0, 1024), ...replyMarkup }
                : replyMarkup,
            );
            messageId = baseMessage.message_id;
          } catch (error) {
            logger.warn(`Не удалось отправить видео карточки ${card.id} как базу`, error);
            const baseMessage = await this.bot.telegram.sendMessage(
              targetChatId,
              textFallback,
              replyMarkup,
            );
            messageId = baseMessage.message_id;
          }
        } else {
          const baseMessage = await this.bot.telegram.sendMessage(
            targetChatId,
            textFallback,
            replyMarkup,
          );
          messageId = baseMessage.message_id;
        }
        card.baseChannelMessageId = messageId;
        baseMessageId = messageId;
        await withDbRetry(() =>
          this.store.setBaseChannelMessage(card.id, card.baseChannelMessageId),
        );
        return messageId;
      };

      if (!card.baseChannelMessageId) {
        logger.info(
          `[ReviewScheduler branch] job=${job.id} card=${card.id} kind=${job.kind} branch=no_base_send_full_card`,
        );
        pendingMessageId = await sendStoredBaseMessage(true);
      } else {
        try {
          logger.info(
            `[ReviewScheduler branch] job=${job.id} card=${card.id} kind=${job.kind} branch=reply baseMessageId=${card.baseChannelMessageId}`,
          );
          pendingMessageId = await sendReminderWithReply(card.baseChannelMessageId);
          usedReply = true;
        } catch (err) {
          if (this.isMissingReplyTarget(err)) {
            logger.warn(
              `Базовое сообщение ${card.baseChannelMessageId} для карточки ${card.id} удалено, копирую заново`,
            );
            logger.info(
              `[ReviewScheduler branch] job=${job.id} card=${card.id} kind=${job.kind} branch=missing_reply_target_recreate_full_card`,
            );
            await withDbRetry(() => this.store.setBaseChannelMessage(card.id, null));
            pendingMessageId = await sendStoredBaseMessage(true);
          } else {
            throw err;
          }
        }
      }

      const sentAt = new Date().toISOString();
      if (job.kind === 'one_time') {
        await withDbRetry(() =>
          this.store.markReminderJobAwaitingAction({
            jobId: job.id,
            deliveryChatId: targetChatId,
            deliveryMessageId: pendingMessageId,
            sentAt,
            baseMessageId,
          }),
        );
      } else {
        await withDbRetry(() =>
          this.store.markAwaitingGrade({
            cardId: card.id,
            jobId: job.id,
            channelId: targetChatId,
            channelMessageId: pendingMessageId,
            pendingSince: sentAt,
            baseMessageId,
          }),
        );
      }
      await withDbRetry(() =>
        this.store.recordNotification({
          cardId: card.id,
          jobId: job.id,
          messageId: pendingMessageId,
          reason: notificationReasonByKind[job.kind],
          sentAt,
        }),
      );
      logger.info(
        `Отправлено напоминание job=${job.id} card=${card.id} kind=${job.kind}${usedReply ? ' (reply)' : ''}`,
      );
    } catch (error) {
      logger.error(`Не удалось отправить напоминание job=${job.id} card=${card.id}`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'неизвестная ошибка';
      const compactMessage = errorMessage.replace(/\s+/g, ' ').slice(0, 240);
      await withDbRetry(() => this.store.failReminderJob(job.id, compactMessage));
      try {
        const latestCard = await withDbRetry(() => this.store.getCardById(card.id));
        if (latestCard.status !== 'archived') {
          const retryAt = new Date(Date.now() + 60 * 60_000).toISOString();
          await withDbRetry(() =>
            this.store.createReminderJob({
              cardId: latestCard.id,
              userId: latestCard.userId,
              kind: job.kind,
              dueAt: retryAt,
              scheduledAt: retryAt,
              source: 'send_retry',
              snoozedFromJobId: job.id,
              metadata: job.metadata,
            }),
          );
        }
      } catch (retryError) {
        logger.warn(`Не удалось поставить retry для job=${job.id} card=${card.id}`, retryError);
      }
      try {
        await this.bot.telegram.sendMessage(
          targetChatId,
          `⚠ Не удалось отправить напоминание по карточке ${card.id}. Ошибка: ${compactMessage}`,
        );
      } catch (notifyErr) {
        logger.warn(`Не удалось отправить уведомление об ошибке карточки ${card.id}`, notifyErr);
      }
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
    return /reply message not found|message to reply not found|replied message not found|message is not found|reply target mismatch/i.test(
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
}
