import dayjs from 'dayjs';
import { Context, Markup, Telegraf } from 'telegraf';
import { Update, Message } from 'telegraf/typings/core/types/typegram';
import { v4 as uuid } from 'uuid';
import { CardStore } from './db';
import { config } from './config';
import { logger } from './logger';
import { computeInitialReviewDate, computeReview, GradeKey } from './spacedRepetition';

type TelegrafContext = Context<Update>;

const ACTIONS = {
  confirm: 'confirm',
  cancel: 'cancel',
  grade: 'grade',
} as const;

const SUPPORTED_CHAT_TYPES = new Set(['private']);

interface ParsedMessageInfo {
  contentType: string;
  preview: string | null;
  fileId: string | null;
  fileUniqueId: string | null;
}

const isCommandText = (text?: string | null) =>
  Boolean(text && text.startsWith('/'));

const parseMessage = (message: Message): ParsedMessageInfo | null => {
  if ('text' in message && message.text) {
    return {
      contentType: 'text',
      preview: message.text.slice(0, 200),
      fileId: null,
      fileUniqueId: null,
    };
  }
  if ('photo' in message && message.photo?.length) {
    const caption = message.caption ?? '';
    const sorted = [...message.photo].sort(
      (a, b) => (a.file_size ?? 0) - (b.file_size ?? 0),
    );
    const target = sorted[0]!;
    return {
      contentType: 'photo',
      preview: caption.slice(0, 200) || '[Фото]',
      fileId: target.file_id,
      fileUniqueId: target.file_unique_id,
    };
  }
  if ('video' in message && message.video) {
    const caption = message.caption ?? '';
    return {
      contentType: 'video',
      preview: caption.slice(0, 200) || '[Видео]',
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
    };
  }
  return null;
};

const buildAddKeyboard = (cardId: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Добавить в обучение', `${ACTIONS.confirm}|${cardId}`)],
    [Markup.button.callback('Отмена', `${ACTIONS.cancel}|${cardId}`)],
  ]);

const tryRemoveKeyboard = async (ctx: TelegrafContext) => {
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (error) {
    logger.warn('Не удалось обновить клавиатуру', error);
  }
};

const formatNextReviewMessage = (isoDate: string) => {
  const next = dayjs(isoDate);
  const diffHours = next.diff(dayjs(), 'hour');
  if (diffHours < 24) {
    return `через ~${Math.max(1, diffHours)} ч`;
  }
  const diffDays = next.diff(dayjs(), 'day');
  return `через ~${Math.max(1, diffDays)} д`;
};

export const createBot = (store: CardStore) => {
  const bot = new Telegraf<TelegrafContext>(config.botToken);

  bot.start(async (ctx) => {
    await ctx.reply(
      '👋 Отправьте сообщение, фото или видео — и я предложу добавить его в интервальное обучение.',
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Пошагово:\n1. Отправьте сообщение\n2. Нажмите «Добавить в обучение»\n3. Ждите напоминаний в канале и оценивайте освоение кнопками.',
    );
  });

  bot.on('message', async (ctx) => {
    const chatType = ctx.chat?.type;
    if (!ctx.message || !chatType || !SUPPORTED_CHAT_TYPES.has(chatType)) {
      return;
    }

    const userId = ctx.from?.id;
    if (!userId || ctx.from.is_bot) {
      return;
    }

    if ('text' in ctx.message && isCommandText(ctx.message.text)) {
      return;
    }

    const parsed = parseMessage(ctx.message as Message);
    if (!parsed) {
      await ctx.reply(
        '😔 Пока поддерживаются только текст, фото и видео. Код ошибки: E_UNSUPPORTED_CONTENT',
      );
      return;
    }

    const cardId = uuid();
    try {
      await store.createPendingCard({
        id: cardId,
        userId: `${userId}`,
        sourceChatId: `${ctx.chat.id}`,
        sourceMessageId: ctx.message.message_id,
        contentType: parsed.contentType,
        contentPreview: parsed.preview,
        contentFileId: parsed.fileId,
        contentFileUniqueId: parsed.fileUniqueId,
      });
    } catch (error) {
      logger.error('Не удалось создать карточку', error);
      await ctx.reply('Ошибка сохранения (код: E_DB_WRITE). Попробуйте ещё раз.');
      return;
    }

    await ctx.reply(
      'Добавить это в интервальное обучение?',
      buildAddKeyboard(cardId),
    );
  });

  bot.action(new RegExp(`^${ACTIONS.confirm}\\|(.+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    if (!cardId) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    try {
      const card = await store.getCardById(cardId);
      if (card.status !== 'pending') {
        await ctx.answerCbQuery('Эта карточка уже обработана');
        return;
      }
      const nextReviewAt = computeInitialReviewDate(config.initialReviewMinutes);
      await store.activateCard(cardId, { nextReviewAt });
      await ctx.answerCbQuery(
        `Добавлено, напомню ${formatNextReviewMessage(nextReviewAt)}`,
      );
      await tryRemoveKeyboard(ctx);
    } catch (error) {
      logger.error('Не удалось активировать карточку', error);
      await ctx.answerCbQuery('Ошибка при добавлении. Код: E_ACTIVATE', {
        show_alert: true,
      });
    }
  });

  bot.action(new RegExp(`^${ACTIONS.cancel}\\|(.+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    if (!cardId) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    try {
      const card = await store.getCardById(cardId);
      if (card.status !== 'pending') {
        await ctx.answerCbQuery('Уже обработано');
        return;
      }
      await store.deleteCard(cardId);
      await ctx.answerCbQuery('Удалено');
      await tryRemoveKeyboard(ctx);
    } catch (error) {
      logger.error('Не удалось удалить карточку', error);
      await ctx.answerCbQuery('Ошибка удаления (E_CANCEL)', {
        show_alert: true,
      });
    }
  });

  bot.action(
    new RegExp(`^${ACTIONS.grade}\\|([^|]+)\\|(again|hard|good|easy)$`),
    async (ctx) => {
      const cardId = ctx.match?.[1];
      const grade = ctx.match?.[2] as GradeKey | undefined;
      if (!cardId || !grade) {
        await ctx.answerCbQuery('Некорректное действие');
        return;
      }
      const card = await store.findAwaitingCard(cardId);
      if (!card) {
        await ctx.answerCbQuery('Повтор уже обработан');
        return;
      }
      try {
        const result = computeReview(card, grade);
        await store.saveReviewResult({
          cardId,
          grade: result.quality,
          nextReviewAt: result.nextReviewAt,
          repetition: result.repetition,
          interval: result.interval,
          easiness: result.easiness,
          reviewedAt: new Date().toISOString(),
        });
        if (card.pendingChannelId && card.pendingChannelMessageId) {
          try {
            await ctx.telegram.editMessageReplyMarkup(
              card.pendingChannelId,
              card.pendingChannelMessageId,
              undefined,
              undefined,
            );
          } catch (editError) {
            logger.warn(
              `Не удалось обновить сообщение канала для карточки ${card.id}`,
              editError,
            );
          }
        }
        await ctx.answerCbQuery(
          `Готово! Следующее повторение ${formatNextReviewMessage(result.nextReviewAt)}`,
        );
      } catch (error) {
        logger.error('Ошибка обработки оценки', error);
        await ctx.answerCbQuery('Не удалось сохранить оценку (E_GRADE)', {
          show_alert: true,
        });
      }
    },
  );

  bot.catch((err) => {
    logger.error('Ошибка бота', err);
  });

  return bot;
};
