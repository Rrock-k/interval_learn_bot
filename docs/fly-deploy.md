# Деплой Interval Learn Bot на Fly.io

Fly.io позволяет держать постоянно работающий контейнер (long polling + фоновый планировщик), поэтому бот не «засыпает» как на serverless тарифах. Ниже пошаговый сценарий переноса.

## 1. Установка `flyctl`

```bash
curl -L https://fly.io/install.sh | sh
fly auth signup   # зарегистрируйтесь и подтвердите карту
# или войдите, если аккаунт уже есть
fly auth login
```

Проверьте версию:

```bash
fly version
```

## 2. Создание приложения

В корне репозитория уже лежит `fly.toml`. Обновите поле `app = "interval-learn-bot"` на уникальное имя или позвольте `fly launch` сделать это автоматически:

```bash
fly launch --copy-config --no-deploy
# выберите регион (например fra/ams/waw) и подтвердите использование существующего Dockerfile
```

Команда создаст приложение без моментального деплоя. Файл `fly.toml` останется в репозитории для повторных запусков.

## 3. Переменные окружения / секrets

Fly хранит секреты отдельно:

```bash
fly secrets set BOT_TOKEN=123:token CHAT_ID=-100123 DASHBOARD_SECRET=supersecret
fly secrets set DATABASE_URL="postgresql://user:pass@host:5432/dbname"
```

### База данных

- **Использовать существующий Railway Postgres.** Просто передайте его `DATABASE_URL` в секрете. В этом случае никаких дополнительных действий не требуется.
- **Поднять Fly Postgres.**
  ```bash
  fly pg create --name interval-learn-db --region fra --initial-cluster-size 1
  fly pg attach interval-learn-db
  ```
  После `attach` Fly автоматически добавит `DATABASE_URL`/`DATABASE_USER` и т. п. в секреты приложения.

## 4. Деплой

```bash
fly deploy
```

Fly соберёт Docker-образ из нашего `Dockerfile` и запустит постоянную машину (`min_machines_running = 1`, `auto_stop_machines = false`). Процесс long polling + ReviewScheduler будет жить 24/7.

Проверить статус:

```bash
fly status
fly logs
fly open  # откроет https://<app>.fly.dev/
```

Health-check доступен по `/healthz`.

## 5. Масштабирование и ресурсы

По умолчанию используется `shared-cpu-1x` с 256МБ RAM. При необходимости увеличьте:

```bash
fly scale vm shared-cpu-1x --memory 512
```

Fly Free Allowance покрывает ~3 таких VM-часа (1 постоянно работающая машина). Следите за лимитами в панели.

## 6. Обновления

Любой `fly deploy` из репозитория создаёт новую ревизию. Секреты остаются, поэтому достаточно запустить команду после изменений в коде. Для отката:

```bash
fly releases
fly deploy --strategy immediate --image <release-image>
```

Теперь бот и планировщик будут работать без принудительного сна, а панель доступна по `https://<app>.fly.dev/`. Если нужно держать несколько регионов или auto-scaling, добавьте дополнительные [[vm]] блоки в `fly.toml` или воспользуйтесь `fly scale count`. 
