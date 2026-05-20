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
  databaseUrl: requireEnv('DATABASE_URL'),
  port: toNumber(process.env.PORT, 3000),
  adminChatId: process.env.ADMIN_CHAT_ID,
  adminChatTopicId: toNumber(process.env.ADMIN_CHAT_TOPIC_ID, 0),
  initialReviewMinutes: toNumber(process.env.INITIAL_REVIEW_MINUTES, 60),
  maxIntervalDays: toNumber(process.env.MAX_INTERVAL_DAYS, 45),
  dashboardSecret: requireEnv('DASHBOARD_SECRET'),
  webSessionSecret: (process.env.WEB_SESSION_SECRET || process.env.DASHBOARD_SECRET || '').trim(),
  telegramLoginBotUsername: process.env.TELEGRAM_LOGIN_BOT_USERNAME?.replace(/^@/, '').trim() || null,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || null,
  courseAuthoringLlmApiKey: process.env.COURSE_AUTHORING_LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || null,
  courseAuthoringLlmBaseUrl: process.env.COURSE_AUTHORING_LLM_BASE_URL?.trim() || 'https://api.openai.com/v1',
  courseAuthoringLlmModel: process.env.COURSE_AUTHORING_LLM_MODEL?.trim() || null,
  backlogOwnerUserId: (process.env.BACKLOG_OWNER_USER_ID || '359367655').trim(),
  agentApiToken: process.env.AGENT_API_TOKEN?.trim() || null,
  scheduler: {
    scanIntervalMs: toNumber(process.env.REVIEW_SCAN_INTERVAL_MS, 60_000),
    batchSize: toNumber(process.env.REVIEW_BATCH_SIZE, 5),
  },
};
