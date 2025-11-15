import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import dayjs from 'dayjs';
import express, {
  type CookieOptions,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cookieParser from 'cookie-parser';
import { Telegraf } from 'telegraf';
import { fetch } from 'undici';
import { CardStatus, CardStore } from './db';
import { config } from './config';
import { logger } from './logger';
import { ReviewScheduler } from './reviewScheduler';

const publicDir = path.join(process.cwd(), 'public');
const DASHBOARD_SESSION_COOKIE = 'dashboard_session';
const DASHBOARD_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 дней

const allowedStatuses: CardStatus[] = ['pending', 'learning', 'awaiting_grade', 'archived'];

const parseLimit = (value: unknown, fallback: number) => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseMinutes = (value: unknown, fallback: number) => {
  if (typeof value !== 'number') {
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }
  return value;
};

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  return !Number.isNaN(Date.parse(value));
};

export const createHttpServer = (
  store: CardStore,
  scheduler: ReviewScheduler,
  bot: Telegraf,
) => {
  const app = express();
  const baseCookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  };
  const sessionCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    maxAge: DASHBOARD_SESSION_DURATION_MS,
  };
  const expectedSecretHash = hashSecret(config.dashboardSecret);

  const getSessionToken = (req: Request): string | undefined => {
    const token = req.cookies?.[DASHBOARD_SESSION_COOKIE];
    return typeof token === 'string' ? token : undefined;
  };

  const isAuthenticated = (req: Request): boolean => {
    const token = getSessionToken(req);
    return Boolean(token && verifySessionToken(token, expectedSecretHash));
  };

  const requireDashboardAuth = (req: Request, res: Response, next: NextFunction) => {
    if (isAuthenticated(req)) {
      next();
      return;
    }

    if (req.accepts('html')) {
      const loginUrl = `/login?next=${encodeURIComponent(req.originalUrl ?? '/')}`;
      res.redirect(loginUrl);
      return;
    }
    res.status(401).json({ error: 'Необходима авторизация' });
  };

  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/login', (req, res) => {
    const nextPath = resolveNextPath(req.query.next);
    if (isAuthenticated(req)) {
      res.redirect(nextPath ?? '/');
      return;
    }
    const options: LoginPageOptions = nextPath ? { next: nextPath } : {};
    res.send(renderLoginPage(options));
  });

  app.post('/login', (req, res) => {
    const providedSecret = typeof req.body?.secret === 'string' ? req.body.secret : '';
    const nextPath =
      resolveNextPath(req.body?.next) ?? resolveNextPath(req.query.next) ?? undefined;

    if (!providedSecret) {
      const options: LoginPageOptions = nextPath ? { next: nextPath } : {};
      options.error = 'Секрет обязателен';
      res.status(400).send(renderLoginPage(options));
      return;
    }

    if (!timingSafeEqual(hashSecret(providedSecret), expectedSecretHash)) {
      logger.warn('Неудачная попытка входа в панель управления');
      const options: LoginPageOptions = nextPath ? { next: nextPath } : {};
      options.error = 'Неверный секрет';
      res.status(401).send(renderLoginPage(options));
      return;
    }

    const sessionToken = createSessionToken(expectedSecretHash);
    res.cookie(DASHBOARD_SESSION_COOKIE, sessionToken, sessionCookieOptions);
    res.redirect(nextPath ?? '/');
  });

  app.post('/logout', (req, res) => {
    res.clearCookie(DASHBOARD_SESSION_COOKIE, baseCookieOptions);
    res.redirect('/login');
  });

  app.use(requireDashboardAuth);

  app.get('/api/cards', async (req, res) => {
    const status = req.query.status as CardStatus | undefined;
    const limit = parseLimit(req.query.limit, 100);
    if (status && !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Неверный статус' });
      return;
    }
    try {
      const cards = await store.listCards({ status, limit });
      res.json({ data: cards });
    } catch (error) {
      logger.error('Ошибка чтения карточек', error);
      res.status(500).json({ error: 'Не удалось загрузить карточки' });
    }
  });

  app.get('/api/cards/:id/media', async (req, res) => {
    try {
      const card = await store.getCardById(req.params.id);
      if (!card.contentFileId) {
        res.status(404).json({ error: 'Нет медиа для этой карточки' });
        return;
      }
      const link = await bot.telegram.getFileLink(card.contentFileId);
      const tgResponse = await fetch(link);
      if (!tgResponse.ok || !tgResponse.body) {
        res.status(502).json({ error: 'Не удалось получить медиа' });
        return;
      }
      res.setHeader(
        'Content-Type',
        tgResponse.headers.get('content-type') ?? 'application/octet-stream',
      );
      res.setHeader('Cache-Control', 'private, max-age=60');
      Readable.fromWeb(tgResponse.body).pipe(res);
    } catch (error) {
      logger.error('Ошибка выдачи медиа', error);
      if (isFileTooBigError(error)) {
        res.status(413).json({ error: 'Файл слишком большой для предпросмотра' });
        return;
      }
      res.status(500).json({ error: 'Не удалось загрузить медиа' });
    }
  });

  app.post('/api/cards/:id/reschedule', async (req, res) => {
    const minutes = parseMinutes(req.body?.minutes, 60);
    const nextReviewAt = dayjs().add(Math.max(1, minutes), 'minute').toISOString();
    try {
      await store.rescheduleCard(req.params.id, nextReviewAt);
      res.json({ ok: true, nextReviewAt });
    } catch (error) {
      logger.error('Ошибка переноса карточки', error);
      res.status(500).json({ error: 'Не удалось перенести карточку' });
    }
  });

  app.post('/api/cards/:id/force-review', async (req, res) => {
    try {
      await scheduler.triggerImmediate(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      logger.error('Ошибка ускорения карточки', error);
      const message =
        error instanceof Error ? error.message : 'Не удалось обновить карточку';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/cards/:id/next-review', async (req, res) => {
    const nextReviewAt = req.body?.nextReviewAt;
    if (!isIsoDate(nextReviewAt)) {
      res.status(400).json({ error: 'Некорректная дата' });
      return;
    }
    try {
      await store.overrideNextReview(req.params.id, nextReviewAt);
      res.json({ ok: true, nextReviewAt });
    } catch (error) {
      logger.error('Ошибка ручного планирования', error);
      res.status(500).json({ error: 'Не удалось обновить дату' });
    }
  });

  app.post('/api/cards/:id/status', async (req, res) => {
    const status = req.body?.status as CardStatus | undefined;
    if (!status || !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Статус обязателен' });
      return;
    }
    try {
      await store.updateStatus(req.params.id, status);
      res.json({ ok: true });
    } catch (error) {
      logger.error('Ошибка смены статуса', error);
      res.status(500).json({ error: 'Не удалось обновить статус' });
    }
  });

  app.delete('/api/cards/:id', async (req, res) => {
    try {
      await store.deleteCard(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      logger.error('Ошибка удаления карточки', error);
      res.status(500).json({ error: 'Не удалось удалить карточку' });
    }
  });

  app.use(express.static(publicDir));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'dashboard.html'));
  });

  const server = app.listen(config.port, () => {
    logger.info(`Веб-интерфейс доступен на http://localhost:${config.port}`);
  });

  return server;
};

