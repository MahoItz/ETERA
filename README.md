# Мамина мастерская

Публичный каталог изделий ручной работы из гипса и бетона. Стек: React, Vite, Supabase (PostgreSQL, Storage, Auth и RLS) и GitHub Pages.

## Локальный запуск

1. Скопируйте `.env.example` в `.env.local`.
2. Заполните `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` значениями своего проекта. Публикуемый ключ допустим в клиентской сборке; `service_role` ключ нельзя добавлять в файл или Git.
3. Выполните `npm install` и `npm run dev`.

Проверки:

```powershell
npm run typecheck
npm run lint
npm run build
```

## Supabase

SQL-миграции находятся в `supabase/migrations/`. Они уже применены к подключённому проекту через MCP:

- `0001_initial_catalog.sql` — таблицы каталога, варианты, фотографии, Storage bucket и RLS;
- `0002_private_admin_helper.sql` — закрытый helper для RLS без публичной SECURITY DEFINER функции.

В проект перенесены две исходные карточки и категории. Пока фотографии этих двух карточек лежат в `public/images/`, поэтому страница работает до настройки аккаунта администратора. Все новые фотографии загружаются в bucket `work-photos` Supabase как WebP не больше 1.5 МБ.

### Администраторы

Создайте два отдельных аккаунта в Supabase Dashboard → Authentication → Users: для мастера и разработчика. После создания пришлите мне только их email-адреса либо UUID из Dashboard — я добавлю эти UUID в `public.profiles` через безопасную миграцию. До этого вход в интерфейс возможен, но RLS не даст изменять данные.

Публичные посетители могут читать только опубликованные и непроданные работы. Политики RLS защищают запись в таблицы и Storage на стороне Supabase.

## GitHub Pages

Workflow расположен в `.github/workflows/deploy-pages.yml`. После создания Git-репозитория и push в `main` включите в GitHub: Settings → Pages → Source: GitHub Actions. Workflow передаёт имя репозитория в Vite, поэтому ссылки на изображения будут работать и на адресе вида `https://<owner>.github.io/<repository>/`.

`Supabase_info.txt`, `.env.local` и любые ключи не должны попадать в Git. Первый файл уже добавлен в `.gitignore`.

## Резервная копия миграции

До переноса создана копия исходного Cloudflare/Sites-прототипа: `migration-backup/pre-supabase-2026-10-14/`. Она нужна только для отката и не участвует в сборке.
