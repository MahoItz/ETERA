# Архитектура Etera

## Runtime

Публичная витрина и административный редактор — одно Vite-приложение из `src/`, опубликованное на GitHub Pages. Данные и фотографии не попадают в git: клиент читает их из Supabase.

`src/catalog.ts` обращается к Supabase через RPC и таблицы с RLS. Сохранение работы выполняет атомарная функция `public.save_work`; она проверяет revision, сохраняет варианты по ID и оставляет receipt для безопасного повтора запроса.

## Данные и фотографии

- PostgreSQL: работы, варианты, категории, настройки и украшения.
- Supabase Storage bucket `work-photos`: загруженные WebP.
- Временные загрузки и удалённые ссылки проходят через `work_photo_cleanup`. Worker перед удалением повторно проверяет все ссылки на файл.
- SQL-источник схемы — только `supabase/migrations/`.

## Публикация

GitHub Actions выполняет `npm ci`, `npm run lint`, `npm test` и `npm run build`, после чего публикует `dist/` в GitHub Pages. Source map не публикуются.

Обязательные production-переменные: `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`. Publishable key допустим в клиенте; service-role ключи и worker secrets остаются только в Supabase.

## Ссылки

GitHub Pages не требует SPA rewrite, поэтому карточки используют query URL: `?work=<slug>` и `?work=<slug>&variant=<slug>`. Slug транслитерируются и стабильно хранятся в БД.
