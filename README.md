# Etera

Каталог авторских изделий с публичной витриной и редактором для администратора.

## Актуальный стек

- React 19 + Vite 7 (`src/`)
- Supabase: Postgres, Auth и Storage (`supabase/`)
- GitHub Pages для статической публикации (`.github/workflows/deploy-pages.yml`)
- npm и Node.js 22.13+

В репозитории нет Next.js, Cloudflare D1/R2, Drizzle или отдельной static-сборки: прежние прототипы удалены, чтобы не создавать альтернативный путь запуска.

## Настройка

Создайте `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

Для GitHub Pages задайте эти же значения как secrets `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`.

Примените SQL-файлы из `supabase/migrations/` по порядку к проекту Supabase.

## Команды

```bash
npm ci
npm run dev
npm run lint
npm test
npm run build
```

Production-сборка требует обе переменные Supabase. Workflow запускает lint, тесты и сборку перед публикацией.

## Структура

- `src/` — приложение и UI.
- `lib/` — общая модель и чистые функции каталога.
- `supabase/` — миграции, Edge Functions и политики.
- `tests/` — unit- и интеграционные проверки PGlite для RPC, RLS и очистки файлов.
- `public/` — только статические декоративные ресурсы; карточки работ получают фото из Supabase Storage.
