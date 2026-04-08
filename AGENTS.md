# Agent Guide

Telegram-бот для интервального повторения (SM-2). TypeScript + Express + Telegraf + PostgreSQL (Drizzle ORM).

## Структура

- `src/index.ts` — точка входа
- `src/bot.ts` — обработчики Telegram (приём сообщений, кнопки оценки)
- `src/httpServer.ts` — Express: REST API + статика
- `src/db.ts` — CardStore (CRUD карточек)
- `src/db/schema.ts` — схема БД (users, cards)
- `src/spacedRepetition.ts` — алгоритм SM-2
- `src/reviewScheduler.ts` — периодическая публикация карточек на повторение
- `public/dashboard.html` — веб-панель управления
- `public/miniapp/` — Telegram Mini App (карточки, календарь, статистика)

## Аутентификация

- **Mini App**: `/api/miniapp/*` — `requireMiniAppAuth` (Telegram initData)
- **Dashboard**: `/api/cards/*` — `requireDashboardAuth` (DASHBOARD_SECRET)
- Никогда не вызывай Dashboard-эндпоинты из Mini App (вернёт 302).

## Жизненный цикл карточки

`pending` → `learning` → `awaiting_grade` → (повтор или `archived`)

## Команды

```bash
npm run dev      # запуск в dev-режиме
npm run build    # компиляция
npm run migrate  # миграции БД
```
