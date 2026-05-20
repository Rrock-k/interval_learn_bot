import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CardRecord, ReminderJobRecord } from '../src/db';
import { ReviewScheduler } from '../src/reviewScheduler';

type CallApiPayload = {
  chat_id: string | number;
  text: string;
  reply_markup?: unknown;
  reply_to_message_id?: number;
  allow_sending_without_reply?: boolean;
};

const createCard = (overrides: Partial<CardRecord> = {}): CardRecord => ({
  id: 'album-card',
  userId: '111',
  queueScopeType: 'user',
  queueScopeId: '111',
  sourceChatId: '222',
  sourceMessageId: 10,
  sourceMessageIds: [10, 12, 12, 14],
  contentType: 'photo',
  contentPreview: 'Album caption',
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

const createJob = (card: CardRecord): ReminderJobRecord => {
  const now = new Date().toISOString();
  return {
    id: 'job-album',
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
  };
};

test('sendReminderJobToChannel copies media groups with copyMessages and replies to the last copied item', async () => {
  const card = createCard();
  const job = createJob(card);
  const targetChatId = '-100target';
  const calls = {
    copyMessage: [] as unknown[],
    copyMessages: [] as Array<[string | number, string | number, number[]]>,
    callApi: [] as Array<[string, CallApiPayload]>,
    setBaseChannelMessage: [] as Array<[string, number | null]>,
    markAwaitingGrade: [] as unknown[],
    recordNotification: [] as unknown[],
  };

  const store = {
    getCardById: async () => card,
    cancelReminderJob: async () => {},
    markReminderJobSending: async () => {},
    getUser: async () => ({ notificationChatId: targetChatId }),
    setBaseChannelMessage: async (id: string, messageId: number | null) => {
      calls.setBaseChannelMessage.push([id, messageId]);
    },
    markAwaitingGrade: async (input: unknown) => {
      calls.markAwaitingGrade.push(input);
    },
    recordNotification: async (input: unknown) => {
      calls.recordNotification.push(input);
    },
    failReminderJob: async () => {},
    createReminderJob: async () => {},
  };

  const bot = {
    telegram: {
      copyMessage: async (...args: unknown[]) => {
        calls.copyMessage.push(args);
        return { message_id: 499 };
      },
      copyMessages: async (
        chatId: string | number,
        fromChatId: string | number,
        messageIds: number[],
      ) => {
        calls.copyMessages.push([chatId, fromChatId, messageIds]);
        return [{ message_id: 501 }, { message_id: 502 }, { message_id: 503 }];
      },
      callApi: async (method: string, payload: CallApiPayload) => {
        calls.callApi.push([method, payload]);
        return {
          message_id: 504,
          reply_to_message: {
            message_id: payload.reply_to_message_id,
            chat: { id: payload.chat_id },
          },
        };
      },
      sendPhoto: async () => ({ message_id: 505 }),
      sendVideo: async () => ({ message_id: 506 }),
      sendMessage: async () => ({ message_id: 507 }),
      editMessageReplyMarkup: async () => {},
    },
  };

  const scheduler = new ReviewScheduler(store as any, bot as any);
  await (scheduler as any).sendReminderJobToChannel({ job, card });

  assert.equal(calls.copyMessage.length, 0);
  assert.deepEqual(calls.copyMessages, [[targetChatId, card.sourceChatId, [10, 12, 14]]]);
  assert.deepEqual(calls.setBaseChannelMessage, [[card.id, 503]]);
  assert.equal(calls.callApi.length, 1);
  assert.equal(calls.callApi[0]?.[0], 'sendMessage');
  assert.equal(calls.callApi[0]?.[1].reply_to_message_id, 503);
  assert.equal(calls.callApi[0]?.[1].allow_sending_without_reply, false);
  assert.deepEqual(calls.markAwaitingGrade[0], {
    cardId: card.id,
    jobId: job.id,
    channelId: targetChatId,
    channelMessageId: 504,
    pendingSince: (calls.markAwaitingGrade[0] as { pendingSince: string }).pendingSince,
    baseMessageId: 503,
  });
  assert.deepEqual(calls.recordNotification[0], {
    cardId: card.id,
    jobId: job.id,
    messageId: 504,
    reason: 'manual_now',
    sentAt: (calls.recordNotification[0] as { sentAt: string }).sentAt,
  });
});
