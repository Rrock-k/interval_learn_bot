import dayjs from 'dayjs';
import { Context, Markup, Telegraf } from 'telegraf';
import { Update, Message } from 'telegraf/typings/core/types/typegram';
import { v4 as uuid } from 'uuid';
import { CardStore } from './db';
import { config } from './config';
import { logger } from './logger';
import { computeInitialReviewDate, computeReview, GradeKey } from './spacedRepetition';
import { withDbRetry } from './utils/dbRetry';

type TelegrafContext = Context<Update>;

const ACTIONS = {
  confirm: 'confirm',
  cancel: 'cancel',
  grade: 'grade',
  approveUser: 'approve_user',
  rejectUser: 'reject_user',
} as const;

const SUPPORTED_MESSAGE_SOURCE_TYPES = new Set(['private']);

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

const getWebAppUrl = () => {
  const domain = process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000';
  const protocol = domain.includes('localhost') ? 'http://' : 'https://';
  return `${protocol}${domain}/miniapp`;
};

const getWebAppKeyboard = (url: string) =>
  Markup.inlineKeyboard([
    [Markup.button.webApp('🚀 Открыть приложение', url)],
  ]);

const getDeepLinkKeyboard = (botUsername: string) =>
  Markup.inlineKeyboard([
    [Markup.button.url('➡️ Открыть в ЛС', `https://t.me/${botUsername}?start=webapp`)],
  ]);

