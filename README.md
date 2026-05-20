# Interval Learn Bot

Телеграм-бот, который принимает ваши сообщения и формирует интервальные повторения в указанном канале. Поддерживает текст, фото и видео, хранит состояние в PostgreSQL и реализует алгоритм SM-2 с кнопками «Снова / Сложно / Хорошо / Легко». В комплекте — веб-панель для просмотра/управления базой.

## Возможности
- Ответ на каждое входящее сообщение инлайн-кнопками «Добавить в обучение / Отмена».
- Для владельца Telegram user id доступна кнопка «В бэклог агента»: запись сохраняется отдельно и не становится напоминанием.
- Сохранение исходного сообщения и пересылка его в канал по расписанию (через webhook не требуется — используется long polling).
- Кнопки с оценкой интервала прямо под постом в канале; результат влияет на следующую дату повторения.
- Встроенный веб-интерфейс (http://localhost:3000) для просмотра карточек, ускорения повторов, отложенных напоминаний и удаления записей (доступ после ввода `DASHBOARD_SECRET`).
- Личный кабинет с каталогом курсов: пользователи могут войти через Telegram/Google, создать короткий курс вручную или через LLM-чат, опубликовать его в маркетплейсе и запустить публичный курс себе в очередь напоминаний.
- Консольное логирование, `.env` для локальной разработки и GitHub Secrets/переменные Railway для продакшена.

## Требования
- Node.js 18+
- Доступный PostgreSQL (например Railway Postgres или локальный контейнер)
- Переменные окружения:

### Обязательные
  - `BOT_TOKEN` — токен Telegram-бота от BotFather.
  - `CHAT_ID` — ID канала, куда бот будет публиковать напоминания (формат `-100...`).
  - `DASHBOARD_SECRET` — пароль для доступа к веб-панели.
  - `DATABASE_URL` — строка подключения к PostgreSQL (`postgresql://user:password@host:5432/db`).

### Необязательные
  - `PORT` — порт веб-интерфейса (по умолчанию `3000`).
  - `ADMIN_CHAT_ID` — ID чата для уведомлений администратора о новых пользователях.
  - `ADMIN_CHAT_TOPIC_ID` — ID топика в админ-чате (если используется).
  - `INITIAL_REVIEW_MINUTES` — минуты до первого повторения (по умолчанию `60`).
  - `REVIEW_SCAN_INTERVAL_MS` — интервал проверки карточек в мс (по умолчанию `60000` = 1 минута).
  - `REVIEW_BATCH_SIZE` — количество карточек за раз (по умолчанию `5`).
  - `BACKLOG_OWNER_USER_ID` — Telegram user id владельца, которому доступна кнопка «В бэклог агента» (по умолчанию `359367655`).
  - `AGENT_API_TOKEN` — включает read-only API агента `/api/agent/backlog`, если задан.
  - `PUBLIC_URL` — публичный домен сервиса, например `https://<service>.up.railway.app`; нужен для Mini App и OAuth callback.
  - `WEB_SESSION_SECRET` — отдельный секрет web-сессий личного кабинета; если не задан, используется `DASHBOARD_SECRET`.
  - `TELEGRAM_LOGIN_BOT_USERNAME` — username бота без `@` для входа через Telegram Login Widget.
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth-клиент Google для входа через Google.
  - `COURSE_AUTHORING_LLM_API_KEY` или `OPENAI_API_KEY` — ключ OpenAI-compatible провайдера для LLM-создания курсов; без ключа включается локальный fallback-черновик.
  - `COURSE_AUTHORING_LLM_BASE_URL` — base URL OpenAI-compatible API (по умолчанию `https://api.openai.com/v1`).
  - `COURSE_AUTHORING_LLM_MODEL` — модель для LLM-создания курсов.

Создайте локальный `.env` на основе шаблона:

```bash
cp .env.example .env
# заполните BOT_TOKEN, CHAT_ID, DASHBOARD_SECRET и DATABASE_URL
```

## Локальный запуск

```bash
npm install
npm run dev          # запускает tsx watch

# либо собрать и запустить production-режим
npm run build
npm start
```

Данные сохраняются в PostgreSQL, схема создаётся автоматически при старте. Добавьте бота администратором в канал, указанный в `CHAT_ID`, чтобы он мог публиковать сообщения и обрабатывать нажатие кнопок.

Откройте `http://localhost:3000` — отобразится страница входа. Введите значение `DASHBOARD_SECRET`, после чего появится дашборд с фильтрами, бэклогом агента, отложенными повторами и удалением карточек.

Личный кабинет доступен по `/account`, вход — `/auth/signin`. Маркетплейс курсов доступен по `/courses`, создание курса через LLM-чат на базе ChatScope Chat UI Kit — `/courses/author`, ручное создание — `/courses/new`, список собственных курсов — `/my/courses`. Telegram login требует, чтобы публичный домен был указан у BotFather для Telegram Login Widget. Для Google OAuth callback укажите `${PUBLIC_URL}/auth/google/callback`.

## Архитектура
- `src/bot.ts` — обработчики Telegram: intake сообщений, подтверждение добавления, обработка оценок.
- `src/db.ts` — слой хранения на PostgreSQL (карточки и статусы повторений).
- `src/reviewScheduler.ts` — периодическая проверка `next_review_at` и публикация карточек в канал.
- `src/spacedRepetition.ts` — SM-2 с поддержкой 4 оценок.
- `src/httpServer.ts` — Express-сервер с REST API и раздачей `public/dashboard.html`.
- `src/courseAuthoring.ts` — независимый authoring-контракт для генерации черновиков курсов через LLM, MCP/API или fallback-провайдер.
- `src/index.ts` — точка входа, связывает бота, БД и планировщик.

## Railway деплой

В репозитории добавлены `Dockerfile`, `.dockerignore` и `railway.json`, поэтому Railway распознаёт проект как Docker-сервис и запускает `npm ci → npm run build → npm start` внутри контейнера. Краткий план:

1. Опубликуйте репозиторий на GitHub и создайте проект в [Railway](https://railway.app/) → **Deploy from GitHub repo**.
2. Railway автоматически возьмёт Dockerfile и соберёт образ (это зафиксировано в `railway.json`).
3. В разделе **Variables** задайте `BOT_TOKEN`, `CHAT_ID`, `DASHBOARD_SECRET`, при необходимости `INITIAL_REVIEW_MINUTES`, `REVIEW_SCAN_INTERVAL_MS`, `REVIEW_BATCH_SIZE`, `BACKLOG_OWNER_USER_ID` и/или `PORT`.
4. После первого деплоя проверьте `https://<service>.up.railway.app/healthz` — ответ `{"ok": true, ...}` подтверждает, что бот и планировщик работают.

Полный пошаговый гид со скриншотами CLI-команд находится в `docs/railway-deploy.md`. Там же описаны нюансы интеграции с Railway Postgres и сценарии обновлений.

## Логи

Продакшн-логи смотрятся в Railway: **Project → Service → Deployments → Logs** для конкретного деплоя или через CLI из связанного репозитория:

```bash
railway login
railway link
railway logs
```

Локально логи идут в stdout процесса `npm run dev` / `npm start`.

## Скрипты
- `npm run dev` — запуск в режиме разработки (hot reload).
- `npm run lint` — проверка типов TypeScript.
- `npm run build` — компиляция в `dist/`.
- `npm run authoring:dev` — отдельный dev-сервер LLM authoring UI; `/api/*` проксируется в основной Express-сервер на `http://127.0.0.1:3000` или `AUTHORING_API_PROXY_TARGET`.
- `npm run authoring:build` — сборка LLM authoring UI в `public/course-authoring`.
- `npm start` — запуск продакшн-сборки.

## Дополнительно
- `docs/clarification-questions.md` — финализированное ТЗ и ответы на вопросы.
- `docs/ideas-backlog.md` — продуктовый backlog идей до реализации.
- `docs/hosting-options.md` — сравнительная таблица бесплатных хостингов.
- `docs/railway-deploy.md` — детальная инструкция по публикации на Railway.
- `docs/fly-deploy.md` — пошаговый гид по развёртыванию на Fly.io.
