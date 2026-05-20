import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CardRecord, ReminderJobRecord } from '../src/db';
import { ReviewScheduler } from '../src/reviewScheduler';

type SendMessageArgs = [string | number, string, Record<string, unknown> | undefined];
type TelegramReply = { message_id: number; reply_to_message?: { message_id?: number; chat?: { id?: string | number } } };
type CallApiPayload = {
  chat_id: string | number;
  text: string;
  reply_markup?: unknown;
  reply_to_message_id?: number;
  allow_sending_without_reply?: boolean;
};

type MockStoreCalls = {
  getUser: string[];
  getCardById: string[];
  markReminderJobSending: string[];
  setBaseChannelMessage: Array<[string, number | null]>;
  markAwaitingGrade: unknown[];
  recordNotification: unknown[];
  failReminderJob: Array<[string, string]>;
  createReminderJob: unknown[];
};

const createCard = (overrides: Partial<CardRecord> = {}): CardRecord => ({
  id: 'card-test',
  userId: '111',
  queueScopeType: 'user',
  queueScopeId: '111',
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

const createJob = (
  card: CardRecord,
  overrides: Partial<ReminderJobRecord> = {},
): ReminderJobRecord => {
  const now = new Date().toISOString();
  return {
    id: 'job-test',
    cardId: card.id,
    userId: card.userId,
    queueScopeType: card.queueScopeType,
    queueScopeId: card.queueScopeId,
    kind: 'manual_now',
    source: 'manual_now',
    status: 'pending',
    dueAt: now,
    scheduledAt: now,
    sentAt: null,
    completedAt: null,
    deliveryChatId: null,
    deliveryMessageId: null,
    baseMessageId: null,
    snoozedFromJobId: null,
    error: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

const createStore = (params: {
  userNotificationChatId?: string | null;
  cardById?: CardRecord;
} = {}) => {
  const calls: MockStoreCalls = {
    getUser: [],
    getCardById: [],
    markReminderJobSending: [],
    setBaseChannelMessage: [],
    markAwaitingGrade: [],
    recordNotification: [],
    failReminderJob: [],
    createReminderJob: [],
  };
  const notificationChatId = params.userNotificationChatId ?? '-1000000000001';
  const cardById = params.cardById;

  return {
    calls,
    mock: {
      getCardById: async (id: string) => {
        calls.getCardById.push(id);
        if (!cardById) throw new Error(`Card ${id} not found`);
        return cardById;
      },
      cancelReminderJob: async () => {},
      markReminderJobSending: async (id: string) => {
        calls.markReminderJobSending.push(id);
      },
      getUser: async (userId: string) => {
        calls.getUser.push(userId);
        return {
          status: 'approved' as const,
          notificationChatId,
        };
      },
      setBaseChannelMessage: async (id: string, messageId: number | null) => {
        calls.setBaseChannelMessage.push([id, messageId]);
      },
      markAwaitingGrade: async (input: unknown) => {
        calls.markAwaitingGrade.push(input);
      },
      markReminderJobAwaitingAction: async (input: unknown) => {
        calls.markAwaitingGrade.push(input);
      },
      recordNotification: async (input: unknown) => {
        calls.recordNotification.push(input);
      },
      failReminderJob: async (id: string, error: string) => {
        calls.failReminderJob.push([id, error]);
      },
      createReminderJob: async (input: unknown) => {
        calls.createReminderJob.push(input);
        return {};
      },
      clearAwaitingGrade: async () => {},
    },
  };
};

const createTelegram = (handlers: {
  callApi?: (method: string, payload: CallApiPayload) => Promise<TelegramReply>;
  sendMessage?: (chatId: string | number, text: string, extra?: Record<string, unknown>) => Promise<TelegramReply>;
  copyMessage?: (
    chatId: string | number,
    fromChatId: string | number,
    messageId: number,
    extra?: Record<string, unknown>,
  ) => Promise<{ message_id: number }>;
  copyMessages?: (
    chatId: string | number,
    fromChatId: string | number,
    messageIds: number[],
  ) => Promise<Array<{ message_id?: number }>>;
} = {}) => {
  const calls = {
    callApi: [] as Array<[string, CallApiPayload]>,
    sendMessage: [] as SendMessageArgs[],
    copyMessage: [] as Array<[string | number, string | number, number, Record<string, unknown> | undefined]>,
    copyMessages: [] as Array<[string | number, string | number, number[]]>,
  };
  let messageCounter = 1000;

  const telegram = {
    callApi: async (method: string, payload: CallApiPayload) => {
      calls.callApi.push([method, payload]);
      if (handlers.callApi) return handlers.callApi(method, payload);
      return {
        message_id: ++messageCounter,
        reply_to_message: {
          message_id: payload.reply_to_message_id,
          chat: { id: payload.chat_id },
        },
      };
    },
    sendMessage: async (chatId: string | number, text: string, extra?: Record<string, unknown>) => {
      calls.sendMessage.push([chatId, text, extra]);
      if (handlers.sendMessage) return handlers.sendMessage(chatId, text, extra);
      return { message_id: ++messageCounter };
    },
    copyMessage: async (
      chatId: string | number,
      fromChatId: string | number,
      messageId: number,
      extra?: Record<string, unknown>,
    ) => {
      calls.copyMessage.push([chatId, fromChatId, messageId, extra]);
      if (handlers.copyMessage) return handlers.copyMessage(chatId, fromChatId, messageId, extra);
      return { message_id: ++messageCounter };
    },
    copyMessages: async (
      chatId: string | number,
      fromChatId: string | number,
      messageIds: number[],
    ) => {
      calls.copyMessages.push([chatId, fromChatId, messageIds]);
      if (handlers.copyMessages) return handlers.copyMessages(chatId, fromChatId, messageIds);
      return messageIds.map(() => ({ message_id: ++messageCounter }));
    },
    sendPhoto: async () => ({ message_id: ++messageCounter }),
    sendVideo: async () => ({ message_id: ++messageCounter }),
    editMessageReplyMarkup: async () => {},
  };

  return { calls, mock: { telegram } as any };
};

test('sendReminderJobToChannel отправляет reminder через reply к существующей базе', async () => {
  const card = createCard({ baseChannelMessageId: 777, contentType: 'photo' });
  const job = createJob(card);
  const store = createStore({ userNotificationChatId: '-100555', cardById: card });
  const telegram = createTelegram();
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.equal(store.calls.markReminderJobSending[0], job.id);
  assert.equal(telegram.calls.copyMessage.length, 0);
  assert.equal(telegram.calls.callApi.length, 1);
  const [method, payload] = telegram.calls.callApi[0]!;
  assert.equal(method, 'sendMessage');
  assert.equal(payload.chat_id, '-100555');
  assert.equal(payload.text, '🔔 Время повторить запись');
  assert.equal(payload.reply_to_message_id, 777);
  assert.equal(payload.allow_sending_without_reply, false);
  assert.equal(store.calls.markAwaitingGrade.length, 1);
  assert.deepEqual(store.calls.recordNotification[0], {
    cardId: card.id,
    jobId: job.id,
    messageId: 1001,
    reason: 'manual_now',
    sentAt: (store.calls.recordNotification[0] as { sentAt: string }).sentAt,
  });
});

test('sendReminderJobToChannel для text игнорирует старую базу и отправляет сохранённый текст', async () => {
  const card = createCard({ baseChannelMessageId: 777, contentPreview: 'Actual text' });
  const job = createJob(card);
  const store = createStore({ userNotificationChatId: '-100555', cardById: card });
  const telegram = createTelegram({
    sendMessage: async () => ({ message_id: 778 }),
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.equal(telegram.calls.callApi.length, 0);
  assert.equal(telegram.calls.copyMessage.length, 0);
  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0]?.[0], '-100555');
  assert.equal(telegram.calls.sendMessage[0]?.[1], 'Actual text');
  assert.ok(telegram.calls.sendMessage[0]?.[2]?.reply_markup);
  assert.deepEqual(store.calls.setBaseChannelMessage, [[card.id, 778]]);
  assert.equal((store.calls.markAwaitingGrade[0] as { channelMessageId: number }).channelMessageId, 778);
});

test('sendReminderJobToChannel без базы отправляет сохранённый текст и ставит кнопки на него', async () => {
  const card = createCard({ baseChannelMessageId: null });
  const job = createJob(card);
  const store = createStore({ cardById: card });
  const telegram = createTelegram({
    sendMessage: async () => ({ message_id: 555 }),
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.equal(telegram.calls.callApi.length, 0);
  assert.equal(telegram.calls.copyMessage.length, 0);
  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0]?.[1], card.contentPreview);
  assert.ok(telegram.calls.sendMessage[0]?.[2]?.reply_markup);
  assert.deepEqual(store.calls.setBaseChannelMessage, [[card.id, 555]]);
  assert.deepEqual(store.calls.markAwaitingGrade[0], {
    cardId: card.id,
    jobId: job.id,
    channelId: '-1000000000001',
    channelMessageId: 555,
    pendingSince: (store.calls.markAwaitingGrade[0] as { pendingSince: string }).pendingSince,
    baseMessageId: 555,
  });
});

test('sendReminderJobToChannel для chat-scoped карточки отправляет в чат очереди', async () => {
  const card = createCard({
    queueScopeType: 'chat',
    queueScopeId: '-100777',
    baseChannelMessageId: null,
    contentPreview: 'Group note',
  });
  const job = createJob(card);
  const store = createStore({ userNotificationChatId: '-100555', cardById: card });
  const telegram = createTelegram({
    sendMessage: async () => ({ message_id: 901 }),
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.deepEqual(store.calls.getUser, []);
  assert.equal(telegram.calls.sendMessage[0]?.[0], '-100777');
  assert.deepEqual(store.calls.markAwaitingGrade[0], {
    cardId: card.id,
    jobId: job.id,
    channelId: '-100777',
    channelMessageId: 901,
    pendingSince: (store.calls.markAwaitingGrade[0] as { pendingSince: string }).pendingSince,
    baseMessageId: 901,
  });
});

test('sendReminderJobToChannel пересоздаёт базу, если reply target потерян', async () => {
  const card = createCard({ baseChannelMessageId: 11, contentType: 'photo' });
  const job = createJob(card);
  const store = createStore({ cardById: card });
  const telegram = createTelegram({
    callApi: async () => ({ message_id: 701 }),
    copyMessage: async () => ({ message_id: 602 }),
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.equal(telegram.calls.callApi.length, 1);
  assert.equal(telegram.calls.copyMessage.length, 1);
  assert.equal(telegram.calls.sendMessage.length, 0);
  assert.deepEqual(store.calls.setBaseChannelMessage, [
    [card.id, null],
    [card.id, 602],
  ]);
  assert.equal((store.calls.markAwaitingGrade[0] as { channelMessageId: number }).channelMessageId, 602);
});

test('sendReminderJobToChannel для text не копирует source message, а отправляет сохранённый текст', async () => {
  const card = createCard({ baseChannelMessageId: null, contentPreview: 'Preview text' });
  const job = createJob(card);
  const store = createStore({ cardById: card });
  const telegram = createTelegram({
    copyMessage: async () => {
      throw new Error('cannot copy');
    },
    sendMessage: async () => ({ message_id: 401 }),
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.equal(telegram.calls.copyMessage.length, 0);
  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0]?.[1], 'Preview text');
  assert.deepEqual(store.calls.setBaseChannelMessage, [[card.id, 401]]);
  assert.equal(store.calls.markAwaitingGrade.length, 1);
});

test('sendReminderJobToChannel после пустого copyMessages падает до сохранённого текста', async () => {
  const card = createCard({
    baseChannelMessageId: null,
    sourceMessageIds: [11, 12],
    contentType: 'photo',
    contentPreview: 'Photo preview',
  });
  const job = createJob(card);
  const store = createStore({ cardById: card });
  const telegram = createTelegram({
    copyMessages: async () => [],
    copyMessage: async () => {
      throw new Error('cannot copy single message');
    },
    sendMessage: async () => ({ message_id: 501 }),
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.equal(telegram.calls.copyMessages.length, 1);
  assert.deepEqual(telegram.calls.copyMessages[0]?.[2], [11, 12]);
  assert.equal(telegram.calls.copyMessage.length, 1);
  assert.deepEqual(store.calls.setBaseChannelMessage, [[card.id, 501]]);
});

test('sendReminderJobToChannel уведомляет и планирует retry при полном фейле', async () => {
  const card = createCard({ id: 'critical-1', baseChannelMessageId: null, contentPreview: 'text' });
  const job = createJob(card, { kind: 'review', source: 'scheduled' });
  const store = createStore({ cardById: card });
  let sendCount = 0;
  const telegram = createTelegram({
    sendMessage: async (_chatId, _text, extra) => {
      sendCount += 1;
      if (sendCount === 1) {
        throw new Error('cannot send base text');
      }
      return {
        message_id: 500,
        ...(extra?.reply_parameters ? { reply_to_message: { message_id: 1 } } : {}),
      };
    },
  });
  const scheduler = new ReviewScheduler(store.mock as any, telegram.mock);

  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.equal(telegram.calls.sendMessage.length, 2);
  assert.ok((telegram.calls.sendMessage[1]?.[1] ?? '').includes('critical-1'));
  assert.equal(store.calls.failReminderJob[0]?.[0], job.id);
  assert.equal(store.calls.createReminderJob.length, 1);
  assert.equal((store.calls.createReminderJob[0] as { source: string }).source, 'send_retry');
  assert.equal(store.calls.markAwaitingGrade.length, 0);
});

test('isMissingReplyTarget распознаёт вложенное описание ошибки Telegram', () => {
  const store = createStore({ cardById: createCard() });
  const telegram = createTelegram();
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
