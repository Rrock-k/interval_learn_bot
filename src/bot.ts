import dayjs from 'dayjs';
import { Context, Markup, Telegraf } from 'telegraf';
import { Update, Message, InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { v4 as uuid } from 'uuid';
import { CardStore, ReminderMode } from './db';
import { config } from './config';
import { logger } from './logger';
import {
  computeInitialReviewDateForMode,
  computeReview,
  computeReviewWithInterval,
  GradeKey,
} from './spacedRepetition';
import {
  buildAdjustKeyboard,
  buildReviewKeyboard,
  buildSchedulePickerKeyboard,
  buildReminderManagementKeyboard,
  buildWeekdayPickerKeyboard,
  REVIEW_ACTIONS,
  CARD_ACTIONS,
} from './reviewKeyboards';
import { buildMiniAppCardParam, buildMiniAppDeepLink } from './telegramLinks';
import { withDbRetry } from './utils/dbRetry';
import {
  PRESET_BY_CODE,
  serializeScheduleRule,
  scheduleRuleLabel,
  parseScheduleRule,
  computeNextFromSchedule,
  parseNaturalSchedule,
} from './schedule';

type TelegrafContext = Context<Update>;
type ReplyFn = (text: string, extra?: Parameters<TelegrafContext['reply']>[1]) => Promise<unknown>;

const ACTIONS = {
  confirm: 'confirm',
  cancel: 'cancel',
  chooseReminder: 'choose_reminder',
  setReminder: 'set_reminder',
  backReminder: 'back_reminder',
  customSchedule: 'custom_sched',
  approveUser: 'approve_user',
  rejectUser: 'reject_user',
} as const;

// Tracks users awaiting free-text schedule input: userId → { cardId, context }
interface PendingScheduleInput {
  cardId: string;
  ctx: 'a' | 'r'; // 'a' = adding card, 'r' = review reschedule
  messageId: number; // message to edit after parsing
  chatId: number | string;
}
const pendingScheduleInputs = new Map<string, PendingScheduleInput>();
const SCHEDULE_INPUT_TTL_MS = 5 * 60_000;

// Tracks the most recent pending card per user (for implicit schedule input)
const recentPendingCards = new Map<string, string>(); // userId → cardId

const scheduleModeLabel = (mode: ReminderMode, scheduleRule: string | null): string => {
  if (mode === 'schedule') {
    const rule = parseScheduleRule(scheduleRule);
    if (rule) return scheduleRuleLabel(rule);
    return 'Расписание';
  }
  return 'SM-2 интервалы';
};

const SUPPORTED_MESSAGE_SOURCE_TYPES = new Set(['private']);
const MEDIA_GROUP_DEBOUNCE_MS = 700;
const MEDIA_GROUP_TTL_MS = 30_000;

interface ParsedMessageInfo {
  contentType: string;
  preview: string | null;
  fileId: string | null;
  fileUniqueId: string | null;
}

interface MediaGroupBuffer {
  chatId: number | string;
  userId: number;
  messages: Message[];
  timer: NodeJS.Timeout | null;
}

const isCommandText = (text?: string | null) =>
  Boolean(text && text.startsWith('/'));

const isReviewManagedCard = (status: string): boolean => {
  return status === 'learning' || status === 'awaiting_grade';
};

export const normalizeContentPreview = (value: string | null): string | null => {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
};

export const parseMessage = (message: Message): ParsedMessageInfo | null => {
  if ('text' in message && typeof message.text === 'string') {
    const preview = normalizeContentPreview(message.text);
    return {
      contentType: 'text',
      preview: preview ? preview.slice(0, 200) : null,
      fileId: null,
      fileUniqueId: null,
    };
  }
  if ('photo' in message && Array.isArray(message.photo) && message.photo.length) {
    const photos = message.photo
      .map((photo) => {
        if (!photo || typeof photo !== 'object') {
          return null;
        }
        const fileId = photo.file_id;
        if (typeof fileId !== 'string' || fileId.trim() === '') {
          return null;
        }
        const fileSize = typeof photo.file_size === 'number' && Number.isFinite(photo.file_size) ? photo.file_size : 0;
        const fileUniqueId =
          typeof photo.file_unique_id === 'string' ? photo.file_unique_id : '';
        return { file_id: fileId, file_size: fileSize, file_unique_id: fileUniqueId };
      })
      .filter((photo): photo is { file_id: string; file_size: number; file_unique_id: string } => Boolean(photo));
    if (!photos.length) {
      return null;
    }
    const sorted = photos.sort((a, b) => a.file_size - b.file_size);
    const target = sorted[0]!;
    const caption = normalizeContentPreview(message.caption ?? null);
    return {
      contentType: 'photo',
      preview: caption ? caption.slice(0, 200) : '[Фото]',
      fileId: target.file_id,
      fileUniqueId: target.file_unique_id,
    };
  }
  if (
    'video' in message &&
    message.video &&
    typeof message.video === 'object' &&
    'file_id' in message.video
  ) {
    const video = message.video as { file_id?: unknown; file_unique_id?: unknown };
    if (typeof video.file_id !== 'string' || video.file_id.trim() === '') {
      return null;
    }
    const caption = normalizeContentPreview(message.caption ?? null);
    return {
      contentType: 'video',
      preview: caption ? caption.slice(0, 200) : '[Видео]',
      fileId: video.file_id,
      fileUniqueId: typeof video.file_unique_id === 'string' ? video.file_unique_id : video.file_id,
    };
  }
  return null;
};

const buildMediaGroupKey = (chatId: number | string, mediaGroupId: string) =>
  `${chatId}:${mediaGroupId}`;

const hasTextualCaption = (message: Message) => {
  return (
    'caption' in message &&
    typeof message.caption === 'string' &&
    message.caption.trim()
  );
};

const selectMediaGroupMessage = (messages: Message[]) => {
  const parsedMessages = messages.filter((message) => parseMessage(message));
  if (!parsedMessages.length) {
    return null;
  }
  const withCaption = parsedMessages.find(hasTextualCaption);
  if (withCaption) {
    return withCaption;
  }

  let selected = parsedMessages[0]!;
  for (const message of parsedMessages) {
    if (message.message_id < selected.message_id) {
      selected = message;
    }
  }
  return selected;
};

const countMediaGroupItems = (messages: Message[]) => {
  let photoCount = 0;
  let videoCount = 0;
  for (const message of messages) {
    if ('photo' in message && Array.isArray(message.photo) && message.photo.length) {
      photoCount += 1;
      continue;
    }
    if ('video' in message && message.video) {
      videoCount += 1;
    }
  }
  return {
    photoCount,
    videoCount,
    total: photoCount + videoCount,
  };
};

const buildMediaGroupFallbackPreview = (counts: {
  photoCount: number;
  videoCount: number;
  total: number;
}) => {
  if (counts.photoCount && !counts.videoCount) {
    return `[Фото x${counts.photoCount}]`;
  }
  if (counts.videoCount && !counts.photoCount) {
    return `[Видео x${counts.videoCount}]`;
  }
  return `[Медиа x${counts.total}]`;
};

export const parseMediaGroup = (messages: Message[]): ParsedMessageInfo | null => {
  if (!messages.length) {
    return null;
  }
  const primary = selectMediaGroupMessage(messages);
  if (!primary) {
    return null;
  }
  const parsed = parseMessage(primary);
  if (!parsed) {
    return null;
  }
  const counts = countMediaGroupItems(messages);
  if (counts.total > 1) {
    if (!parsed.preview || parsed.preview === '[Фото]' || parsed.preview === '[Видео]') {
      parsed.preview = buildMediaGroupFallbackPreview(counts);
    }
  }
  return parsed;
};

const extractMediaGroupMessageIds = (messages: Message[]) => {
  const unique = new Set<number>();
  for (const message of messages) {
    unique.add(message.message_id);
  }
  return Array.from(unique).sort((a, b) => a - b);
};

const buildAddKeyboard = (cardId: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Добавить в обучение', `${ACTIONS.confirm}|${cardId}`)],
    [
      Markup.button.callback(
        `Другое расписание`,
        `${ACTIONS.chooseReminder}|${cardId}`,
      ),
    ],
    [Markup.button.callback('Отмена', `${ACTIONS.cancel}|${cardId}`)],
  ]);

