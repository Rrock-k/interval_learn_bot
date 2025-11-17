# Interval Learn Bot

Телеграм-бот, который принимает ваши сообщения и формирует интервальные повторения в указанном канале. Поддерживает текст, фото и видео, хранит состояние в PostgreSQL и реализует алгоритм SM-2 с кнопками «Снова / Сложно / Хорошо / Легко». В комплекте — веб-панель для просмотра/управления базой.

## Возможности
- Ответ на каждое входящее сообщение инлайн-кнопками «Добавить в обучение / Отмена».
- Сохранение исходного сообщения и пересылка его в канал по расписанию (через webhook не требуется — используется long polling).
- Кнопки с оценкой интервала прямо под постом в канале; результат влияет на следующую дату повторения.
- Встроенный веб-интерфейс (http://localhost:3000) для просмотра карточек, ускорения повторов, отложенных напоминаний и удаления записей (доступ после ввода `DASHBOARD_SECRET`).
- Консольное логирование, `.env` для локальной разработки и GitHub Secrets/переменные Railway для продакшена.

## Требования
- Node.js 18+
- Доступный PostgreSQL (например Railway Postgres или локальный контейнер)
- Переменные окружения:
  - `BOT_TOKEN` — токен Telegram-бота от BotFather.
  - `CHAT_ID` — ID канала, куда бот будет публиковать напоминания (формат `-100...`).
  - `DASHBOARD_SECRET` — пароль, который нужно ввести при попадании в панель.
  - `DATABASE_URL` — строка подключения к PostgreSQL (`postgresql://user:password@host:5432/db`).
  - `PORT` — порт веб-интерфейса (по умолчанию 3000).
  - Необязательно: `INITIAL_REVIEW_MINUTES`, `REVIEW_SCAN_INTERVAL_MS`, `REVIEW_BATCH_SIZE`, `AWAITING_GRADE_TIMEOUT_MS`, `AWAITING_GRADE_RETRY_MINUTES`.

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

Откройте `http://localhost:3000` — отобразится страница входа. Введите значение `DASHBOARD_SECRET`, после чего появится дашборд с фильтрами, отложенными повторами и удалением карточек.

## Архитектура
- `src/bot.ts` — обработчики Telegram: intake сообщений, подтверждение добавления, обработка оценок.
- `src/db.ts` — слой хранения на PostgreSQL (карточки и статусы повторений).
- `src/reviewScheduler.ts` — периодическая проверка `next_review_at` и публикация карточек в канал.
- `src/spacedRepetition.ts` — SM-2 с поддержкой 4 оценок.
- `src/httpServer.ts` — Express-сервер с REST API и раздачей `public/dashboard.html`.
- `src/index.ts` — точка входа, связывает бота, БД и планировщик.

## Railway деплой

В репозитории добавлены `Dockerfile`, `.dockerignore` и `railway.json`, поэтому Railway распознаёт проект как Docker-сервис и запускает `npm ci → npm run build → npm start` внутри контейнера. Краткий план:

1. Опубликуйте репозиторий на GitHub и создайте проект в [Railway](https://railway.app/) → **Deploy from GitHub repo**.
2. Railway автоматически возьмёт Dockerfile и соберёт образ (это зафиксировано в `railway.json`).
3. В разделе **Variables** задайте `BOT_TOKEN`, `CHAT_ID`, `DASHBOARD_SECRET`, при необходимости `INITIAL_REVIEW_MINUTES`, `REVIEW_SCAN_INTERVAL_MS`, `REVIEW_BATCH_SIZE`, `AWAITING_GRADE_TIMEOUT_MS`, `AWAITING_GRADE_RETRY_MINUTES` и/или `PORT`.
4. После первого деплоя проверьте `https://<service>.up.railway.app/healthz` — ответ `{"ok": true, ...}` подтверждает, что бот и планировщик работают.

Полный пошаговый гид со скриншотами CLI-команд находится в `docs/railway-deploy.md`. Там же описаны нюансы интеграции с Railway Postgres и сценарии обновлений.

## Скрипты
- `npm run dev` — запуск в режиме разработки (hot reload).
- `npm run lint` — проверка типов TypeScript.
- `npm run build` — компиляция в `dist/`.
- `npm start` — запуск продакшн-сборки.

## Дополнительно
- `docs/clarification-questions.md` — финализированное ТЗ и ответы на вопросы.
- `docs/hosting-options.md` — сравнительная таблица бесплатных хостингов.
- `docs/railway-deploy.md` — детальная инструкция по публикации на Railway.
- `docs/fly-deploy.md` — пошаговый гид по развёртыванию на Fly.io.
