import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { validate, parse } from '@tma.js/init-data-node';
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
import {
  AppSessionRecord,
  AppUserRecord,
  BacklogItemStatus,
  buildUserQueueScope,
  CardRecord,
  CardStatus,
  CardStore,
  CourseCadence,
  ReminderJobRecord,
  UserAuthAccountRecord,
  UserReminderSettings,
} from './db';
import { CourseStepKind } from './courses';
import { config } from './config';
import { logger } from './logger';
import { getPublicBaseUrl } from './publicUrl';
import { ReminderRebalancePreviewChange } from './reminderRebalance';
import { ReviewScheduler } from './reviewScheduler';
import { computeReview } from './spacedRepetition';
import { withDbRetry } from './utils/dbRetry';
import {
  hashToken,
  parseGoogleProfile,
  randomUrlToken,
  verifyTelegramLoginAuth,
} from './webAuth';

const publicDir = path.join(process.cwd(), 'public');
const DASHBOARD_SESSION_COOKIE = 'dashboard_session';
const APP_SESSION_COOKIE = 'app_session';
const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_NEXT_COOKIE = 'oauth_next';
const DASHBOARD_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 дней
const APP_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 дней

const allowedStatuses: CardStatus[] = ['pending', 'learning', 'awaiting_grade', 'archived'];
const allowedBacklogStatuses: BacklogItemStatus[] = ['open', 'done', 'archived'];

const isPersonalMiniAppCard = (card: CardRecord, userId: string) =>
  card.userId === userId &&
  card.queueScopeType === 'user' &&
  card.queueScopeId === userId;

const parseLimit = (value: unknown, fallback: number) => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(500, Math.max(1, parsed));
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

const isValidTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const parseReminderSettings = (body: unknown): UserReminderSettings | null => {
  if (!body || typeof body !== 'object') return null;
  const input = body as Record<string, unknown>;
  const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : '';
  const activeHoursStart = Number(input.activeHoursStart);
  const activeHoursEnd = Number(input.activeHoursEnd);
  const minGapMinutes = Number(input.minGapMinutes);
  if (!timezone || !isValidTimezone(timezone)) return null;
  if (!Number.isInteger(activeHoursStart) || activeHoursStart < 0 || activeHoursStart > 1439) return null;
  if (!Number.isInteger(activeHoursEnd) || activeHoursEnd < 1 || activeHoursEnd > 1440) return null;
  if (activeHoursStart >= activeHoursEnd) return null;
  if (!Number.isInteger(minGapMinutes) || minGapMinutes < 1 || minGapMinutes > 360) return null;
  return {
    timezone,
    activeHoursStart,
    activeHoursEnd,
    minGapMinutes,
  };
};

const parseRebalanceOptions = (body: unknown) => {
  const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const horizonDays = Number(input.horizonDays ?? 7);
  const bucketMinutes = Number(input.bucketMinutes ?? 30);
  return {
    horizonDays: Number.isInteger(horizonDays) ? Math.min(30, Math.max(1, horizonDays)) : 7,
    bucketMinutes: Number.isInteger(bucketMinutes)
      ? Math.min(120, Math.max(15, bucketMinutes))
      : 30,
  };
};

const parseRebalanceChanges = (body: unknown): ReminderRebalancePreviewChange[] | null => {
  if (!body || typeof body !== 'object') return null;
  const changes = (body as Record<string, unknown>).changes;
  if (!Array.isArray(changes)) return null;
  return changes.map((entry) => {
    const input = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return {
      id: String(input.id ?? input.jobId ?? ''),
      jobId: String(input.jobId ?? input.id ?? ''),
      cardId: String(input.cardId ?? ''),
      contentPreview: typeof input.contentPreview === 'string' ? input.contentPreview : null,
      dueAt: String(input.dueAt ?? ''),
      beforeScheduledAt: String(input.beforeScheduledAt ?? ''),
      afterScheduledAt: String(input.afterScheduledAt ?? ''),
      deltaMinutes: Number(input.deltaMinutes ?? 0),
    };
  });
};

const parseOptionalString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const allowedCourseStepKinds: CourseStepKind[] = ['material', 'practice', 'question'];
const allowedCourseCadences: CourseCadence[] = ['after_view', 'daily'];

const parseCoursePayload = (body: unknown) => {
  if (!body || typeof body !== 'object') return null;
  const input = body as Record<string, unknown>;
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : null;
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const steps = rawSteps
    .map((entry) => {
      const step = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const kind = allowedCourseStepKinds.includes(step.kind as CourseStepKind)
        ? (step.kind as CourseStepKind)
        : 'material';
      const stepTitle = typeof step.title === 'string' ? step.title.trim() : '';
      const body = typeof step.body === 'string' ? step.body.trim() : '';
      return { kind, title: stepTitle, body };
    })
    .filter((step) => step.title && step.body);
  if (!title || steps.length === 0 || steps.length > 100) {
    return null;
  }
  return { title, description, steps };
};

const parseQueueDelayMinutes = (value: unknown, fallback: number) => {
  const raw = typeof value === 'string' ? Number(value) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(60 * 24 * 30, Math.max(1, Math.floor(raw)));
};

const getHttpStatus = (error: unknown) => {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const value = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(value) && value >= 400 && value <= 599) {
      return value;
    }
  }
  return 500;
};