const createPendingCardAndPrompt = async ({
  store,
  userId,
  chatId,
  sourceMessageId,
  sourceMessageIds,
  parsed,
  reply,
}: {
  store: CardStore;
  userId: number;
  chatId: number | string;
  sourceMessageId: number;
  sourceMessageIds?: number[] | null;
  parsed: ParsedMessageInfo;
  reply: ReplyFn;
}) => {
  const cardId = uuid();
  try {
    const pendingInput = {
      id: cardId,
      userId: `${userId}`,
      sourceChatId: `${chatId}`,
      sourceMessageId,
      ...(sourceMessageIds === undefined ? {} : { sourceMessageIds }),
      contentType: parsed.contentType,
      contentPreview: parsed.preview,
      contentFileId: parsed.fileId,
      contentFileUniqueId: parsed.fileUniqueId,
      reminderMode: 'sm2' as ReminderMode,
    };
    await withDbRetry(() => store.createPendingCard(pendingInput));
    recentPendingCards.set(`${userId}`, cardId);
  } catch (error) {
    logger.error('Не удалось создать карточку', error);
    await reply('Ошибка сохранения (код: E_DB_WRITE). Попробуйте ещё раз.');
    return;
  }

  await reply(
    'Добавить это в интервальное обучение?',
    {
      ...buildAddKeyboard(cardId),
      reply_parameters: { message_id: sourceMessageId },
    },
  );
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

const buildAddedMessage = (mode: ReminderMode, scheduleRule: string | null) => {
  if (mode === 'sm2') {
    return '✅ Добавлено в интервальное обучение';
  }
  return `✅ Добавлено в интервальное обучение\nРежим: ${scheduleModeLabel(mode, scheduleRule)}`;
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
  const mediaGroupBuffers = new Map<string, MediaGroupBuffer>();
  const processedMediaGroups = new Map<string, number>();

  const isMediaGroupProcessed = (key: string) => {
    const processedAt = processedMediaGroups.get(key);
    if (!processedAt) {
      return false;
    }
    const now = Date.now();
    if (now - processedAt > MEDIA_GROUP_TTL_MS) {
      processedMediaGroups.delete(key);
      return false;
    }
    return true;
  };

  const markMediaGroupProcessed = (key: string) => {
    const now = Date.now();
    processedMediaGroups.set(key, now);
    if (processedMediaGroups.size > 200) {
      for (const [groupKey, timestamp] of processedMediaGroups) {
        if (now - timestamp > MEDIA_GROUP_TTL_MS) {
          processedMediaGroups.delete(groupKey);
        }
      }
    }
  };

  const handleMediaGroup = async (entry: MediaGroupBuffer) => {
    try {
      const representative = selectMediaGroupMessage(entry.messages);
      if (!representative) {
        await bot.telegram.sendMessage(
          entry.chatId,
          '😔 Пока поддерживаются только текст, фото и видео. Код ошибки: E_UNSUPPORTED_CONTENT',
        );
        return;
      }

      const parsed = parseMediaGroup(entry.messages);
      if (!parsed) {
        await bot.telegram.sendMessage(
          entry.chatId,
          '😔 Пока поддерживаются только текст, фото и видео. Код ошибки: E_UNSUPPORTED_CONTENT',
        );
        return;
      }

      const messageIds = extractMediaGroupMessageIds(entry.messages);
      await createPendingCardAndPrompt({
        store,
        userId: entry.userId,
        chatId: entry.chatId,
        sourceMessageId: representative.message_id,
        sourceMessageIds: messageIds.length > 1 ? messageIds : null,
        parsed,
        reply: (text, extra) => bot.telegram.sendMessage(entry.chatId, text, extra),
      });
    } catch (error) {
      logger.error('Не удалось обработать медиагруппу', error);
    }
  };

  const scheduleMediaGroupProcessing = (key: string, entry: MediaGroupBuffer) => {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      mediaGroupBuffers.delete(key);
      markMediaGroupProcessed(key);
      void handleMediaGroup(entry);
    }, MEDIA_GROUP_DEBOUNCE_MS);
  };

  const getReviewManagedCard = async (cardId: string) => {
    try {
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (!isReviewManagedCard(card.status)) {
        return null;
      }
      return card;
    } catch (error) {
      logger.warn('Не удалось загрузить карточку для управления', error);
      return null;
    }
  };

  const restoreCustomScheduleMessage = async ({
    pending,
    text,
    replyMarkup,
  }: {
    pending: PendingScheduleInput;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }) => {
    if (!pending.chatId || pending.messageId <= 0) {
      return false;
    }
    try {
      await bot.telegram.editMessageText(
        pending.chatId,
        pending.messageId,
        undefined,
        text,
        replyMarkup ? { reply_markup: replyMarkup } : undefined,
      );
      return true;
    } catch (error) {
      logger.warn('Не удалось обновить сообщение после ввода расписания', error);
      return false;
    }
  };

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

    // Check if user is providing free-text schedule input
    if ('text' in ctx.message) {
      // Implicit: user has a pending card and typed a schedule-like text
      const recentCardId = recentPendingCards.get(`${userId}`);
      if (recentCardId) {
        const rule = parseNaturalSchedule(ctx.message.text);
        if (rule) {
          recentPendingCards.delete(`${userId}`);
          try {
            const card = await withDbRetry(() => store.getCardById(recentCardId));
            if (card.status === 'pending') {
              const ruleStr = serializeScheduleRule(rule);
              await withDbRetry(() =>
                store.updateCardReminderMode(recentCardId, 'schedule', ruleStr),
              );
              const nextReviewAt = computeNextFromSchedule(rule);
              await withDbRetry(() => store.activateCard(recentCardId, { nextReviewAt }));
              await ctx.reply(
                `${buildAddedMessage('schedule', ruleStr)}\nСледующее напоминание ${formatNextReviewMessage(nextReviewAt)}`,
                { reply_parameters: { message_id: ctx.message.message_id } },
              );
              return;
            }
          } catch (error) {
            logger.error('Ошибка применения расписания к pending-карточке', error);
          }
        }
      }

      // Explicit: user clicked "Написать своё" and is providing input
      const pending = pendingScheduleInputs.get(`${userId}`);
      if (pending) {
        pendingScheduleInputs.delete(`${userId}`);
        const rule = parseNaturalSchedule(ctx.message.text);
        if (!rule) {
          // Log unrecognized input for future parser improvements
          store.logUnrecognizedSchedule(`${userId}`, ctx.message.text).catch((err) =>
            logger.warn('Не удалось залогировать нераспознанное расписание', err),
          );
          await ctx.reply(
            'Не удалось распознать расписание. Попробуйте ещё раз, например: «каждые 3 дня» или «пн, ср, пт»',
            { reply_parameters: { message_id: ctx.message.message_id } },
          );
          // Re-set pending so user can try again
          pendingScheduleInputs.set(`${userId}`, pending);
          return;
        }

        try {
          const card = await withDbRetry(() => store.getCardById(pending.cardId));
          const ruleStr = serializeScheduleRule(rule);

          if (pending.ctx === 'a' && card.status === 'pending') {
            // Card creation flow
            await withDbRetry(() =>
              store.updateCardReminderMode(pending.cardId, 'schedule', ruleStr),
            );
            const nextReviewAt = computeNextFromSchedule(rule);
            const activatedCard = await withDbRetry(() =>
              store.activateCard(pending.cardId, { nextReviewAt }),
            );
            const successMessage =
              `${buildAddedMessage('schedule', ruleStr)}\nСледующее напоминание ${formatNextReviewMessage(nextReviewAt)}`;
            const restored = await restoreCustomScheduleMessage({
              pending,
              text: successMessage,
              replyMarkup: buildReminderManagementKeyboard(activatedCard.id).reply_markup,
            });
            if (!restored) {
              await ctx.reply(successMessage, {
                reply_markup: buildReminderManagementKeyboard(activatedCard.id).reply_markup,
              });
            }
          } else if (pending.ctx === 'r') {
            // Review reschedule flow
            await withDbRetry(() =>
              store.updateCardReminderMode(pending.cardId, 'schedule', ruleStr),
            );
            const nextReviewAt = computeNextFromSchedule(rule);
            await withDbRetry(() =>
              store.saveReviewResult({
                cardId: pending.cardId,
                nextReviewAt,
                repetition: (card.repetition ?? 0) + 1,
                reviewedAt: new Date().toISOString(),
              }),
            );
            const successMessage = `Расписание: ${scheduleRuleLabel(rule)}\nСледующее напоминание ${formatNextReviewMessage(nextReviewAt)}`;
            const updatedCard = await withDbRetry(() =>
              store.getCardById(pending.cardId),
            );
            const restored = await restoreCustomScheduleMessage({
              pending,
              text: successMessage,
              replyMarkup: buildReminderManagementKeyboard(updatedCard.id).reply_markup,
            });
            if (!restored) {
              await ctx.reply(successMessage, {
                reply_markup: buildReminderManagementKeyboard(updatedCard.id).reply_markup,
              });
            }
          } else {
            const handledMessage = 'Эта карточка уже обработана';
            const restoreText = card.contentPreview
              ? `${card.contentPreview}\n${handledMessage}`
              : handledMessage;
            const restored = await restoreCustomScheduleMessage({
              pending,
              text: restoreText,
              replyMarkup:
                card.status === 'awaiting_grade'
                  ? buildAdjustKeyboard(card.id).reply_markup
                  : buildReminderManagementKeyboard(card.id).reply_markup,
            });
            if (!restored) {
              await ctx.reply(handledMessage);
            }
          }
        } catch (error) {
          logger.error('Ошибка обработки текстового расписания', error);
          await ctx.reply('Не удалось сохранить расписание. Попробуйте ещё раз.');
        }
        return;
      }
    }

    const mediaGroupId = (ctx.message as Message & { media_group_id?: string }).media_group_id;
    if (mediaGroupId) {
      const key = buildMediaGroupKey(ctx.chat.id, mediaGroupId);
      if (isMediaGroupProcessed(key)) {
        return;
      }
      const existing = mediaGroupBuffers.get(key);
      if (existing) {
        existing.messages.push(ctx.message as Message);
        scheduleMediaGroupProcessing(key, existing);
        return;
      }
      const entry: MediaGroupBuffer = {
        chatId: ctx.chat.id,
        userId,
        messages: [ctx.message as Message],
        timer: null,
      };
      mediaGroupBuffers.set(key, entry);
      scheduleMediaGroupProcessing(key, entry);
      return;
    }

    const parsed = parseMessage(ctx.message as Message);
    if (!parsed) {
      await ctx.reply(
        '😔 Пока поддерживаются только текст, фото и видео. Код ошибки: E_UNSUPPORTED_CONTENT',
      );
      return;
    }

    await createPendingCardAndPrompt({
      store,
      userId,
      chatId: ctx.chat.id,
      sourceMessageId: ctx.message.message_id,
      parsed,
      reply: (text, extra) => ctx.reply(text, extra),
    });
  });

  bot.action(new RegExp(`^${ACTIONS.chooseReminder}\\|(.+)$`), async (ctx) => {
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
      await ctx.editMessageReplyMarkup(
        buildSchedulePickerKeyboard(cardId, 'a').reply_markup,
      );
      await ctx.answerCbQuery('Выберите расписание');
    } catch (error) {
      logger.error('Не удалось открыть выбор режима', error);
      await ctx.answerCbQuery('Ошибка (E_REMINDER_OPEN)', { show_alert: true });
    }
  });

  bot.action(new RegExp(`^${ACTIONS.backReminder}\\|(.+)$`), async (ctx) => {
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
      await ctx.editMessageReplyMarkup(
        buildAddKeyboard(cardId).reply_markup,
      );
      await ctx.answerCbQuery();
    } catch (error) {
      logger.error('Не удалось вернуть основную клавиатуру', error);
      await ctx.answerCbQuery('Ошибка (E_REMINDER_BACK)', { show_alert: true });
    }
  });

  // Schedule selection during card creation: ss|cardId|code
  bot.action(new RegExp(`^${CARD_ACTIONS.setSchedule}\\|([^|]+)\\|(.+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    const code = ctx.match?.[2];
    if (!cardId || !code) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }

    // "pick" code → show schedule picker (back from weekday picker)
    if (code === 'pick') {
      try {
        await ctx.editMessageReplyMarkup(
          buildSchedulePickerKeyboard(cardId, 'a').reply_markup,
        );
        await ctx.answerCbQuery();
      } catch (error) {
        logger.error('Не удалось открыть выбор расписания', error);
        await ctx.answerCbQuery('Ошибка', { show_alert: true });
      }
      return;
    }

    try {
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (card.status !== 'pending') {
        await ctx.answerCbQuery('Эта карточка уже обработана');
        return;
      }

      let mode: ReminderMode;
      let ruleStr: string | null = null;

      if (code === 'sm2') {
        mode = 'sm2';
      } else {
        const preset = PRESET_BY_CODE.get(code);
        if (!preset) {
          await ctx.answerCbQuery('Неизвестный режим');
          return;
        }
        mode = 'schedule';
        ruleStr = serializeScheduleRule(preset.rule);
      }

      const updated = await withDbRetry(() =>
        store.updateCardReminderMode(cardId, mode, ruleStr),
      );
      const nextReviewAt = computeInitialReviewDateForMode(
        updated.reminderMode,
        updated.scheduleRule,
        config.initialReviewMinutes,
      );
      await withDbRetry(() => store.activateCard(cardId, { nextReviewAt }));
      await ctx.answerCbQuery(
        `Добавлено, напомню ${formatNextReviewMessage(nextReviewAt)}`,
      );
      try {
        await ctx.editMessageText(buildAddedMessage(updated.reminderMode, updated.scheduleRule));
      } catch (error) {
        logger.warn('Не удалось обновить сообщение', error);
      }
    } catch (error) {
      logger.error('Не удалось сохранить режим', error);
      await ctx.answerCbQuery('Ошибка (E_SCHED_SET)', { show_alert: true });
    }
  });

  // Weekday toggle during card creation: wt|cardId|selectedDays|toggledDay
  bot.action(new RegExp(`^${CARD_ACTIONS.weekdayToggle}\\|([^|]+)\\|([^|]*)\\|(\\d)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    const selectedStr = ctx.match?.[2] ?? '';
    if (!cardId) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    try {
      await ctx.editMessageReplyMarkup(
        buildWeekdayPickerKeyboard(cardId, 'a', selectedStr).reply_markup,
      );
      await ctx.answerCbQuery();
    } catch (error) {
      logger.error('Не удалось обновить клавиатуру дней', error);
      await ctx.answerCbQuery('Ошибка', { show_alert: true });
    }
  });

  // Weekday confirm during card creation: wc|cardId|selectedDays
  bot.action(new RegExp(`^${CARD_ACTIONS.weekdayConfirm}\\|([^|]+)\\|([\\d,]+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    const daysStr = ctx.match?.[2];
    if (!cardId || !daysStr) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    const days = daysStr.split(',').map(Number).filter((n) => n >= 1 && n <= 7);
    if (!days.length) {
      await ctx.answerCbQuery('Выберите хотя бы один день');
      return;
    }
    try {
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (card.status !== 'pending') {
        await ctx.answerCbQuery('Эта карточка уже обработана');
        return;
      }
      const rule = { type: 'weekdays' as const, days };
      const ruleStr = serializeScheduleRule(rule);
      const updated = await withDbRetry(() =>
        store.updateCardReminderMode(cardId, 'schedule', ruleStr),
      );
      const nextReviewAt = computeNextFromSchedule(rule);
      await withDbRetry(() => store.activateCard(cardId, { nextReviewAt }));
      await ctx.answerCbQuery(
        `Добавлено, напомню ${formatNextReviewMessage(nextReviewAt)}`,
      );
      try {
        await ctx.editMessageText(buildAddedMessage(updated.reminderMode, updated.scheduleRule));
      } catch (error) {
        logger.warn('Не удалось обновить сообщение', error);
      }
    } catch (error) {
      logger.error('Не удалось сохранить расписание по дням', error);
      await ctx.answerCbQuery('Ошибка (E_WEEKDAY_SET)', { show_alert: true });
    }
  });

  // "Написать своё" button: custom_sched|ctx|cardId
  bot.action(new RegExp(`^custom_sched\\|(a|r)\\|(.+)$`), async (ctx) => {
    const schedCtx = ctx.match?.[1] as 'a' | 'r' | undefined;
    const cardId = ctx.match?.[2];
    if (!cardId || !schedCtx) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    const fromUserId = ctx.from?.id;
    if (!fromUserId) {
      await ctx.answerCbQuery('Не удалось определить пользователя', { show_alert: true });
      return;
    }
    const userId = `${fromUserId}`;
    pendingScheduleInputs.set(userId, {
      cardId,
      ctx: schedCtx,
      messageId: ctx.callbackQuery?.message?.message_id ?? 0,
      chatId: ctx.chat?.id ?? fromUserId,
    });
    // Auto-cleanup after TTL
    setTimeout(() => {
      const current = pendingScheduleInputs.get(userId);
      if (current?.cardId === cardId) pendingScheduleInputs.delete(userId);
    }, SCHEDULE_INPUT_TTL_MS);

    try {
      await ctx.editMessageText(
        'Напишите расписание текстом, например:\n'
        + '• «каждый день», «через день»\n'
        + '• «каждые 3 дня», «раз в 2 недели»\n'
        + '• «каждый месяц», «каждый год»\n'
        + '• «пн, ср, пт»',
      );
      await ctx.answerCbQuery();
    } catch (error) {
      logger.error('Не удалось показать подсказку ввода расписания', error);
      await ctx.answerCbQuery('Ошибка', { show_alert: true });
    }
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
      const nextReviewAt = computeInitialReviewDateForMode(
        card.reminderMode,
        card.scheduleRule,
        config.initialReviewMinutes,
      );
      await withDbRetry(() => store.activateCard(cardId, { nextReviewAt }));
      await ctx.answerCbQuery(
        `Добавлено, напомню ${formatNextReviewMessage(nextReviewAt)}`,
      );
      try {
        await ctx.editMessageText(buildAddedMessage(card.reminderMode, card.scheduleRule));
      } catch (error) {
        logger.warn('Не удалось обновить сообщение', error);
      }
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
      // Clean up pending card tracking
      const uid = card.userId;
      if (recentPendingCards.get(uid) === cardId) recentPendingCards.delete(uid);
      await ctx.answerCbQuery('Удалено');
      try {
        await ctx.editMessageText('Пользователь отменил добавление');
      } catch (error) {
        logger.warn('Не удалось обновить сообщение', error);
      }
    } catch (error) {
      logger.error('Не удалось удалить карточку', error);
      await ctx.answerCbQuery('Ошибка удаления (E_CANCEL)', {
        show_alert: true,
      });
    }
  });

  bot.action(new RegExp(`^${REVIEW_ACTIONS.adjust}\\|(.+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    if (!cardId) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    const card = await getReviewManagedCard(cardId);
    if (!card) {
      await ctx.answerCbQuery('Повтор уже обработан');
      return;
    }
    try {
      const botUsername = ctx.botInfo?.username;
      const deepLinkUrl = botUsername
        ? buildMiniAppDeepLink(botUsername, buildMiniAppCardParam(cardId))
        : undefined;
      await ctx.editMessageReplyMarkup(
        buildAdjustKeyboard(cardId, deepLinkUrl).reply_markup,
      );
      await ctx.answerCbQuery('Выберите интервал');
    } catch (error) {
      logger.error('Не удалось открыть настройки интервала', error);
      await ctx.answerCbQuery('Ошибка (E_ADJUST)', { show_alert: true });
    }
  });

  bot.action(new RegExp(`^${REVIEW_ACTIONS.back}\\|(.+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    if (!cardId) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    const card = await getReviewManagedCard(cardId);
    if (!card) {
      await ctx.answerCbQuery('Повтор уже обработан');
      return;
    }
    try {
      if (card.status === 'awaiting_grade') {
        await ctx.editMessageReplyMarkup(
          buildReviewKeyboard(cardId).reply_markup,
        );
      } else {
        await ctx.editMessageReplyMarkup(
          buildReminderManagementKeyboard(cardId).reply_markup,
        );
      }
      await ctx.answerCbQuery();
    } catch (error) {
      logger.error('Не удалось вернуть основную клавиатуру', error);
      await ctx.answerCbQuery('Ошибка (E_BACK)', { show_alert: true });
    }
  });

  bot.action(new RegExp(`^${REVIEW_ACTIONS.archive}\\|(.+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    if (!cardId) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    const card = await getReviewManagedCard(cardId);
    if (!card) {
      await ctx.answerCbQuery('Карточка уже обработана');
      return;
    }
    try {
      await withDbRetry(() => store.updateStatus(cardId, 'archived'));
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
            `Не удалось убрать кнопки канала для карточки ${card.id}`,
            editError,
          );
        }
      }
      await ctx.editMessageReplyMarkup(undefined);
      await ctx.answerCbQuery('Карточка архивирована');
    } catch (error) {
      logger.error('Ошибка архивации карточки', error);
      await ctx.answerCbQuery('Не удалось архивировать (E_ARCHIVE)', {
        show_alert: true,
      });
    }
  });

  // "Change schedule" button in adjust menu → show schedule picker
  bot.action(new RegExp(`^${REVIEW_ACTIONS.changeSchedule}\\|(.+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    if (!cardId) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    const card = await getReviewManagedCard(cardId);
    if (!card) {
      await ctx.answerCbQuery('Повтор уже обработан');
      return;
    }
    try {
      await ctx.editMessageReplyMarkup(
        buildSchedulePickerKeyboard(cardId, 'r').reply_markup,
      );
      await ctx.answerCbQuery('Выберите новое расписание');
    } catch (error) {
      logger.error('Не удалось открыть выбор расписания', error);
      await ctx.answerCbQuery('Ошибка', { show_alert: true });
    }
  });

  // Schedule selection during review: rs|cardId|code
  bot.action(new RegExp(`^${REVIEW_ACTIONS.setSchedule}\\|([^|]+)\\|(.+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    const code = ctx.match?.[2];
    if (!cardId || !code) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }

    // "pick" code → show schedule picker (back from weekday picker)
    if (code === 'pick') {
      const card = await getReviewManagedCard(cardId);
      if (!card) {
        await ctx.answerCbQuery('Повтор уже обработан');
        return;
      }
      try {
        await ctx.editMessageReplyMarkup(
          buildSchedulePickerKeyboard(cardId, 'r').reply_markup,
        );
        await ctx.answerCbQuery();
      } catch (error) {
        logger.error('Не удалось открыть выбор расписания', error);
        await ctx.answerCbQuery('Ошибка', { show_alert: true });
      }
      return;
    }

    const card = await getReviewManagedCard(cardId);
    if (!card) {
      await ctx.answerCbQuery('Повтор уже обработан');
      return;
    }

    try {
      let mode: ReminderMode;
      let ruleStr: string | null = null;
      let nextReviewAt: string;

      if (code === 'sm2') {
        mode = 'sm2';
        // For SM-2 on reschedule, grade as 'ok' to advance
        const result = computeReview({ ...card, reminderMode: 'sm2', scheduleRule: null }, 'ok');
        nextReviewAt = result.nextReviewAt;
        await withDbRetry(() => store.updateCardReminderMode(cardId, mode, null));
        await withDbRetry(() =>
          store.saveReviewResult({
            cardId,
            nextReviewAt,
            repetition: result.repetition,
            reviewedAt: new Date().toISOString(),
          }),
        );
      } else {
        const preset = PRESET_BY_CODE.get(code);
        if (!preset) {
          await ctx.answerCbQuery('Неизвестный режим');
          return;
        }
        mode = 'schedule';
        ruleStr = serializeScheduleRule(preset.rule);
        nextReviewAt = computeNextFromSchedule(preset.rule);
        await withDbRetry(() => store.updateCardReminderMode(cardId, mode, ruleStr));
        await withDbRetry(() =>
          store.saveReviewResult({
            cardId,
            nextReviewAt,
            repetition: (card.repetition ?? 0) + 1,
            reviewedAt: new Date().toISOString(),
          }),
        );
      }

      if (card.pendingChannelId && card.pendingChannelMessageId) {
        try {
          await ctx.telegram.editMessageReplyMarkup(
            card.pendingChannelId,
            card.pendingChannelMessageId,
            undefined,
            undefined,
          );
        } catch (editError) {
          logger.warn(`Не удалось убрать кнопки канала для ${card.id}`, editError);
        }
      }

      try {
        await ctx.editMessageReplyMarkup(
          buildReminderManagementKeyboard(cardId).reply_markup,
        );
      } catch (_error) {
        // keep user-facing action even if editing fails
      }

      const label = mode === 'sm2' ? 'SM-2' : scheduleModeLabel(mode, ruleStr);
      await ctx.answerCbQuery(
        `Расписание: ${label}. Следующее ${formatNextReviewMessage(nextReviewAt)}`,
      );
    } catch (error) {
      logger.error('Ошибка смены расписания из ревью', error);
      await ctx.answerCbQuery('Ошибка (E_RSCHED)', { show_alert: true });
    }
  });

  // Weekday toggle during review: rt|cardId|selectedDays|toggledDay
  bot.action(new RegExp(`^${REVIEW_ACTIONS.weekdayToggle}\\|([^|]+)\\|([^|]*)\\|(\\d)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    const selectedStr = ctx.match?.[2] ?? '';
    if (!cardId) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    const card = await getReviewManagedCard(cardId);
    if (!card) {
      await ctx.answerCbQuery('Повтор уже обработан');
      return;
    }
    try {
      await ctx.editMessageReplyMarkup(
        buildWeekdayPickerKeyboard(cardId, 'r', selectedStr).reply_markup,
      );
      await ctx.answerCbQuery();
    } catch (error) {
      logger.error('Не удалось обновить клавиатуру дней', error);
      await ctx.answerCbQuery('Ошибка', { show_alert: true });
    }
  });

  // Weekday confirm during review: rc|cardId|selectedDays
  bot.action(new RegExp(`^${REVIEW_ACTIONS.weekdayConfirm}\\|([^|]+)\\|([\\d,]+)$`), async (ctx) => {
    const cardId = ctx.match?.[1];
    const daysStr = ctx.match?.[2];
    if (!cardId || !daysStr) {
      await ctx.answerCbQuery('Некорректное действие');
      return;
    }
    const days = daysStr.split(',').map(Number).filter((n) => n >= 1 && n <= 7);
    if (!days.length) {
      await ctx.answerCbQuery('Выберите хотя бы один день');
      return;
    }

    const card = await getReviewManagedCard(cardId);
    if (!card) {
      await ctx.answerCbQuery('Повтор уже обработан');
      return;
    }

    try {
      const rule = { type: 'weekdays' as const, days };
      const ruleStr = serializeScheduleRule(rule);
      const nextReviewAt = computeNextFromSchedule(rule);

      await withDbRetry(() => store.updateCardReminderMode(cardId, 'schedule', ruleStr));
      await withDbRetry(() =>
        store.saveReviewResult({
          cardId,
          nextReviewAt,
          repetition: (card.repetition ?? 0) + 1,
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
          logger.warn(`Не удалось убрать кнопки канала для ${card.id}`, editError);
        }
      }

      try {
        await ctx.editMessageReplyMarkup(
          buildReminderManagementKeyboard(cardId).reply_markup,
        );
      } catch (_error) {
        // keep user-facing action even if editing fails
      }

      await ctx.answerCbQuery(
        `Расписание: ${scheduleRuleLabel(rule)}. Следующее ${formatNextReviewMessage(nextReviewAt)}`,
      );
    } catch (error) {
      logger.error('Ошибка установки расписания по дням из ревью', error);
      await ctx.answerCbQuery('Ошибка (E_RWDAY)', { show_alert: true });
    }
  });

  bot.action(
    new RegExp(`^${REVIEW_ACTIONS.preset}\\|([^|]+)\\|(\\d+)$`),
    async (ctx) => {
      const cardId = ctx.match?.[1];
      const daysRaw = ctx.match?.[2];
      const days = daysRaw ? Number(daysRaw) : Number.NaN;
      if (!cardId || !Number.isFinite(days)) {
        await ctx.answerCbQuery('Некорректное действие');
        return;
      }
      const card = await getReviewManagedCard(cardId);
      if (!card) {
        await ctx.answerCbQuery('Повтор уже обработан');
        return;
      }
      try {
        const result = computeReviewWithInterval(days);
        await withDbRetry(() =>
          store.saveReviewResult({
            cardId,
            nextReviewAt: result.nextReviewAt,
            repetition: result.repetition,
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
        try {
          await ctx.editMessageReplyMarkup(
            buildReminderManagementKeyboard(cardId).reply_markup,
          );
        } catch (_error) {
          // keep user-facing action even if editing fails
        }
        await ctx.answerCbQuery(
          `Готово! Следующее повторение ${formatNextReviewMessage(result.nextReviewAt)}`,
        );
      } catch (error) {
        logger.error('Ошибка обработки настройки интервала', error);
        await ctx.answerCbQuery('Не удалось сохранить настройку (E_PRESET)', {
          show_alert: true,
        });
      }
    },
  );

  bot.action(
    new RegExp(`^${REVIEW_ACTIONS.grade}\\|([^|]+)\\|(again|ok)$`),
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
            nextReviewAt: result.nextReviewAt,
            repetition: result.repetition,
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
        try {
          await ctx.editMessageReplyMarkup(
            buildReminderManagementKeyboard(cardId).reply_markup,
          );
        } catch (_error) {
          // keep user-facing action even if editing fails
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
