import path from 'node:path';
import { Readable } from 'node:stream';
import dayjs from 'dayjs';
import express from 'express';
import { Telegraf } from 'telegraf';
import { fetch } from 'undici';
import { CardStatus, CardStore } from './db';
import { config } from './config';
import { logger } from './logger';
import { ReviewScheduler } from './reviewScheduler';

const publicDir = path.join(process.cwd(), 'public');

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

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/api/cards', (req, res) => {
    const status = req.query.status as CardStatus | undefined;
    const limit = parseLimit(req.query.limit, 100);
    if (status && !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Неверный статус' });
      return;
    }
    try {
      const cards = store.listCards({ status, limit });
      res.json({ data: cards });
    } catch (error) {
      logger.error('Ошибка чтения карточек', error);
      res.status(500).json({ error: 'Не удалось загрузить карточки' });
    }
  });

  app.get('/api/cards/:id/media', async (req, res) => {
    try {
      const card = store.getCardById(req.params.id);
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
      res.status(500).json({ error: 'Не удалось загрузить медиа' });
    }
  });

  app.post('/api/cards/:id/reschedule', (req, res) => {
    const minutes = parseMinutes(req.body?.minutes, 60);
    const nextReviewAt = dayjs().add(Math.max(1, minutes), 'minute').toISOString();
    try {
      store.rescheduleCard(req.params.id, nextReviewAt);
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

  app.post('/api/cards/:id/next-review', (req, res) => {
    const nextReviewAt = req.body?.nextReviewAt;
    if (!isIsoDate(nextReviewAt)) {
      res.status(400).json({ error: 'Некорректная дата' });
      return;
    }
    try {
      store.overrideNextReview(req.params.id, nextReviewAt);
      res.json({ ok: true, nextReviewAt });
    } catch (error) {
      logger.error('Ошибка ручного планирования', error);
      res.status(500).json({ error: 'Не удалось обновить дату' });
    }
  });

  app.post('/api/cards/:id/status', (req, res) => {
    const status = req.body?.status as CardStatus | undefined;
    if (!status || !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Статус обязателен' });
      return;
    }
    try {
      store.updateStatus(req.params.id, status);
      res.json({ ok: true });
    } catch (error) {
      logger.error('Ошибка смены статуса', error);
      res.status(500).json({ error: 'Не удалось обновить статус' });
    }
  });

  app.delete('/api/cards/:id', (req, res) => {
    try {
      store.deleteCard(req.params.id);
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
