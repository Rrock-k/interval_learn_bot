import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeContentPreview, parseMessage, parseMediaGroup } from '../src/bot';

type AnyMessage = Record<string, unknown>;

const withType = <T>(value: T): AnyMessage => value as AnyMessage;

test('normalizeContentPreview trims whitespace и убирает пустые значения', () => {
  assert.equal(normalizeContentPreview(null), null);
  assert.equal(normalizeContentPreview(''), null);
  assert.equal(normalizeContentPreview('   '), null);
  assert.equal(normalizeContentPreview('\n\t  abc  '), 'abc');
});

test('parseMessage: text сохраняет нормализованный preview', () => {
  const parsed = parseMessage(withType({ text: '  Привет мир  ' }));
  assert.deepEqual(parsed, {
    contentType: 'text',
    preview: 'Привет мир',
    fileId: null,
    fileUniqueId: null,
  });
});

test('parseMessage: пустой text и пустой caption превращаются в null/фиксы', () => {
  const emptyText = parseMessage(withType({ text: '   ' }));
  assert.deepEqual(emptyText, {
    contentType: 'text',
    preview: null,
    fileId: null,
    fileUniqueId: null,
  });

  const photo = parseMessage(
    withType({
      photo: [
        { file_id: 'photo_b', file_unique_id: 'u2', file_size: 20 },
        { file_id: 'photo_a', file_unique_id: 'u1', file_size: 5 },
      ],
      caption: '   ',
    }),
  );
  assert.equal(photo?.contentType, 'photo');
  assert.equal(photo?.preview, '[Фото]');

  const video = parseMessage(
    withType({
      video: { file_id: 'v1', file_unique_id: 'vu1' },
      caption: '  ',
    }),
  );
  assert.equal(video?.preview, '[Видео]');
});

test('parseMediaGroup: fallback preview для медиагруппы без caption', () => {
  const result = parseMediaGroup(
    [
      withType({
        message_id: 1,
        photo: [{ file_id: 'p1', file_unique_id: 'u1', file_size: 10 }],
      }),
      withType({
        message_id: 2,
        photo: [{ file_id: 'p2', file_unique_id: 'u2', file_size: 11 }],
      }),
    ],
  );
  assert.equal(result?.preview, '[Фото x2]');

  const mix = parseMediaGroup([
    withType({ message_id: 1, photo: [{ file_id: 'p1', file_unique_id: 'u1', file_size: 10 }] }),
    withType({ message_id: 2, video: { file_id: 'v1', file_unique_id: 'u2' } }),
  ]);
  assert.equal(mix?.preview, '[Медиа x2]');
});

test('parseMessage: возвращает null на некорректных типах', () => {
  assert.equal(parseMessage(withType({ text: 123 as unknown as string })), null);
  assert.equal(
    parseMessage(
      withType({
        photo: 'not-array' as unknown as Array<{ file_id: string; file_unique_id: string; file_size?: number }>,
      }),
    ),
    null,
  );
  assert.equal(parseMessage(withType({ video: 123 as unknown as Record<string, unknown> })), null);
});

test('parseMessage: обрезает длинный preview до 200 символов', () => {
  const parsed = parseMessage(withType({ text: 'a'.repeat(250) }));
  assert.equal(parsed?.preview?.length, 200);
});

test('parseMediaGroup: пропускает неподдерживаемые сообщения и берет первую валидную карточку', () => {
  const result = parseMediaGroup([
    withType({ message_id: 1, caption: 'caption', sticker: { file_id: 's1', file_unique_id: 'su1' } }),
    withType({
      message_id: 2,
      photo: [{ file_id: 'p1', file_unique_id: 'u1', file_size: 10 }],
      caption: '  ',
    }),
  ]);
  assert.deepEqual(result, {
    contentType: 'photo',
    preview: '[Фото]',
    fileId: 'p1',
    fileUniqueId: 'u1',
  });
});

test('parseMediaGroup: все сообщения неподдерживаемые -> null', () => {
  const result = parseMediaGroup([
    withType({ message_id: 1, document: { file_id: 'd1', file_unique_id: 'du1' } }),
    withType({ message_id: 2, sticker: { file_id: 's2', file_uniqueId: 'su2' } }),
    withType({ message_id: 3, audio: { file_id: 'a3', file_unique_id: 'au3' } }),
  ]);
  assert.equal(result, null);
});
