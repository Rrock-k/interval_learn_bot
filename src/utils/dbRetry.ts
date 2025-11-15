import { logger } from '../logger';

type RetryOptions = {
  attempts?: number;
  delayMs?: number;
};

const RETRYABLE_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

export const withDbRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_500;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) {
        break;
      }
      const wait = delayMs * attempt;
      logger.warn(
        `Postgres ещё не готов (попытка ${attempt}/${attempts}), повтор через ${wait} мс`,
        error,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
};

const isRetryable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const errno =
    typeof candidate.errno === 'number'
      ? String(candidate.errno)
      : typeof candidate.errno === 'string'
        ? candidate.errno
        : undefined;
  if ((code && RETRYABLE_CODES.has(code)) || (errno && RETRYABLE_CODES.has(errno))) {
    return true;
  }
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return /starting up|terminating connection|connection (?:terminated|failure)|closed the connection unexpectedly|the database system is (?:starting up|shutting down)/i.test(
    message,
  );
};
