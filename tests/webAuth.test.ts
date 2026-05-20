import { createHash, createHmac } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizePublicBaseUrl } from '../src/publicUrl';
import {
  buildTelegramLoginDataCheckString,
  parseGoogleProfile,
  verifyTelegramLoginAuth,
} from '../src/webAuth';

const signTelegramLogin = (params: Record<string, string>, botToken: string) => {
  const secretKey = createHash('sha256').update(botToken).digest();
  const dataCheckString = buildTelegramLoginDataCheckString(params);
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
};

test('normalizePublicBaseUrl accepts full URLs and Railway domains', () => {
  assert.equal(normalizePublicBaseUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizePublicBaseUrl('learn-bot.up.railway.app'), 'https://learn-bot.up.railway.app');
  assert.equal(normalizePublicBaseUrl('localhost:3107'), 'http://localhost:3107');
});

test('verifyTelegramLoginAuth verifies signed Telegram login widget payload', () => {
  const botToken = '123456:test-token';
  const params = {
    id: '359367655',
    first_name: 'Kirill',
    username: 'rrock',
    auth_date: '2000',
  };
  const signed = { ...params, next: '/account', hash: signTelegramLogin(params, botToken) };
  const result = verifyTelegramLoginAuth(signed, botToken, 2100);

  assert.equal(result?.id, '359367655');
  assert.equal(result?.firstName, 'Kirill');
  assert.equal(result?.username, 'rrock');
});

test('verifyTelegramLoginAuth rejects bad hashes', () => {
  const result = verifyTelegramLoginAuth(
    {
      id: '359367655',
      auth_date: '2000',
      hash: '00',
    },
    '123456:test-token',
    2100,
  );

  assert.equal(result, null);
});

test('parseGoogleProfile normalizes OpenID userinfo', () => {
  assert.deepEqual(parseGoogleProfile({
    sub: 'google-1',
    email: 'USER@EXAMPLE.COM',
    name: 'User Name',
    picture: 'https://example.com/avatar.png',
  }), {
    id: 'google-1',
    email: 'user@example.com',
    name: 'User Name',
    picture: 'https://example.com/avatar.png',
  });
});