const queueError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

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
  const appCookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
  const sessionCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    maxAge: DASHBOARD_SESSION_DURATION_MS,
  };
  const appSessionCookieOptions: CookieOptions = {
    ...appCookieOptions,
    maxAge: APP_SESSION_DURATION_MS,
  };
  const oauthCookieOptions: CookieOptions = {
    ...appCookieOptions,
    maxAge: 1000 * 60 * 10,
  };
  const expectedSecretHash = hashSecret(config.dashboardSecret);
  const webSessionSecretHash = hashSecret(config.webSessionSecret);
  const expectedAgentApiTokenHash = config.agentApiToken
    ? hashSecret(config.agentApiToken)
    : null;
  const publicBaseUrl = getPublicBaseUrl();

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

  const getAppSessionToken = (req: Request): string | undefined => {
    const token = req.cookies?.[APP_SESSION_COOKIE];
    return typeof token === 'string' ? token : undefined;
  };

  const getAppSession = async (req: Request): Promise<AppSessionRecord | null> => {
    const token = getAppSessionToken(req);
    if (!token) return null;
    const tokenHash = hashToken(`${token}.${webSessionSecretHash.toString('hex')}`);
    return withDbRetry(() => store.findWebSessionByTokenHash(tokenHash));
  };

  const createAppSession = async (res: Response, appUserId: string) => {
    const token = randomUrlToken();
    const tokenHash = hashToken(`${token}.${webSessionSecretHash.toString('hex')}`);
    const expiresAt = new Date(Date.now() + APP_SESSION_DURATION_MS).toISOString();
    await withDbRetry(() => store.createWebSession({ appUserId, tokenHash, expiresAt }));
    res.cookie(APP_SESSION_COOKIE, token, appSessionCookieOptions);
  };

  const clearAppSession = async (req: Request, res: Response) => {
    const token = getAppSessionToken(req);
    if (token) {
      const tokenHash = hashToken(`${token}.${webSessionSecretHash.toString('hex')}`);
      await withDbRetry(() => store.deleteWebSessionByTokenHash(tokenHash));
    }
    res.clearCookie(APP_SESSION_COOKIE, appCookieOptions);
  };

  const requireAppAuth = async (req: Request, res: Response, next: NextFunction) => {
    const session = await getAppSession(req);
    if (!session) {
      const nextPath = encodeURIComponent(req.originalUrl ?? '/account');
      res.redirect(`/auth/signin?next=${nextPath}`);
      return;
    }
    (req as any).appSession = session;
    next();
  };

  const getAgentApiToken = (req: Request): string | undefined => {
    const authHeader = req.get('authorization');
    const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) {
      return bearerMatch[1].trim();
    }
    const fallbackHeader = req.get('x-agent-token');
    return fallbackHeader?.trim() || undefined;
  };

  const requireAgentApiAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!expectedAgentApiTokenHash) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const token = getAgentApiToken(req);
    if (!token || !timingSafeEqual(hashSecret(token), expectedAgentApiTokenHash)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/miniapp', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

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

  app.get('/auth/signin', async (req, res) => {
    const nextPath = resolveNextPath(req.query.next) ?? '/account';
    const session = await getAppSession(req);
    if (session) {
      res.redirect(nextPath);
      return;
    }
    res.cookie(OAUTH_NEXT_COOKIE, nextPath, oauthCookieOptions);
    const options: AuthSignInPageOptions = {
      next: nextPath,
      publicBaseUrl,
      googleEnabled: Boolean(config.googleClientId && config.googleClientSecret),
      telegramLoginBotUsername: config.telegramLoginBotUsername,
    };
    if (typeof req.query.error === 'string') {
      options.error = req.query.error;
    }
    res.send(renderAuthSignInPage(options));
  });

  app.get('/auth/google', async (req, res) => {
    if (!config.googleClientId || !config.googleClientSecret) {
      res.redirect('/auth/signin?error=google_not_configured');
      return;
    }
    const state = randomUrlToken(18);
    const nextPath = resolveNextPath(req.query.next) ?? '/account';
    res.cookie(OAUTH_STATE_COOKIE, state, oauthCookieOptions);
    res.cookie(OAUTH_NEXT_COOKIE, nextPath, oauthCookieOptions);

    const redirectUri = `${publicBaseUrl}/auth/google/callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.googleClientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    res.redirect(url.toString());
  });

  app.get('/auth/google/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const expectedState = typeof req.cookies?.[OAUTH_STATE_COOKIE] === 'string'
      ? req.cookies[OAUTH_STATE_COOKIE]
      : '';
    const nextPath = resolveNextPath(req.cookies?.[OAUTH_NEXT_COOKIE]) ?? '/account';
    res.clearCookie(OAUTH_STATE_COOKIE, appCookieOptions);
    res.clearCookie(OAUTH_NEXT_COOKIE, appCookieOptions);

    if (!config.googleClientId || !config.googleClientSecret || !code || !state || state !== expectedState) {
      res.redirect('/auth/signin?error=google_auth_failed');
      return;
    }

    try {
      const redirectUri = `${publicBaseUrl}/auth/google/callback`;
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenResponse.ok) {
        throw new Error(`Google token exchange failed: ${tokenResponse.status}`);
      }
      const tokenData = await tokenResponse.json() as { access_token?: string };
      if (!tokenData.access_token) {
        throw new Error('Google token response has no access_token');
      }
      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!profileResponse.ok) {
        throw new Error(`Google profile request failed: ${profileResponse.status}`);
      }
      const rawProfile = await profileResponse.json();
      const profile = parseGoogleProfile(rawProfile);
      if (!profile) {
        throw new Error('Google profile is invalid');
      }

      const currentSession = await getAppSession(req);
      const resolved = await withDbRetry(() =>
        store.resolveAppUserForAuthAccount({
          provider: 'google',
          providerAccountId: profile.id,
          email: profile.email,
          displayName: profile.name,
          avatarUrl: profile.picture,
          rawProfile,
        }, currentSession?.user.id),
      );
      if (!currentSession || currentSession.user.id !== resolved.user.id) {
        await createAppSession(res, resolved.user.id);
      }
      res.redirect(nextPath);
    } catch (error) {
      logger.error('Google auth failed', error);
      const statusCode = getHttpStatus(error);
      const target = statusCode === 409 ? '/account?error=account_already_linked' : '/auth/signin?error=google_auth_failed';
      res.redirect(target);
    }
  });

  app.get('/auth/telegram/callback', async (req, res) => {
    const nextPath =
      resolveNextPath(req.cookies?.[OAUTH_NEXT_COOKIE]) ?? resolveNextPath(req.query.next) ?? '/account';
    res.clearCookie(OAUTH_NEXT_COOKIE, appCookieOptions);
    const profile = verifyTelegramLoginAuth(req.query, config.botToken);
    if (!profile) {
      res.redirect('/auth/signin?error=telegram_auth_failed');
      return;
    }

    try {
      await withDbRetry(() =>
        store.createUser({
          id: profile.id,
          ...(profile.username ? { username: profile.username } : {}),
          ...(profile.firstName ? { firstName: profile.firstName } : {}),
          ...(profile.lastName ? { lastName: profile.lastName } : {}),
        }),
      );
      const currentSession = await getAppSession(req);
      const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(' ')
        || (profile.username ? `@${profile.username}` : `Telegram ${profile.id}`);
      const resolved = await withDbRetry(() =>
        store.resolveAppUserForAuthAccount({
          provider: 'telegram',
          providerAccountId: profile.id,
          username: profile.username,
          displayName,
          avatarUrl: profile.photoUrl,
          rawProfile: profile,
        }, currentSession?.user.id),
      );
      if (!currentSession || currentSession.user.id !== resolved.user.id) {
        await createAppSession(res, resolved.user.id);
      }
      res.redirect(nextPath);
    } catch (error) {
      logger.error('Telegram auth failed', error);
      const statusCode = getHttpStatus(error);
      const target = statusCode === 409 ? '/account?error=account_already_linked' : '/auth/signin?error=telegram_auth_failed';
      res.redirect(target);
    }
  });

  app.post('/auth/logout', async (req, res) => {
    await clearAppSession(req, res);
    res.redirect('/auth/signin');
  });

  app.get('/account', requireAppAuth, async (req, res) => {
    const session = (req as any).appSession as AppSessionRecord;
    const accounts = await withDbRetry(() => store.listAuthAccounts(session.user.id));
    const options: AccountPageOptions = {
      user: session.user,
      accounts,
      publicBaseUrl,
      googleEnabled: Boolean(config.googleClientId && config.googleClientSecret),
      telegramLoginBotUsername: config.telegramLoginBotUsername,
    };
    if (typeof req.query.error === 'string') {
      options.error = req.query.error;
    }
    res.send(renderAccountPage(options));
  });

  app.get('/api/account/me', requireAppAuth, async (req, res) => {
    const session = (req as any).appSession as AppSessionRecord;
    const accounts = await withDbRetry(() => store.listAuthAccounts(session.user.id));
    res.json({
      data: {
        user: session.user,
        accounts,
      },
    });
  });

  // Mini App authentication middleware
  const verifyTelegramWebAppData = (initData: string): { userId: string } | null => {
    if (!initData) {
      logger.warn('[MiniApp Auth] No initData provided');
      return null;
    }
    
    try {
      logger.info('[MiniApp Auth] Validating initData (Strategy: Decoded + Signature)');
      
      const params = new URLSearchParams(initData);
      const hash = params.get('hash');
      
      if (!hash) {
        logger.warn('[MiniApp Auth] No hash provided');
        return null;
      }
      
      // Remove ONLY hash, KEEP signature
      params.delete('hash');
      
      // Sort and create data check string (DECODED values)
      const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      
      const botToken = config.botToken.trim();
      const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
      const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      
      if (calculatedHash !== hash) {
        logger.warn(`[MiniApp Auth] Hash mismatch. Calc: ${calculatedHash} vs Hash: ${hash}`);
        return null;
      }
      
      // Check expiration
      const authDate = params.get('auth_date');
      if (!authDate || Date.now() / 1000 - Number(authDate) > 86400) {
        logger.warn('[MiniApp Auth] Data expired');
        return null;
      }
      
      const userParam = params.get('user');
      if (!userParam) return null;
      
      const user = JSON.parse(userParam);
      return { userId: String(user.id) };
    } catch (error) {
      logger.error('[MiniApp Auth] Validation error:', error);
      return null;
    }
  };

  const requireMiniAppAuth = (req: Request, res: Response, next: NextFunction) => {
    const initData = req.headers['x-telegram-init-data'] as string | undefined;
    
    if (!initData) {
      res.status(401).json({ error: 'Missing Telegram auth data' });
      return;
    }
    
    const authResult = verifyTelegramWebAppData(initData);
    
    if (!authResult) {
      res.status(401).json({ error: 'Invalid Telegram auth data' });
      return;
    }
    
    (req as any).userId = authResult.userId;
    next();
  };

  const requireMiniAppOwner = (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId;
    if (userId !== config.backlogOwnerUserId) {
      res.status(403).json({ error: 'Owner-only tool' });
      return;
    }
    next();
  };

  const loadQueueActionContext = async (
    userId: string,
    cardId: string | undefined,
    jobId?: string | null,
  ): Promise<{ card: CardRecord; job: ReminderJobRecord | null }> => {
    if (!cardId) {
      throw queueError(400, 'Card ID required');
    }

    let card: CardRecord;
    try {
      card = await withDbRetry(() => store.getCardById(cardId));
    } catch {
      throw queueError(404, 'Карточка не найдена');
    }
    if (!isPersonalMiniAppCard(card, userId)) {
      throw queueError(403, 'Access denied');
    }
    if (card.status === 'pending') {
      throw queueError(409, 'Карточка ещё не активирована');
    }
    if (card.status === 'archived') {
      throw queueError(409, 'Карточка архивирована');
    }

    if (jobId) {
      const found = await withDbRetry(() => store.getReminderJobWithCard(jobId));
      if (!found || found.card.id !== cardId || !isPersonalMiniAppCard(found.card, userId)) {
        throw queueError(404, 'Напоминание не найдено');
      }
      if (found.job.status !== 'awaiting_action') {
        throw queueError(409, 'Напоминание уже обработано');
      }
      return found;
    }

    const awaitingJob = await withDbRetry(() => store.findAwaitingReviewJobByCard(cardId));
    if (awaitingJob) {
      card = awaitingJob.card;
      return {
        card,
        job: awaitingJob.job,
      };
    }

    return { card, job: null };
  };

  const handleQueueActionError = (res: Response, label: string, error: unknown) => {
    const message = error instanceof Error ? error.message : 'Не удалось выполнить действие';
    const statusCode = getHttpStatus(error);
    logger.error(label, error);
    res.status(statusCode).json({ error: message });
  };

  // Mini App public routes
  app.get('/miniapp', (_req, res) => {
    res.sendFile(path.join(publicDir, 'miniapp', 'index.html'));
  });

  // Mini App API routes
  app.get('/api/miniapp/me', requireMiniAppAuth, (req, res) => {
    const userId = (req as any).userId;
    res.json({
      data: {
        userId,
        ownerTools: userId === config.backlogOwnerUserId,
      },
    });
  });

  app.get(
    '/api/miniapp/courses',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      try {
        const courses = await withDbRetry(() => store.listCourseSummariesByOwner(userId));
        res.json({ data: courses });
      } catch (error) {
        logger.error('Error loading Mini App courses', error);
        res.status(500).json({ error: 'Failed to load courses' });
      }
    },
  );

  app.post(
    '/api/miniapp/courses',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const payload = parseCoursePayload(req.body);
      if (!payload) {
        res.status(400).json({ error: 'Invalid course payload' });
        return;
      }
      try {
        const result = await withDbRetry(() =>
          store.createCourseWithSteps({
            ownerUserId: userId,
            title: payload.title,
            description: payload.description,
            steps: payload.steps,
          }),
        );
        res.json({ data: result });
      } catch (error) {
        logger.error('Error creating Mini App course', error);
        res.status(500).json({ error: 'Failed to create course' });
      }
    },
  );

  app.post(
    '/api/miniapp/courses/:id/start',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const courseId = req.params.id;
      if (!courseId) {
        res.status(400).json({ error: 'Course id is required' });
        return;
      }
      const requestedCadence = typeof req.body?.cadence === 'string' ? req.body.cadence : '';
      const cadence = allowedCourseCadences.includes(requestedCadence as CourseCadence)
        ? (requestedCadence as CourseCadence)
        : 'after_view';
      try {
        const course = await withDbRetry(() => store.findCourseById(courseId));
        if (!course) {
          res.status(404).json({ error: 'Course not found' });
          return;
        }
        if (course.ownerUserId !== userId || course.status === 'archived') {
          res.status(404).json({ error: 'Course not found' });
          return;
        }
        const result = await withDbRetry(() =>
          store.startCourseEnrollment({
            courseId,
            userId,
            queueScope: buildUserQueueScope(userId),
            cadence,
          }),
        );
        res.json({ data: result });
      } catch (error) {
        logger.error('Error starting Mini App course', error);
        res.status(500).json({ error: 'Failed to start course' });
      }
    },
  );

  app.get(
    '/api/miniapp/queue',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const limit = parseLimit(req.query.limit, 20);
      try {
        const items = await withDbRetry(() =>
          store.listReminderQueueByUser({ userId, limit }),
        );
        res.json({
          data: {
            items,
            count: items.length,
            next: items[0] ?? null,
          },
        });
      } catch (error) {
        logger.error('Error loading reminder queue for Mini App', error);
        res.status(500).json({ error: 'Failed to load reminder queue' });
      }
    },
  );

  app.post(
    '/api/miniapp/queue/cards/:id/viewed',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const cardId = req.params.id;
      const jobId = parseOptionalString(req.body?.jobId);

      try {
        const { card, job } = await loadQueueActionContext(userId, cardId, jobId);

        if (job?.kind === 'one_time') {
          await withDbRetry(() => store.completeReminderJob(job.id));
          res.json({
            ok: true,
            data: {
              action: 'one_time_completed',
              card,
              job,
            },
          });
          return;
        }

        const courseAdvance = await withDbRetry(() =>
          store.completeCourseStepFromQueue({
            cardId: card.id,
            jobId: job?.id ?? null,
          }),
        );
        if (courseAdvance) {
          res.json({
            ok: true,
            data: {
              action: 'course_step_viewed',
              card,
              course: courseAdvance,
            },
          });
          return;
        }

        const result = computeReview(card, 'ok');
        await withDbRetry(() =>
          store.saveReviewResult({
            cardId: card.id,
            jobId: job?.id ?? null,
            nextReviewAt: result.nextReviewAt,
            repetition: result.repetition,
            reviewedAt: new Date().toISOString(),
          }),
        );
        const updated = await withDbRetry(() => store.getCardById(card.id));
        res.json({
          ok: true,
          data: {
            action: 'viewed',
            card: updated,
            nextReviewAt: result.nextReviewAt,
            repetition: result.repetition,
          },
        });
      } catch (error) {
        handleQueueActionError(res, 'Error marking queue card viewed', error);
      }
    },
  );

  app.post(
    '/api/miniapp/queue/cards/:id/not-viewed',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const cardId = req.params.id;
      const jobId = parseOptionalString(req.body?.jobId);

      try {
        const { card, job } = await loadQueueActionContext(userId, cardId, jobId);
        if (card.status === 'awaiting_grade' || job?.status === 'awaiting_action') {
          res.json({
            ok: true,
            data: {
              action: 'kept_in_queue',
              card,
              job,
            },
          });
          return;
        }

        const now = new Date().toISOString();
        await withDbRetry(() => store.rescheduleCard(card.id, now));
        const updated = await withDbRetry(() => store.getCardById(card.id));
        res.json({
          ok: true,
          data: {
            action: 'requeued_now',
            card: updated,
            nextReviewAt: now,
          },
        });
      } catch (error) {
        handleQueueActionError(res, 'Error returning queue card to stack', error);
      }
    },
  );

  app.post(
    '/api/miniapp/queue/cards/:id/again',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const cardId = req.params.id;
      const jobId = parseOptionalString(req.body?.jobId);

      try {
        const { card, job } = await loadQueueActionContext(userId, cardId, jobId);
        if (job?.kind === 'one_time') {
          const snoozedJob = await withDbRetry(() => store.snoozeReminderJob(job.id, 60));
          res.json({
            ok: true,
            data: {
              action: 'one_time_snoozed',
              card,
              job: snoozedJob,
            },
          });
          return;
        }

        const result = computeReview(card, 'again');
        await withDbRetry(() =>
          store.saveReviewResult({
            cardId: card.id,
            jobId: job?.id ?? null,
            nextReviewAt: result.nextReviewAt,
            repetition: result.repetition,
            reviewedAt: new Date().toISOString(),
          }),
        );
        const updated = await withDbRetry(() => store.getCardById(card.id));
        res.json({
          ok: true,
          data: {
            action: 'again',
            card: updated,
            nextReviewAt: result.nextReviewAt,
            repetition: result.repetition,
          },
        });
      } catch (error) {
        handleQueueActionError(res, 'Error marking queue card again', error);
      }
    },
  );

  app.post(
    '/api/miniapp/queue/cards/:id/reschedule',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const cardId = req.params.id;
      const jobId = parseOptionalString(req.body?.jobId);
      const remindAt = parseOptionalString(req.body?.remindAt);
      const minutes = parseQueueDelayMinutes(req.body?.minutes, 60);

      if (remindAt && !isIsoDate(remindAt)) {
        res.status(400).json({ error: 'Некорректная дата напоминания' });
        return;
      }

      const nextReviewAt =
        remindAt
          ? remindAt
          : dayjs().add(minutes, 'minute').toISOString();

      if (new Date(nextReviewAt).getTime() <= Date.now()) {
        res.status(400).json({ error: 'Дата напоминания должна быть в будущем' });
        return;
      }

      try {
        const { card, job } = await loadQueueActionContext(userId, cardId, jobId);
        if (job?.kind === 'one_time') {
          await withDbRetry(() => store.completeReminderJob(job.id));
          const nextJob = await withDbRetry(() =>
            store.createReminderJob({
              cardId: card.id,
              userId: card.userId,
              kind: 'one_time',
              dueAt: nextReviewAt,
              source: 'miniapp_queue_reschedule',
              snoozedFromJobId: job.id,
            }),
          );
          res.json({
            ok: true,
            data: {
              action: 'one_time_rescheduled',
              card,
              job: nextJob,
              nextReviewAt,
            },
          });
          return;
        }

        await withDbRetry(() => store.rescheduleCard(card.id, nextReviewAt));
        const updated = await withDbRetry(() => store.getCardById(card.id));
        res.json({
          ok: true,
          data: {
            action: 'rescheduled',
            card: updated,
            nextReviewAt,
          },
        });
      } catch (error) {
        handleQueueActionError(res, 'Error rescheduling queue card', error);
      }
    },
  );

  app.post(
    '/api/miniapp/queue/cards/:id/archive',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const cardId = req.params.id;
      const jobId = parseOptionalString(req.body?.jobId);

      try {
        const { card } = await loadQueueActionContext(userId, cardId, jobId);
        await withDbRetry(() => store.updateStatus(card.id, 'archived'));
        const updated = await withDbRetry(() => store.getCardById(card.id));
        res.json({
          ok: true,
          data: {
            action: 'archived',
            card: updated,
          },
        });
      } catch (error) {
        handleQueueActionError(res, 'Error archiving queue card', error);
      }
    },
  );

  app.get('/api/miniapp/cards', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;
    const status = req.query.status as CardStatus | undefined;
    const limit = parseLimit(req.query.limit, 100);
    
    if (status && !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    
    try {
      const queueScope = buildUserQueueScope(userId);
      const listParams = status
        ? { userId, status, limit, queueScope }
        : { userId, limit, queueScope };
      const userCards = await withDbRetry(() =>
        store.listCardsByUser(listParams),
      );
      res.json({ data: userCards });
    } catch (error) {
      logger.error('Error loading cards for Mini App', error);
      res.status(500).json({ error: 'Failed to load cards' });
    }
  });

  app.get('/api/miniapp/cards/:id', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;
    const cardId = req.params.id;

    if (!cardId) {
      res.status(400).json({ error: 'Card ID required' });
      return;
    }

    try {
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (!isPersonalMiniAppCard(card, userId)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      res.json({ data: card });
    } catch (error) {
      logger.error('Error loading card for Mini App', error);
      res.status(404).json({ error: 'Card not found' });
    }
  });

  app.get('/api/miniapp/cards/:id/media', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;
    const cardId = req.params.id;

    if (!cardId) {
      res.status(400).json({ error: 'Card ID required' });
      return;
    }

    try {
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (!isPersonalMiniAppCard(card, userId)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
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
      logger.error('Ошибка выдачи медиа (Mini App)', error);
      if (isFileTooBigError(error)) {
        res.status(413).json({ error: 'Файл слишком большой для предпросмотра' });
        return;
      }
      res.status(500).json({ error: 'Не удалось загрузить медиа' });
    }
  });

  app.get('/api/miniapp/stats', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;
    
    try {
      const queueScope = buildUserQueueScope(userId);
      const userCards = await withDbRetry(() =>
        store.listCardsByUser({ userId, limit: 1000, queueScope }),
      );
      
      const stats = {
        total: userCards.length,
        pending: userCards.filter(c => c.status === 'pending').length,
        learning: userCards.filter(c => c.status === 'learning').length,
        awaitingGrade: userCards.filter(c => c.status === 'awaiting_grade').length,
        archived: userCards.filter(c => c.status === 'archived').length,
        dueToday: userCards.filter(c => {
          if (!c.nextReviewAt) return false;
          return new Date(c.nextReviewAt) <= new Date();
        }).length,
      };
      
      res.json({ data: stats });
    } catch (error) {
      logger.error('Error loading stats for Mini App', error);
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  app.get('/api/miniapp/settings/reminders', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;

    try {
      const settings = await withDbRetry(() => store.getUserReminderSettings(userId));
      res.json({ data: settings });
    } catch (error) {
      logger.error('Error loading reminder settings for Mini App', error);
      res.status(500).json({ error: 'Failed to load reminder settings' });
    }
  });

  app.post('/api/miniapp/settings/reminders', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;
    const settings = parseReminderSettings(req.body);
    if (!settings) {
      res.status(400).json({ error: 'Некорректные настройки напоминаний' });
      return;
    }

    try {
      const updated = await withDbRetry(() =>
        store.updateUserReminderSettings(userId, settings),
      );
      res.json({ ok: true, data: updated });
    } catch (error) {
      logger.error('Error updating reminder settings for Mini App', error);
      res.status(500).json({ error: 'Failed to update reminder settings' });
    }
  });

  app.post(
    '/api/miniapp/reminders/rebalance/preview',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const options = parseRebalanceOptions(req.body);
      try {
        const preview = await withDbRetry(() =>
          store.previewReminderRebalance(userId, options),
        );
        res.json({ data: preview });
      } catch (error) {
        logger.error('Error building reminder rebalance preview for Mini App', error);
        res.status(500).json({ error: 'Failed to build rebalance preview' });
      }
    },
  );

  app.post(
    '/api/miniapp/reminders/rebalance/apply',
    requireMiniAppAuth,
    requireMiniAppOwner,
    async (req, res) => {
      const userId = (req as any).userId;
      const changes = parseRebalanceChanges(req.body);
      if (!changes) {
        res.status(400).json({ error: 'Invalid rebalance changes' });
        return;
      }
      try {
        const result = await withDbRetry(() =>
          store.applyReminderRebalance(userId, changes),
        );
        res.json({ ok: true, data: result });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to apply rebalance plan';
        logger.error('Error applying reminder rebalance for Mini App', error);
        if (message.includes('changed since preview') || message.includes('no longer movable')) {
          res.status(409).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
      }
    },
  );

  app.post('/api/miniapp/cards/:id/status', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;
    const cardId = req.params.id;
    const status = req.body?.status as CardStatus | undefined;
    
    if (!cardId) {
      res.status(400).json({ error: 'Card ID required' });
      return;
    }
    
    if (!status || !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    
    try {
      // Verify card belongs to user
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (!isPersonalMiniAppCard(card, userId)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      
      await withDbRetry(() => store.updateStatus(cardId, status));
      res.json({ ok: true });
    } catch (error) {
      logger.error('Error updating card status for Mini App', error);
      res.status(500).json({ error: 'Failed to update status' });
    }
  });

  app.post('/api/miniapp/cards/:id/send-reminder', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;
    const cardId = req.params.id;

    if (!cardId) {
      res.status(400).json({ error: 'Card ID required' });
      return;
    }

    try {
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (!isPersonalMiniAppCard(card, userId)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      logger.info(
        `[MiniApp send-reminder] request card=${cardId} user=${userId} status=${card.status} base=${card.baseChannelMessageId ?? 'null'} pending=${card.pendingChannelMessageId ?? 'null'} awaiting=${card.awaitingGradeSince ?? 'null'}`,
      );
      await scheduler.triggerImmediate(cardId);
      logger.info(`[MiniApp send-reminder] completed card=${cardId} user=${userId}`);
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось отправить напоминание';
      logger.error('Error sending immediate reminder for Mini App', error);

      if (message.includes('Карточка ещё не активирована')) {
        res.status(409).json({ error: message });
        return;
      }

      if (message.includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }

      res.status(500).json({ error: message });
    }
  });

  app.post('/api/miniapp/cards/:id/one-time-reminder', requireMiniAppAuth, async (req, res) => {
    const userId = (req as any).userId;
    const cardId = req.params.id;
    const remindAt = req.body?.remindAt;

    if (!cardId) {
      res.status(400).json({ error: 'Card ID required' });
      return;
    }

    if (!isIsoDate(remindAt)) {
      res.status(400).json({ error: 'Некорректная дата напоминания' });
      return;
    }

    if (new Date(remindAt).getTime() <= Date.now()) {
      res.status(400).json({ error: 'Дата напоминания должна быть в будущем' });
      return;
    }

    try {
      const card = await withDbRetry(() => store.getCardById(cardId));
      if (!isPersonalMiniAppCard(card, userId)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (card.status === 'pending') {
        res.status(409).json({ error: 'Карточка ещё не активирована' });
        return;
      }
      if (card.status === 'archived') {
        res.status(409).json({ error: 'Карточка архивирована' });
        return;
      }

      const job = await withDbRetry(() =>
        store.createReminderJob({
          cardId: card.id,
          userId: card.userId,
          kind: 'one_time',
          dueAt: remindAt,
          source: 'miniapp_one_time',
        }),
      );
      res.json({ ok: true, data: job });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось назначить напоминание';
      logger.error('Error creating one-time reminder for Mini App', error);
      res.status(500).json({ error: message });
    }
  });

  // Serve static files (including Mini App assets) - must be before auth middleware
  app.use(
    '/miniapp',
    express.static(path.join(publicDir, 'miniapp'), {
      etag: false,
      lastModified: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      },
    }),
  );
  app.use(express.static(publicDir));

  app.get('/api/agent/backlog', requireAgentApiAuth, async (req, res) => {
    const status = req.query.status as BacklogItemStatus | undefined;
    const limit = parseLimit(req.query.limit, 100);
    if (status && !allowedBacklogStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid backlog status' });
      return;
    }
    try {
      const items = await withDbRetry(() => store.listBacklogItems({ status, limit }));
      res.json({
        data: items,
        count: items.length,
      });
    } catch (error) {
      logger.error('Ошибка чтения agent backlog API', error);
      res.status(500).json({ error: 'Failed to load backlog' });
    }
  });

  // Dashboard routes (require dashboard auth)
  app.use(requireDashboardAuth);

  app.get('/api/cards', async (req, res) => {
    const status = req.query.status as CardStatus | undefined;
    const limit = parseLimit(req.query.limit, 100);
    if (status && !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Неверный статус' });
      return;
    }
    try {
      const cards = await withDbRetry(() => store.listCards({ status, limit }));
      res.json({ data: cards });
    } catch (error) {
      logger.error('Ошибка чтения карточек', error);
      res.status(500).json({ error: 'Не удалось загрузить карточки' });
    }
  });

  app.get('/api/backlog', async (req, res) => {
    const status = req.query.status as BacklogItemStatus | undefined;
    const limit = parseLimit(req.query.limit, 100);
    if (status && !allowedBacklogStatuses.includes(status)) {
      res.status(400).json({ error: 'Неверный статус бэклога' });
      return;
    }
    try {
      const items = await withDbRetry(() => store.listBacklogItems({ status, limit }));
      res.json({ data: items });
    } catch (error) {
      logger.error('Ошибка чтения бэклога', error);
      res.status(500).json({ error: 'Не удалось загрузить бэклог' });
    }
  });

  app.get('/api/cards/:id/media', async (req, res) => {
    try {
      const card = await withDbRetry(() => store.getCardById(req.params.id));
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
      await withDbRetry(() => store.rescheduleCard(req.params.id, nextReviewAt));
      res.json({ ok: true, nextReviewAt });
    } catch (error) {
      logger.error('Ошибка переноса карточки', error);
      res.status(500).json({ error: 'Не удалось перенести карточку' });
    }
  });

  app.post('/api/cards/:id/force-review', async (req, res) => {
    try {
      logger.info(`[Dashboard force-review] request card=${req.params.id}`);
      await scheduler.triggerImmediate(req.params.id);
      logger.info(`[Dashboard force-review] completed card=${req.params.id}`);
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
      await withDbRetry(() => store.overrideNextReview(req.params.id, nextReviewAt));
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
      await withDbRetry(() => store.updateStatus(req.params.id, status));
      res.json({ ok: true });
    } catch (error) {
      logger.error('Ошибка смены статуса', error);
      res.status(500).json({ error: 'Не удалось обновить статус' });
    }
  });

  app.delete('/api/cards/:id', async (req, res) => {
    try {
      await withDbRetry(() => store.deleteCard(req.params.id));
      res.json({ ok: true });
    } catch (error) {
      logger.error('Ошибка удаления карточки', error);
      res.status(500).json({ error: 'Не удалось удалить карточку' });
    }
  });

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

type AuthSignInPageOptions = {
  next: string;
  publicBaseUrl: string;
  googleEnabled: boolean;
  telegramLoginBotUsername: string | null;
  error?: string;
};

const renderAuthSignInPage = (options: AuthSignInPageOptions) => {
  const telegramWidget = options.telegramLoginBotUsername
    ? renderTelegramLoginWidget({
        botUsername: options.telegramLoginBotUsername,
        authUrl: `${options.publicBaseUrl}/auth/telegram/callback`,
      })
    : '<p class="muted">Telegram web-login включится после настройки TELEGRAM_LOGIN_BOT_USERNAME и домена у BotFather.</p>';
  const googleButton = options.googleEnabled
    ? `<a class="button" href="/auth/google?next=${encodeURIComponent(options.next)}">Войти через Google</a>`
    : '<p class="muted">Google login включится после настройки GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET.</p>';
  const errorMessage = options.error
    ? `<p class="error">${escapeHtml(authErrorLabel(options.error))}</p>`
    : '';

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Личный кабинет</title>
    ${renderAccountStyles()}
  </head>
  <body>
    <main class="auth-card">
      <p class="eyebrow">Interval Learn Bot</p>
      <h1>Личный кабинет</h1>
      <p class="lead">Войдите через Telegram или Google. После входа можно подключить второй способ.</p>
      ${errorMessage}
      <div class="actions">
        ${googleButton}
        <div class="telegram-box">${telegramWidget}</div>
      </div>
      <a class="secondary-link" href="/login">Админская панель по секрету</a>
    </main>
  </body>
</html>`;
};

type AccountPageOptions = {
  user: AppUserRecord;
  accounts: UserAuthAccountRecord[];
  publicBaseUrl: string;
  googleEnabled: boolean;
  telegramLoginBotUsername: string | null;
  error?: string;
};

const renderAccountPage = (options: AccountPageOptions) => {
  const googleConnected = options.accounts.some((account) => account.provider === 'google');
  const telegramConnected = options.accounts.some((account) => account.provider === 'telegram');
  const telegramAccount = options.accounts.find((account) => account.provider === 'telegram');
  const displayName = options.user.displayName || options.user.email || 'Пользователь';
  const errorMessage = options.error
    ? `<p class="error">${escapeHtml(authErrorLabel(options.error))}</p>`
    : '';
  const telegramWidget = !telegramConnected && options.telegramLoginBotUsername
    ? renderTelegramLoginWidget({
        botUsername: options.telegramLoginBotUsername,
        authUrl: `${options.publicBaseUrl}/auth/telegram/callback`,
      })
    : '';

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Аккаунт</title>
    ${renderAccountStyles()}
  </head>
  <body>
    <main class="account-shell">
      <section class="panel profile-panel">
        <div>
          <p class="eyebrow">Личный кабинет</p>
          <h1>${escapeHtml(displayName)}</h1>
          <p class="lead">${escapeHtml(options.user.email || 'Telegram account')}</p>
        </div>
        <form method="post" action="/auth/logout">
          <button class="ghost-button" type="submit">Выйти</button>
        </form>
      </section>

      ${errorMessage}

      <section class="panel">
        <h2>Подключённые входы</h2>
        <div class="provider-list">
          ${renderProviderRow({
            title: 'Telegram',
            connected: telegramConnected,
            detail: telegramConnected
              ? `ID ${telegramAccount?.providerAccountId ?? options.user.primaryTelegramUserId ?? ''}`
              : 'Нужен для привязки напоминаний и Mini App.',
            action: telegramConnected
              ? ''
              : telegramWidget || '<span class="muted">Настройте TELEGRAM_LOGIN_BOT_USERNAME.</span>',
          })}
          ${renderProviderRow({
            title: 'Google',
            connected: googleConnected,
            detail: googleConnected ? 'Можно входить через Google.' : 'Можно подключить как второй способ входа.',
            action: googleConnected
              ? ''
              : options.googleEnabled
                ? '<a class="button small" href="/auth/google?next=/account">Подключить Google</a>'
                : '<span class="muted">Настройте GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET.</span>',
          })}
        </div>
      </section>

      <section class="panel">
        <h2>Ссылки</h2>
        <div class="link-grid">
          <a class="button secondary" href="/miniapp">Открыть Mini App</a>
          <a class="button secondary" href="/auth/signin">Страница входа</a>
          <a class="button secondary" href="/login">Админская панель</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
};

const renderTelegramLoginWidget = ({
  botUsername,
  authUrl,
}: {
  botUsername: string;
  authUrl: string;
}) => `
<script async src="https://telegram.org/js/telegram-widget.js?22"
  data-telegram-login="${escapeHtml(botUsername)}"
  data-size="large"
  data-auth-url="${escapeHtml(authUrl)}"
  data-request-access="write"></script>`;

const renderProviderRow = ({
  title,
  connected,
  detail,
  action,
}: {
  title: string;
  connected: boolean;
  detail: string;
  action: string;
}) => `
<div class="provider-row">
  <div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(detail)}</p>
  </div>
  <div class="provider-action">
    ${connected ? '<span class="status connected">Подключено</span>' : action}
  </div>
</div>`;

const authErrorLabel = (code: string) => {
  const labels: Record<string, string> = {
    google_not_configured: 'Google login пока не настроен.',
    google_auth_failed: 'Не удалось войти через Google.',
    telegram_auth_failed: 'Не удалось войти через Telegram.',
    account_already_linked: 'Этот внешний аккаунт уже привязан к другому пользователю.',
  };
  return labels[code] ?? 'Не удалось выполнить вход.';
};

const renderAccountStyles = () => `
<style>
  :root { color-scheme: light; --bg: #f5f5f0; --panel: #ffffff; --text: #1f2933; --muted: #6b7280; --border: #d9d9d2; --accent: #111827; --accentText: #ffffff; --danger: #b42318; --ok: #047857; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .auth-card { width: min(100% - 32px, 440px); margin: 12vh auto 0; padding: 28px; border: 1px solid var(--border); border-radius: 18px; background: var(--panel); box-shadow: 0 18px 50px rgba(17,24,39,.08); }
  .account-shell { width: min(100% - 32px, 760px); margin: 32px auto; display: grid; gap: 14px; }
  .panel { border: 1px solid var(--border); border-radius: 18px; background: var(--panel); padding: 22px; }
  .profile-panel { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .eyebrow { margin: 0 0 8px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
  h1 { margin: 0; font-size: 30px; line-height: 1.1; }
  h2 { margin: 0 0 14px; font-size: 18px; }
  h3 { margin: 0 0 4px; font-size: 15px; }
  .lead, .provider-row p, .muted { color: var(--muted); font-size: 14px; line-height: 1.45; }
  .lead { margin: 10px 0 0; }
  .actions { display: grid; gap: 14px; margin-top: 22px; }
  .telegram-box { min-height: 44px; display: flex; align-items: center; }
  .button, button { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; border-radius: 12px; border: 1px solid var(--accent); background: var(--accent); color: var(--accentText); padding: 0 16px; font-size: 14px; font-weight: 700; text-decoration: none; cursor: pointer; }
  .button.small { min-height: 36px; font-size: 13px; }
  .button.secondary, .ghost-button { border-color: var(--border); background: transparent; color: var(--text); }
  .secondary-link { display: inline-flex; margin-top: 18px; color: var(--muted); font-size: 13px; }
  .provider-list { display: grid; gap: 10px; }
  .provider-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; min-height: 64px; padding: 12px; border: 1px solid var(--border); border-radius: 14px; }
  .provider-row p { margin: 0; }
  .provider-action { display: flex; justify-content: flex-end; }
  .status { display: inline-flex; min-height: 30px; align-items: center; border-radius: 999px; padding: 0 10px; font-size: 12px; font-weight: 700; }
  .connected { color: var(--ok); background: #ecfdf3; }
  .error { color: var(--danger); margin: 14px 0 0; font-size: 14px; }
  .link-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  @media (max-width: 540px) { .profile-panel, .provider-row { grid-template-columns: 1fr; display: grid; } .provider-action { justify-content: flex-start; } }
</style>`;

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
