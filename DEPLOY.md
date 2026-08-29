# Публикация VerbaIDE на GitHub Pages

## GitHub Pages

1. Создайте пустой репозиторий GitHub и загрузите в него весь проект.
2. Откройте **Settings → Pages → Build and deployment**.
3. Выберите **GitHub Actions**. Workflow `.github/workflows/deploy-pages.yml`
   автоматически опубликует сайт после каждого `push` в ветку `main`.

Сайт будет доступен по адресу вида:
`https://USERNAME.github.io/REPOSITORY/`.

## Настройки Supabase в GitHub

В репозитории откройте **Settings → Secrets and variables → Actions** и добавьте
два secrets:

| Secret | Значение |
| --- | --- |
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ключ `sb_publishable_...` |

Никогда не добавляйте в GitHub Secrets для веб-сборки `service_role`, Bot Token
Telegram или ключ Resend: это серверные секреты.

## Собственный домен

1. В GitHub: **Settings → Pages → Custom domain** укажите домен.
2. Добавьте DNS-записи, которые покажет GitHub, у регистратора домена.
3. После проверки включите **Enforce HTTPS**.
4. Переименуйте `public/CNAME.example` в `public/CNAME` и замените пример
   домена своим. После `push` этот файл попадёт в GitHub Pages.

Для Telegram Login в BotFather указывается HTTPS-адрес опубликованного сайта,
а не `localhost`.