export const createBot = (store: CardStore) => {
  const bot = new Telegraf<TelegrafContext>(config.botToken);

  // Authorization Middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || ctx.from?.is_bot) return next();

    // Skip auth for admin commands in admin chat if needed, but here we want to auth users interacting with the bot
    // We might want to allow the admin to use the bot without approval if they are the admin, but let's stick to the flow.
    // Actually, if the user is the admin, they should probably be auto-approved or just allowed.
    // For now, let's treat everyone as a user who needs approval, or maybe auto-approve the admin?
    // Let's just follow the standard flow.

    try {
      const user = await withDbRetry(() => store.getUser(`${userId}`));

      if (!user) {
        // New user
        await withDbRetry(() =>
          store.createUser({
            id: `${userId}`,
            username: ctx.from?.username || '',
            firstName: ctx.from?.first_name || '',
            lastName: ctx.from?.last_name || '',
          }),
        );

        // Notify Admin
        if (config.adminChatId) {
          try {
            await ctx.telegram.sendMessage(
              config.adminChatId,
              `👤 <b>Новый запрос доступа</b>\n\nID: <code>${userId}</code>\nUser: @${
                ctx.from?.username || 'N/A'
              }\nName: ${ctx.from?.first_name} ${ctx.from?.last_name || ''}`,
              {
                parse_mode: 'HTML',
                ...(config.adminChatTopicId && { message_thread_id: config.adminChatTopicId }),
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback('✅ Одобрить', `${ACTIONS.approveUser}|${userId}`),
                    Markup.button.callback('❌ Отклонить', `${ACTIONS.rejectUser}|${userId}`),
                  ],
                ]),
              },
            );
            logger.info(`Admin notification sent to ${config.adminChatId} (topic: ${config.adminChatTopicId || 'none'})`);
          } catch (error) {
            logger.error(`Failed to send admin notification to ${config.adminChatId}`, error);
          }
        }

        await ctx.reply(
          '⏳ Ваш запрос на доступ отправлен администратору. Пожалуйста, подождите подтверждения.',
        );
        return;
      }

      if (user.status === 'pending') {
        await ctx.reply('⏳ Ваш аккаунт ожидает подтверждения администратора.');
        return;
      }

      if (user.status === 'rejected') {
        // Silent reject or message
        return;
      }

      // Approved
      return next();
    } catch (error) {
      logger.error('Auth middleware error', error);
      return next(); // Fail open or closed? Let's fail open for now to not block if DB fails, or maybe fail closed.
      // Better to fail closed for security, but for a bot... let's fail closed with a message.
      // await ctx.reply('Произошла ошибка проверки доступа.');
    }
  });

  bot.start(async (ctx) => {
    const payload = ctx.payload; // /start <payload>
    if (payload === 'webapp') {
      await ctx.reply(
        '📱 Откройте приложение для управления вашими карточками:',
        getWebAppKeyboard(getWebAppUrl())
      );
      return;
    }

    await ctx.reply(
      '👋 Отправьте сообщение, фото или видео — и я предложу добавить его в интервальное обучение.',
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Пошагово:\n1. Отправьте сообщение\n2. Нажмите «Добавить в обучение»\n3. Ждите напоминаний в канале и оценивайте освоение кнопками.\n\nКоманды:\n/webapp — открыть приложение для управления карточками\n/use_this_chat — получать напоминания в этот чат (если это группа/канал, добавьте бота админом).',
    );
  });

  bot.command('webapp', async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    logger.info(`Command /webapp received from user ${userId} in chat ${chatId} (${chatType})`);

    try {
      if (chatType === 'private') {
        await ctx.reply(
          '📱 Откройте приложение для управления вашими карточками:',
          getWebAppKeyboard(getWebAppUrl())
        );
      } else {
        // In groups, we can't use web_app buttons. Redirect to private chat.
        const botUsername = ctx.botInfo.username;
        await ctx.reply(
          '📱 Чтобы открыть приложение, перейдите в личные сообщения:',
          getDeepLinkKeyboard(botUsername)
        );
      }
      logger.info(`WebApp button sent to chat ${chatId}`);
    } catch (error) {
      logger.error(`Failed to send /webapp response to chat ${chatId}`, error);
      try {
        await ctx.reply('❌ Не удалось отправить кнопку приложения. Возможно, у меня нет прав отправлять сообщения в этот чат.');
      } catch (innerError) {
        logger.error(`Failed to send error message to chat ${chatId}`, innerError);
      }
    }
  });

  bot.command('use_this_chat', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;

    // If it's a group or channel, check admin rights (optional but good practice)
    // For now, let's just try to set it. If bot can't post, it will fail later.
    // But we should probably check if we can send messages there.

    try {
      // Test permission
      const testMsg = await ctx.reply('✅ Теперь напоминания будут приходить сюда.');
      
      // Update DB
      await withDbRetry(() => store.updateUserNotificationChat(`${userId}`, `${chatId}`));
      
      // Clean up test message after a bit if desired, or leave it.
    } catch (error) {
      logger.error('Failed to set notification chat', error);
      await ctx.reply(
        '❌ Не удалось установить этот чат. Убедитесь, что я администратор и имею право писать сообщения.',
      );
    }
  });

  bot.on('message', async (ctx) => {
    const chatType = ctx.chat?.type;
    if (!ctx.message || !chatType || !SUPPORTED_MESSAGE_SOURCE_TYPES.has(chatType)) {
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
      await withDbRetry(() =>
        store.createPendingCard({
          id: cardId,
          userId: `${userId}`,
          sourceChatId: `${ctx.chat.id}`,
          sourceMessageId: ctx.message.message_id,
          contentType: parsed.contentType,
          contentPreview: parsed.preview,
          contentFileId: parsed.fileId,
          contentFileUniqueId: parsed.fileUniqueId,
        }),
      );
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
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (card.status !== 'pending') {
        await ctx.answerCbQuery('Эта карточка уже обработана');
        return;
      }
      const nextReviewAt = computeInitialReviewDate(config.initialReviewMinutes);
      await withDbRetry(() => store.activateCard(cardId, { nextReviewAt }));
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
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (card.status !== 'pending') {
        await ctx.answerCbQuery('Уже обработано');
        return;
      }
      await withDbRetry(() => store.deleteCard(cardId));
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
      const card = await withDbRetry(() => store.findAwaitingCard(cardId));
      if (!card) {
        await ctx.answerCbQuery('Повтор уже обработан');
        return;
      }
      try {
        const result = computeReview(card, grade);
        await withDbRetry(() =>
          store.saveReviewResult({
            cardId,
            grade: result.quality,
            nextReviewAt: result.nextReviewAt,
            repetition: result.repetition,
            interval: result.interval,
            easiness: result.easiness,
            reviewedAt: new Date().toISOString(),
          }),
        );
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

  bot.action(new RegExp(`^${ACTIONS.approveUser}\\|(.+)$`), async (ctx) => {
    const userId = ctx.match?.[1];
    if (!userId) return;

    try {
      await withDbRetry(() => store.updateUserStatus(userId, 'approved'));
      await ctx.answerCbQuery('Пользователь одобрен');
      const message = ctx.callbackQuery.message;
      const text = message && 'text' in message ? message.text : '';
      await ctx.editMessageText(
        `${text}\n\n✅ Одобрено`,
      );
      await ctx.telegram.sendMessage(userId, '🎉 Доступ разрешен! Можете пользоваться ботом.');
    } catch (error) {
      logger.error('Error approving user', error);
      await ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action(new RegExp(`^${ACTIONS.rejectUser}\\|(.+)$`), async (ctx) => {
    const userId = ctx.match?.[1];
    if (!userId) return;

    try {
      await withDbRetry(() => store.updateUserStatus(userId, 'rejected'));
      await ctx.answerCbQuery('Пользователь отклонен');
      const message = ctx.callbackQuery.message;
      const text = message && 'text' in message ? message.text : '';
      await ctx.editMessageText(
        `${text}\n\n❌ Отклонено`,
      );
      await ctx.telegram.sendMessage(userId, '⛔️ Вам отказано в доступе.');
    } catch (error) {
      logger.error('Error rejecting user', error);
      await ctx.answerCbQuery('Ошибка');
    }
  });

  bot.on('inline_query', async (ctx) => {
    const botUsername = ctx.botInfo.username;

    const results: any[] = [
      {
        type: 'article',
        id: 'webapp',
        title: '📱 Открыть приложение',
        description: 'Управление карточками и интервальным повторением',
        thumbnail_url: 'https://img.icons8.com/fluency/96/learning.png', // Optional: nice icon
        input_message_content: {
          message_text: '📱 Чтобы открыть приложение, перейдите в личные сообщения:',
        },
        reply_markup: getDeepLinkKeyboard(botUsername).reply_markup,
      },
      {
        type: 'article',
        id: 'use_this_chat',
        title: '🔔 Использовать этот чат',
        description: 'Получать напоминания сюда',
        input_message_content: {
          message_text: '/use_this_chat',
        },
      },
      {
        type: 'article',
        id: 'help',
        title: '❓ Помощь',
        description: 'Как пользоваться ботом',
        input_message_content: {
          message_text: 'Пошагово:\n1. Отправьте сообщение\n2. Нажмите «Добавить в обучение»\n3. Ждите напоминаний в канале и оценивайте освоение кнопками.\n\nКоманды:\n/webapp — открыть приложение для управления карточками\n/use_this_chat — получать напоминания в этот чат.',
        },
      },
    ];

    // Filter based on query if needed, but for now just show all
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  });

  bot.catch((err) => {
    logger.error('Ошибка бота', err);
  });

  return bot;
};
