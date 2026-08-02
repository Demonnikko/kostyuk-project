# Деплой KOSTYUK PROJECT на Timeweb Cloud App Platform

Цель: перенести сайт с Vercel на Timeweb без смены домена.

## Что подготовлено

- `server.js` — production-сервер на Node.js.
- `Dockerfile` — запуск в Timeweb App Platform.
- Статика отдаётся из корня проекта.

### API

`server.js` обслуживает тот же набор эндпоинтов, что и Vercel: собственные
маршруты (`/api/prices`, `/api/lead`, `/api/lead-concert`, `/api/chat`,
`/api/admin-chats`, `/healthz`) плюс всё из `api/_endpoints/` через общий
роутер `api/[endpoint].js` — билеты, рассадка, брони, админка, Т-Банк.

Добавили новый эндпоинт в `api/_endpoints/` — впишите его в `api/[endpoint].js`,
и он заработает сразу на обеих платформах.

## Переменные окружения

### Обязательные

Без них билетная система не работает:

```text
FIREBASE_DB_URL=
FIREBASE_SECRET=
TICKET_PUBLIC_ORIGIN=      # публичный адрес сайта, напр. https://kostyuk.ru
ADMIN_TOKEN=
TICKET_LINK_SECRET=
```

> `FIREBASE_DB_URL` больше не имеет значения по умолчанию. Если переменная
> не задана, сервер пишет в лог `[firebase] FIREBASE_DB_URL не задан` —
> проверяйте логи после первого запуска.

### Уведомления о заявках

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_ADMIN_CHAT_ID=
```

### Опционально

```text
DEEPSEEK_API_KEY=          # чат-ассистент; без него отвечает резервная логика
DEEPSEEK_MODEL=deepseek-chat
YM_HULIGAN_COUNTER_ID=     # Яндекс.Метрика
YM_SECRET_COUNTER_ID=
```

### Т-Банк — при подключении эквайринга

```text
TBANK_TERMINAL_KEY=
TBANK_TERMINAL_PASSWORD=
TBANK_HULIGAN_ENABLED=true
TBANK_FORCE_TEST_MODE=false
```

Полный список — в `.env.example`.

## Настройки приложения в Timeweb

1. Timeweb Cloud → App Platform → создать приложение.
2. Источник: GitHub-репозиторий проекта.
3. Ветка: `main`.
4. Способ запуска: Dockerfile.
5. Порт: `3000`.
6. Healthcheck: `/healthz`.
7. Прописать переменные окружения (см. выше).
8. Сначала технический домен Timeweb, после проверки — свой через DNS.

## Проверка после деплоя

```bash
curl https://<домен>/healthz
```

```bash
curl -X POST https://<домен>/api/huligan -H 'Content-Type: application/json' -d '{"action":"get_config"}'
```

Первый должен вернуть `{"ok":true}`, второй — конфигурацию шоу. Если во
втором пусто или ошибка — проверьте `FIREBASE_DB_URL` и `FIREBASE_SECRET`
в логах приложения.

Домен и хостинг независимы: переезд не требует смены домена.
