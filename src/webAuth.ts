import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TelegramLoginProfile = {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  authDate: number;
};

export type GoogleProfile = {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
};

const TELEGRAM_LOGIN_MAX_AGE_SECONDS = 24 * 60 * 60;
const TELEGRAM_LOGIN_AUTH_FIELDS = new Set([
  'id',
  'first_name',
  'last_name',
  'username',
  'photo_url',
  'auth_date',
]);

const readSingleString = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
};

const safeEqualHex = (left: string, right: string) => {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const randomUrlToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const buildTelegramLoginDataCheckString = (params: Record<string, unknown>) =>
  Object.entries(params)
    .filter(([key, value]) => TELEGRAM_LOGIN_AUTH_FIELDS.has(key) && readSingleString(value) !== null)
    .map(([key, value]) => [key, readSingleString(value) as string] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

export const verifyTelegramLoginAuth = (
  params: Record<string, unknown>,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramLoginProfile | null => {
  const id = readSingleString(params.id);
  const authDateRaw = readSingleString(params.auth_date);
  const hash = readSingleString(params.hash);
  if (!id || !/^\d+$/.test(id) || !authDateRaw || !/^\d+$/.test(authDateRaw) || !hash) {
    return null;
  }

  const authDate = Number(authDateRaw);
  if (!Number.isSafeInteger(authDate) || nowSeconds - authDate > TELEGRAM_LOGIN_MAX_AGE_SECONDS) {
    return null;
  }

  const secretKey = createHash('sha256').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey)
    .update(buildTelegramLoginDataCheckString(params))
    .digest('hex');
  if (!safeEqualHex(calculatedHash, hash)) {
    return null;
  }

  return {
    id,
    username: readSingleString(params.username)?.trim() || null,
    firstName: readSingleString(params.first_name)?.trim() || null,
    lastName: readSingleString(params.last_name)?.trim() || null,
    photoUrl: readSingleString(params.photo_url)?.trim() || null,
    authDate,
  };
};

export const parseGoogleProfile = (value: unknown): GoogleProfile | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.sub === 'string' ? record.sub.trim() : '';
  if (!id) return null;
  const email = typeof record.email === 'string' && record.email.includes('@')
    ? record.email.trim().toLowerCase()
    : null;
  return {
    id,
    email,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : null,
    picture: typeof record.picture === 'string' && record.picture.trim() ? record.picture.trim() : null,
  };
};
