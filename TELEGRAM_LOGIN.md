# Вход через Telegram

## 1. BotFather

В **Login Widget** у бота добавьте два Allowed URL:

- `https://kuzmafor.github.io/VerbaIDEapp/`
- `https://jxunxxlsrcakeizfjzrr.supabase.co/functions/v1/telegram-login`

Не публикуйте и не добавляйте в GitHub Bot Token и Client Secret.

## 2. Secrets в Supabase

В Supabase Dashboard откройте **Edge Functions → Secrets** и добавьте:

| Secret | Значение |
| --- | --- |
| `TELEGRAM_CLIENT_ID` | Client ID из BotFather |
| `TELEGRAM_CLIENT_SECRET` | Client Secret из BotFather |
| `TELEGRAM_STATE_SECRET` | новая длинная случайная строка (не менее 32 символов) |
| `APP_REDIRECT_URL` | `https://kuzmafor.github.io/VerbaIDEapp/` |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` доступны Edge Function на стороне Supabase. Service Role key никуда не копируйте в приложение.

## 3. Deploy Edge Function

Установите Supabase CLI и выполните из корня проекта:

```bash
supabase login
supabase link --project-ref jxunxxlsrcakeizfjzrr
supabase functions deploy telegram-login
```

В Supabase **Authentication → URL Configuration** добавьте `https://kuzmafor.github.io/VerbaIDEapp/` в Redirect URLs.

После deploy кнопка **Telegram** откроет безопасный OAuth-вход. Проверка Telegram-токена и создание сессии выполняются только на сервере.
