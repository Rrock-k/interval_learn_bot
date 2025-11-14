import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv();

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${key}`);
  }
  return value;
};

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  botToken: requireEnv('BOT_TOKEN'),
  reviewChannelId: requireEnv('CHAT_ID'),
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'bot.db'),
  initialReviewMinutes: toNumber(process.env.INITIAL_REVIEW_MINUTES, 10),
  scheduler: {
    scanIntervalMs: toNumber(process.env.REVIEW_SCAN_INTERVAL_MS, 60_000),
    batchSize: toNumber(process.env.REVIEW_BATCH_SIZE, 5),
  },
};
