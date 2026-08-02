# Деплой KOSTYUK PROJECT на Timeweb Cloud App Platform

Цель: перенести сайт с Vercel на Timeweb без смены домена и проверить стабильность открытия в России.

## Что подготовлено

- `server.js` — production-сервер на Node.js.
- `Dockerfile` — универсальный запуск в Timeweb App Platform.
- Статика отдаётся из текущей папки сайта.
- Поддержаны API, которые использует сайт:
  - `GET /api/prices`
  - `POST /api/lead`
  - `POST /api/lead-concert`
  - `POST /api/chat`
  - `GET /api/admin-chats`
  - `GET /healthz`

## Переменные окружения в Timeweb

Обязательные для заявок:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Опционально для чата Екатерины:

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-chat
```

Опционально для Метрики:

```text
YANDEX_COUNTER_ID=107696179
```

Если `DEEPSEEK_API_KEY` не задан, чат не ломает сайт, а отвечает резервной короткой логикой.
Если `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` не заданы, формы возвращают успешный ответ для интерфейса, но заявка не отправляется в Telegram.

## Настройки приложения в Timeweb

1. Timeweb Cloud → App Platform → создать приложение.
2. Источник: GitHub-репозиторий с этим проектом.
3. Ветка: `main` или нужная production-ветка.
4. Способ запуска: Dockerfile.
5. Порт приложения: `3000`.
6. Healthcheck: `/healthz`.
7. Сначала использовать технический домен Timeweb.
8. После проверки скорости и стабильности подключить текущий домен через DNS.

Переход на домен `.ru` не нужен: домен и хостинг независимы.
