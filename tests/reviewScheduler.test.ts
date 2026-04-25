import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ReviewScheduler } from '../src/reviewScheduler';
import { CardRecord } from '../src/db';

type SendMessageArgs = [string | number, string, Record<string, unknown> | undefined];
type TelegramReply = { message_id: number; reply_to_message?: unknown };
type TelegramSendMessage = (chatId: string | number, text: string, extra?: Record<string, unknown>) => Promise<TelegramReply>;
type TelegramCopyMessage = (chatId: string | number, fromChatId: string | number, messageId: number) => Promise<{ message_id: number }>;
type TelegramCopyMessages = (chatId: string | number, fromChatId: string | number, messageIds: number[]) => Promise<{ message_id: number }[]>;

type MockStoreCalls = {
  getUser: Array<string>;
  getCardById: Array<string>;
  setBaseChannelMessage: Array<[string, number | null]>;
  clearAwaitingGrade: Array<string>;
  markAwaitingGrade: unknown[];
  recordNotification: unknown[];
  rescheduleCard: unknown[];
};

type MockStore = ReturnType<typeof createStore>;

const createStore = (params: {
  userNotificationChatId?: string | null;
  cardById?: CardRecord;
} = {}) => {
  const calls: MockStoreCalls = {
    getUser: [],
    getCardById: [],
    setBaseChannelMessage: [],
    clearAwaitingGrade: [],
    markAwaitingGrade: [],
    recordNotification: [],
    rescheduleCard: [],
  };

  const notificationChatId = params.userNotificationChatId ?? '-1000000000001';
  const cardById = params.cardById;

  return {
    calls,
    mock: {
      getUser: async (userId: string) => {
        calls.getUser.push(userId);
        return {
          status: 'approved' as const,
          notificationChatId,
        };
      },
      getCardById: async (id: string) => {
        calls.getCardById.push(id);
        if (!cardById) {
          throw new Error(`Card ${id} not found`);
        }
        return cardById;
      },
      clearAwaitingGrade: async (id: string) => {
        calls.clearAwaitingGrade.push(id);
      },
      setBaseChannelMessage: async (id: string, messageId: number | null) => {
        calls.setBaseChannelMessage.push([id, messageId]);
      },
      markAwaitingGrade: async (input: unknown) => {
        calls.markAwaitingGrade.push(input);
      },
      recordNotification: async (input: unknown) => {
        calls.recordNotification.push(input);
      },
      rescheduleCard: async (id: string) => {
        calls.rescheduleCard.push(id);
      },
      clearPending: async () => {},
      createPendingCard: async () => { throw new Error('not implemented'); },
      deleteCard: async () => {},
      listAllCards: async () => [],
      listDueCards: async () => [],
      listExpiredAwaitingCards: async () => [],
      setReminderMode: async () => ({}),
      activateCard: async () => ({}),
      updateNextReview: async () => ({}),
      archiveCard: async () => ({}),
      unarchiveCard: async () => ({}),
      reviewCard: async () => ({}),
      updateCardReminderMode: async () => ({}),
      resetUserBaseMessages: async () => {},
      updateUserNotificationChat: async () => {},
      getUserByUsername: async () => null,
      listCards: async () => [],
      getUsers: async () => [],
      logUnrecognizedSchedule: async () => {},
    } as const,
  };
};

type MockTelegramCalls = {
  sendMessage: SendMessageArgs[];
  copyMessage: Array<[string | number, string | number, number]>;
  copyMessages: Array<[string | number, string | number, number[]]>;
  sendPhoto: Array<[string | number, string, { caption?: string }] >;
  sendVideo: Array<[string | number, string, { caption?: string }] >;
  editMessageReplyMarkup: unknown[];
};

type MockTelegram = ReturnType<typeof createTelegram>;

