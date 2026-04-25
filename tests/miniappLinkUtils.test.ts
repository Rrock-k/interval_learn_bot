import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const { buildMessageLink, getMessageLink } = require('../public/miniapp/linkUtils.js') as {
  buildMessageLink: (chatId: string | number | null, messageId: string | number | null) => string | null;
  getMessageLink: (card: Record<string, unknown> | null) => string | null;
};

test('buildMessageLink: public chat и канал корректны', () => {
  assert.equal(buildMessageLink('12345', 10), 'tg://openmessage?user_id=12345&message_id=10');
  assert.equal(buildMessageLink('-10012345', 10), 'https://t.me/c/12345/10');
  assert.equal(buildMessageLink('-12345', 10), null);
  assert.equal(buildMessageLink('12345', 10.5), null);
  assert.equal(buildMessageLink('12345', 'abc' as unknown as number), null);
});

test('buildMessageLink: защищает некорректные идентификаторы', () => {
  assert.equal(buildMessageLink('-100', 10), null);
  assert.equal(buildMessageLink('-100abc', 10), null);
  assert.equal(buildMessageLink('-10', 10), null);
  assert.equal(buildMessageLink('user', 10), null);
  assert.equal(buildMessageLink('12345', 0), null);
  assert.equal(buildMessageLink('12345', -1), null);
  assert.equal(buildMessageLink('12345', Number.NaN), null);
  assert.equal(buildMessageLink('12345', Infinity), null);
  assert.equal(buildMessageLink(' 12345 ', 10), 'tg://openmessage?user_id=12345&message_id=10');
});

test('getMessageLink: pending ссылка имеет приоритет для awaiting_grade', () => {
  const card = {
    id: '1',
    status: 'awaiting_grade',
    pendingChannelId: '-100555',
    pendingChannelMessageId: 15,
    sourceChatId: '-100999',
    sourceMessageId: 20,
  };
  assert.equal(getMessageLink(card), 'https://t.me/c/555/15');
});

test('getMessageLink: awaiting_grade откатывается на исходник если pending некорректен', () => {
  const card = {
    id: '1',
    status: 'awaiting_grade',
    pendingChannelId: '-100',
    pendingChannelMessageId: 15,
    sourceChatId: '123',
    sourceMessageId: 20,
  };
  assert.equal(getMessageLink(card), 'tg://openmessage?user_id=123&message_id=20');
});

test('getMessageLink: returns null для пустой/битой карточки', () => {
  assert.equal(getMessageLink(null as unknown as Record<string, unknown>), null);
  assert.equal(
    getMessageLink({
      id: '1',
      status: 'learning',
      sourceChatId: '-100abc',
      sourceMessageId: 20,
    } as unknown as Record<string, unknown>),
    null,
  );
});

test('getMessageLink: fallback на исходник для не-awaiting_grade', () => {
  const card = {
    id: '1',
    status: 'learning',
    sourceChatId: '123',
    sourceMessageId: 7,
  };
  assert.equal(getMessageLink(card), 'tg://openmessage?user_id=123&message_id=7');
});