const resolveNextPath = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  return value;
};

type LoginPageOptions = {
  error?: string;
  next?: string;
};

const renderLoginPage = (options: LoginPageOptions = {}) => {
  const errorMessage = options.error
    ? `<p class="error">${escapeHtml(options.error)}</p>`
    : '';
  const nextField = options.next
    ? `<input type="hidden" name="next" value="${escapeHtml(options.next)}" />`
    : '';

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>Вход в панель</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { background: #1e293b; padding: 32px; border-radius: 12px; width: 320px; box-shadow: 0 10px 40px rgba(15, 23, 42, 0.4); }
      h1 { font-size: 20px; margin: 0 0 16px; text-align: center; }
      label { font-size: 14px; display: block; margin-bottom: 8px; color: #cbd5f5; }
      input[type="password"] { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #f8fafc; font-size: 16px; margin-bottom: 16px; }
      button { width: 100%; padding: 10px 12px; border-radius: 8px; border: none; font-size: 16px; font-weight: 600; background: #38bdf8; color: #0f172a; cursor: pointer; }
      button:hover { background: #0ea5e9; }
      .error { color: #f87171; margin-bottom: 12px; text-align: center; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Доступ к панели</h1>
      ${errorMessage}
      <form method="post" action="/login">
        ${nextField}
        <label for="secret">Секрет</label>
        <input id="secret" autofocus name="secret" type="password" placeholder="••••••••" />
        <button type="submit">Войти</button>
      </form>
    </div>
  </body>
</html>`;
};

const escapeHtml = (value: string): string => {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (char) => map[char] ?? char);
};

const hashSecret = (value: string): Buffer => {
  return createHash('sha256').update(value).digest();
};

const createSessionToken = (secretHash: Buffer): string => {
  const expiresAt = (Date.now() + DASHBOARD_SESSION_DURATION_MS).toString();
  const signature = signSessionPayload(expiresAt, secretHash);
  return `${expiresAt}.${signature}`;
};

const verifySessionToken = (token: string, secretHash: Buffer): boolean => {
  const [expiresAtStr, signature] = token.split('.');
  if (!expiresAtStr || !signature) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }
  const expectedSignature = signSessionPayload(expiresAtStr, secretHash);
  let providedBuffer: Buffer;
  let expectedBuffer: Buffer;
  try {
    providedBuffer = Buffer.from(signature, 'hex');
    expectedBuffer = Buffer.from(expectedSignature, 'hex');
  } catch (_error) {
    return false;
  }
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const signSessionPayload = (payload: string, secretHash: Buffer): string => {
  return createHmac('sha256', secretHash).update(payload).digest('hex');
};

const isFileTooBigError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const response = (error as any).response;
  if (!response) return false;
  return response.error_code === 400 && /file is too big/i.test(response.description ?? '');
};