const createTelegram = (handlers: {
  sendMessage?: TelegramSendMessage;
  copyMessage?: TelegramCopyMessage;
  copyMessages?: TelegramCopyMessages;
  sendPhoto?: (chatId: string | number, fileId: string, options?: { caption?: string }) => Promise<TelegramReply>;
  sendVideo?: (chatId: string | number, fileId: string, options?: { caption?: string }) => Promise<TelegramReply>;
}) => {
  const calls: MockTelegramCalls = {
    sendMessage: [],
    copyMessage: [],
    copyMessages: [],
    sendPhoto: [],
    sendVideo: [],
    editMessageReplyMarkup: [],
  };

  let messageCounter = 1000;
  const defaultSendMessage: TelegramSendMessage = async (_chatId, _text, extra) => {
    const messageId = ++messageCounter;
    return {
      message_id: messageId,
      ...(extra?.reply_parameters ? { reply_to_message: { message_id: (extra.reply_parameters as { message_id: number }).message_id } } : {}),
    };
  };

  const telegram = {
    sendMessage: async (chatId: string | number, text: string, extra?: Record<string, unknown>) => {
      calls.sendMessage.push([chatId, text, extra]);
      const sender = handlers.sendMessage ?? defaultSendMessage;
      return sender(chatId, text, extra);
    },
    copyMessage: async (chatId: string | number, fromChatId: string | number, messageId: number) => {
      calls.copyMessage.push([chatId, fromChatId, messageId]);
      const sender = handlers.copyMessage ?? (async () => ({ message_id: 555 }));
      return sender(chatId, fromChatId, messageId);
    },
    copyMessages: async (chatId: string | number, fromChatId: string | number, messageIds: number[]) => {
      calls.copyMessages.push([chatId, fromChatId, messageIds]);
      const sender = handlers.copyMessages ?? (async () => [{ message_id: 556 }]);
      return sender(chatId, fromChatId, messageIds);
    },
    sendPhoto: async (chatId: string | number, fileId: string, options?: { caption?: string }) => {
      calls.sendPhoto.push([chatId, fileId, options ?? {}]);
      if (handlers.sendPhoto) {
        return handlers.sendPhoto(chatId, fileId, options);
      }
      return { message_id: ++messageCounter, reply_to_message: undefined };
    },
    sendVideo: async (chatId: string | number, fileId: string, options?: { caption?: string }) => {
      calls.sendVideo.push([chatId, fileId, options ?? {}]);
      if (handlers.sendVideo) {
        return handlers.sendVideo(chatId, fileId, options);
      }
      return { message_id: ++messageCounter, reply_to_message: undefined };
    },
    editMessageText: async () => {},
    editMessageCaption: async () => {},
    editMessageReplyMarkup: async () => {},
    deleteMessage: async () => {},
  };

  return { calls, mock: { telegram } as any };
};

