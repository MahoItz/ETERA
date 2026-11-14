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

Сайт опубликован на собственном домене `https://elveria.ru/`. Сборка использует корневой путь `/`: префикс `/ETERA/` от адреса GitHub Pages здесь не нужен и приводит к ошибкам 404 при загрузке JavaScript, стилей и изображений. После изменения настроек сборки нужно заново опубликовать сайт через workflow `Deploy GitHub Pages`.

Восстановление пароля доступно через «Забыли пароль?» в окне входа. Настройка адреса возврата и шаблона письма: [docs/password-recovery.md](docs/password-recovery.md).

Подготовка CSP и защитных HTTP-заголовков для CDN/прокси: [docs/security-headers.md](docs/security-headers.md). На текущем прямом GitHub Pages эти заголовки ещё не применены; настройка домена обязательна для завершения F08.

Каталог загружается страницами по 24 работы, полные галереи — при открытии карточки. Миграция представления `catalog_cards` применена к production 14.11.2026; порядок обновления новых окружений и опциональные размеры изображений: [docs/catalog-pagination.md](docs/catalog-pagination.md).

## Структура

- `src/` — приложение и UI.
- `lib/` — общая модель и чистые функции каталога.
- `supabase/` — миграции, Edge Functions и политики.
- `tests/` — unit- и интеграционные проверки PGlite для RPC, RLS и очистки файлов.
- `public/` — только статические декоративные ресурсы; карточки работ получают фото из Supabase Storage.
