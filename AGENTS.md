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

## Метод проверки UI-регрессий

- Не выводи состояние UI только из сборки или server logs: открой реальный runtime и проверь console.
- Сначала докажи, что клиентский JS стартовал, затем кликай критичные элементы и сверяй видимое состояние.
- Отделяй ожидаемые ошибки внешнего контекста/авторизации от поломки bootstrap или навигации.
- Для локальной проверки Mini App не запускай второй `bot.launch()`: подними только HTTP-сервер на отдельном `PORT`, чтобы не дублировать Telegram polling.

```bash
PORT=3107 npx tsx -e 'import { config } from "./src/config"; import { CardStore } from "./src/db"; import { createBot } from "./src/bot"; import { ReviewScheduler } from "./src/reviewScheduler"; import { createHttpServer } from "./src/httpServer"; (async () => { const store = new CardStore(config.databaseUrl); await store.init(); const bot = createBot(store); const scheduler = new ReviewScheduler(store, bot); const server = createHttpServer(store, scheduler, bot); const shutdown = async () => { server.close(); await store.close(); process.exit(0); }; process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown); })().catch((error) => { console.error(error); process.exit(1); });'
```

## Жизненный цикл карточки

`pending` → `learning` → `awaiting_grade` → (повтор или `archived`)

## Команды

```bash
npm run dev      # запуск в dev-режиме
npm run build    # компиляция
npm run migrate  # миграции БД
```