const createCard = (overrides: Partial<CardRecord> = {}): CardRecord => ({
  id: 'card-test',
  userId: '111',
  sourceChatId: '-100111',
  sourceMessageId: 11,
  sourceMessageIds: null,
  contentType: 'text',
  contentPreview: 'Тестовый текст',
  contentFileId: null,
  contentFileUniqueId: null,
  reminderMode: 'sm2',
  scheduleRule: null,
  status: 'learning',
  repetition: 0,
  nextReviewAt: null,
  lastReviewedAt: null,
  pendingChannelId: null,
  pendingChannelMessageId: null,
  baseChannelMessageId: null,
  awaitingGradeSince: null,
  lastNotificationAt: null,
  lastNotificationReason: null,
  lastNotificationMessageId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

test('sendCardToChannel отправляет reminder через reply с запретом безответной отправки', async () => {
  const store = createStore({ userNotificationChatId: '-100555' });
  const telegram = createTelegram({});

  const card = createCard({ baseChannelMessageId: null });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendCardToChannel(card, 'manual_now');

  assert.equal(telegram.calls.sendMessage.length, 1);
  const [chatId, text, extra] = telegram.calls.sendMessage[0] as SendMessageArgs;
  assert.equal(chatId, '-100555');
  assert.equal(text, '🔔 Время повторить запись');
  assert.equal(extra?.reply_parameters?.message_id, card.baseChannelMessageId);
  assert.equal(extra?.reply_parameters?.allow_sending_without_reply, false);
  assert.equal(store.calls.markAwaitingGrade.length, 1);
  assert.equal(store.calls.recordNotification.length, 1);
  assert.equal(store.calls.rescheduleCard.length, 0);
});

test('sendCardToChannel fallback на non-reply если target не найден (нет replied message)', async () => {
  const store = createStore({});
  const telegram = createTelegram({
    sendMessage: async (_chatId, text, extra) => {
      if (extra?.reply_parameters) {
        return { message_id: 201 };
      }
      return { message_id: 202, reply_to_message: { message_id: 11 } };
    },
  });

  const card = createCard({ baseChannelMessageId: null });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);
  await (scheduler as any).sendCardToChannel(card, 'manual_now');

  assert.equal(telegram.calls.sendMessage.length, 2);
  const [replyCall, detachedCall] = telegram.calls.sendMessage;
  assert.equal(replyCall[2]?.reply_parameters?.message_id, 555);
  assert.equal(detachedCall[2]?.reply_parameters, undefined);
  assert.equal(store.calls.markAwaitingGrade.length, 1);
});

test('sendCardToChannel копирует сообщения из медиагруппы через copyMessages', async () => {
  const store = createStore({});
  const telegram = createTelegram({
    copyMessages: async () => [
      { message_id: 600 },
      { message_id: 601 },
    ],
  });

  const card = createCard({
    baseChannelMessageId: null,
    sourceMessageIds: [11, 11, 15],
    contentType: 'photo',
    contentFileId: null,
    contentFileUniqueId: null,
    contentPreview: '[Фото x2]',
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);
  await (scheduler as any).sendCardToChannel(card, 'manual_now');

  assert.equal(telegram.calls.copyMessages.length, 1);
  assert.deepEqual(telegram.calls.copyMessages[0]?.[2], [11, 15]);
  assert.equal(store.calls.setBaseChannelMessage[0][1], 601);
  assert.equal(store.calls.markAwaitingGrade.length, 1);
  assert.equal(store.calls.rescheduleCard.length, 0);
});

test('sendCardToChannel: пустой ответ copyMessages ведёт к fallback на сохранённую базу', async () => {
  const store = createStore({});
  const telegram = createTelegram({
    copyMessages: async () => [],
    sendMessage: async (_chatId, text, extra) => {
      if (extra?.reply_parameters) {
        return { message_id: 502, reply_to_message: { message_id: 1 } };
      }
      return { message_id: 501 };
    },
  });

  const card = createCard({
    baseChannelMessageId: null,
    sourceMessageIds: [11, 12],
    contentType: 'photo',
    contentPreview: 'Photo preview',
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);
  await (scheduler as any).sendCardToChannel(card, 'manual_now');

  assert.equal(telegram.calls.copyMessage.length, 0);
  assert.equal(telegram.calls.copyMessages.length, 1);
  assert.equal(telegram.calls.sendMessage.length, 2);
  assert.equal(store.calls.setBaseChannelMessage[0][1], 501);
  assert.equal(store.calls.markAwaitingGrade.length, 1);
});

test('sendCardToChannel: источник с одним валидным sourceMessageId идёт через copyMessage', async () => {
  const store = createStore({});
  const telegram = createTelegram({
    sendMessage: async (_chatId, _text, extra) => {
      if (extra?.reply_parameters) {
        return { message_id: 802, reply_to_message: { message_id: 1 } };
      }
      return { message_id: 803 };
    },
  });

  const card = createCard({
    baseChannelMessageId: null,
    sourceMessageIds: [11, Number.NaN as unknown as number, Number.POSITIVE_INFINITY as unknown as number],
    contentType: 'text',
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);
  await (scheduler as any).sendCardToChannel(card, 'manual_now');

  assert.equal(telegram.calls.copyMessages.length, 0);
  assert.equal(telegram.calls.copyMessage.length, 1);
  assert.equal(telegram.calls.copyMessage[0]?.[2], 11);
});

test('sendCardToChannel: если базовое сообщение удалено, пересоздаёт его и сохраняет новый ID', async () => {
  const store = createStore({});
  const telegram = createTelegram({
    copyMessage: async () => ({ message_id: 602 }),
    sendMessage: async (_chatId, _text, extra) => {
      if (extra?.reply_parameters?.message_id === 11) {
        return { message_id: 701 };
      }
      return { message_id: 702, reply_to_message: { message_id: 602 } };
    },
  });

  const card = createCard({ baseChannelMessageId: 11 });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);
  await (scheduler as any).sendCardToChannel(card, 'manual_now');

  assert.equal(telegram.calls.copyMessage.length, 1);
  assert.equal(store.calls.setBaseChannelMessage[0][1], null);
  assert.equal(store.calls.setBaseChannelMessage[1][1], 602);
  assert.equal(telegram.calls.sendMessage.length, 2);
});

test('sendCardToChannel: copyMessages с некорректным message_id проваливается в fallback сохранённой базы', async () => {
  const store = createStore({});
  const telegram = createTelegram({
    copyMessages: async () => [{ message_id: undefined as unknown as number }],
    sendMessage: async (_chatId, _text, extra) => {
      if (extra?.reply_parameters) {
        return { message_id: 902, reply_to_message: { message_id: 1 } };
      }
      return { message_id: 901 };
    },
  });

  const card = createCard({
    baseChannelMessageId: null,
    sourceMessageIds: [11, 12],
    contentType: 'photo',
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);
  await (scheduler as any).sendCardToChannel(card, 'manual_now');

  assert.equal(telegram.calls.copyMessage.length, 0);
  assert.equal(telegram.calls.copyMessages.length, 1);
  assert.equal(telegram.calls.sendMessage.length, 2);
  assert.equal(store.calls.setBaseChannelMessage[0][1], 901);
});

test('sendCardToChannel fallback на сохранённую базу при невалидном исходнике', async () => {
  const store = createStore({});
  const telegram = createTelegram({
    copyMessage: async () => {
      throw new Error('cannot copy');
    },
    sendMessage: async (_chatId, text, extra) => {
      if (extra?.reply_parameters) {
        return { message_id: 402, reply_to_message: { message_id: 401 } };
      }
      return { message_id: 401 };
    },
  });

  const card = createCard({ baseChannelMessageId: null, contentPreview: 'Preview text' });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);
  await (scheduler as any).sendCardToChannel(card, 'manual_now');

  assert.equal(telegram.calls.copyMessage.length, 1);
  assert.equal(store.calls.setBaseChannelMessage.length, 1);
  assert.equal(store.calls.setBaseChannelMessage[0][1], 401);
  assert.equal(store.calls.markAwaitingGrade.length, 1);
  assert.equal(store.calls.rescheduleCard.length, 0);
});

test('sendCardToChannel уведомляет и рескедулит при полном фейле', async () => {
  const store = createStore({});
  let sendCount = 0;
  const telegram = createTelegram({
    copyMessage: async () => {
      throw new Error('copy failed');
    },
    sendMessage: async (_chatId, text, extra) => {
      sendCount += 1;
      if (sendCount === 1) {
        throw new Error('cannot send base text');
      }
      return { message_id: 500, ...(extra?.reply_parameters ? { reply_to_message: { message_id: 1 } } : {}) };
    },
  });

  const card = createCard({ id: 'critical-1', baseChannelMessageId: null, contentPreview: 'text' });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);
  await (scheduler as any).sendCardToChannel(card, 'scheduled');

  assert.equal(telegram.calls.sendMessage.length, 2);
  const warningMessage = telegram.calls.sendMessage[1]?.[1] || '';
  assert.ok(warningMessage.includes('critical-1'));
  assert.equal(store.calls.rescheduleCard.length, 1);
  assert.equal(store.calls.rescheduleCard[0], card.id);
  assert.equal(store.calls.markAwaitingGrade.length, 0);
});

test('isMissingReplyTarget распознаёт вложенное описание ошибки Telegram', () => {
  const store = createStore({});
  const telegram = createTelegram({});
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  assert.equal(
    (scheduler as any).isMissingReplyTarget({ response: { description: 'Bad Request: message to reply not found' } }),
    true,
  );
  assert.equal(
    (scheduler as any).isMissingReplyTarget({ message: 'Bad Request: something else' }),
    false,
  );
});
