-- Public catalogue. This migration is safe to run only on a new Supabase project.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.site_settings (
  id boolean primary key default true check (id),
  name text not null check (char_length(name) between 1 and 80),
  contact text not null default '' check (char_length(contact) <= 300),
  updated_at timestamptz not null default now()
);

create table public.works (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  category_id uuid references public.categories(id) on delete set null,
  material text not null default '' check (char_length(material) <= 100),
  dimensions text not null default '' check (char_length(dimensions) <= 150),
  weight text not null default '' check (char_length(weight) <= 100),
  colors text[] not null default '{}',
  custom_order boolean not null default false,
  price numeric(12,2) check (price is null or price >= 0),
  availability text not null default 'order' check (availability in ('available', 'order', 'sold')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  featured boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  finish text not null default '' check (char_length(finish) <= 100),
  price numeric(12,2) check (price is null or price >= 0),
  availability text not null default 'order' check (availability in ('available', 'order', 'sold')),
  dimensions text not null default '' check (char_length(dimensions) <= 150),
  weight text not null default '' check (char_length(weight) <= 100),
  colors text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  work_id uuid references public.works(id) on delete cascade,
  variant_id uuid references public.variants(id) on delete cascade,
  storage_path text,
  url text not null check (char_length(url) <= 1000),
  alt text not null default '' check (char_length(alt) <= 200),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check ((work_id is null) <> (variant_id is null))
);

create index works_public_catalog_idx on public.works (featured desc, published_at desc, updated_at desc)
  where status = 'published' and availability <> 'sold';
create index variants_work_id_idx on public.variants (work_id, position);
create index photos_work_id_idx on public.photos (work_id, position);
create index photos_variant_id_idx on public.photos (variant_id, position);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger works_updated_at before update on public.works for each row execute function public.set_updated_at();
create trigger site_settings_updated_at before update on public.site_settings for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.site_settings enable row level security;
alter table public.works enable row level security;
alter table public.variants enable row level security;
alter table public.photos enable row level security;

create policy "admins can read profiles" on public.profiles for select to authenticated using (public.is_admin());
create policy "public can read categories" on public.categories for select to anon, authenticated using (true);
create policy "admins manage categories" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public can read site settings" on public.site_settings for select to anon, authenticated using (true);
create policy "admins manage site settings" on public.site_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public can read visible works" on public.works for select to anon, authenticated using (status = 'published' and availability <> 'sold' or public.is_admin());
create policy "admins manage works" on public.works for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public can read visible variants" on public.variants for select to anon, authenticated using (public.is_admin() or exists (select 1 from public.works w where w.id = work_id and w.status = 'published' and w.availability <> 'sold'));
create policy "admins manage variants" on public.variants for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public can read visible photos" on public.photos for select to anon, authenticated using (public.is_admin() or exists (select 1 from public.works w where w.id = photos.work_id and w.status = 'published' and w.availability <> 'sold') or exists (select 1 from public.variants v join public.works w on w.id = v.work_id where v.id = photos.variant_id and w.status = 'published' and w.availability <> 'sold'));
create policy "admins manage photos" on public.photos for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-photos', 'work-photos', true, 1572864, array['image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "public can view work photos" on storage.objects for select to anon, authenticated using (bucket_id = 'work-photos');
create policy "admins manage work photos" on storage.objects for all to authenticated using (bucket_id = 'work-photos' and public.is_admin()) with check (bucket_id = 'work-photos' and public.is_admin());

insert into public.site_settings (id, name, contact) values (true, 'Etera', '') on conflict (id) do nothing;
insert into public.categories (name, position) values ('Феи и балерины', 10), ('Барашки', 20), ('Декор для дома', 30) on conflict (name) do nothing;

-- The original two works are retained as metadata. Their images stay in the Vite public folder
-- until an authenticated administrator uploads replacements to Supabase Storage.
insert into public.works (id, title, description, category_id, material, availability, status, featured, published_at)
select '11111111-1111-4111-8111-111111111111', 'Феи-балерины', 'Подвесные фигурки из гипса с ручной росписью. Разные цвета, маленькие детали и праздничное настроение.', c.id, 'Гипс', 'order', 'published', true, now() from public.categories c where c.name = 'Феи и балерины'
on conflict (id) do nothing;
insert into public.works (id, title, description, category_id, material, availability, status, featured, published_at)
select '22222222-2222-4222-8222-222222222222', 'Барашки с золотым бантом', 'Декоративные подвески из гипса с ручной росписью. Мягкие оттенки, фактурная шерстка и золотые акценты.', c.id, 'Гипс', 'order', 'published', false, now() from public.categories c where c.name = 'Барашки'
on conflict (id) do nothing;
insert into public.photos (work_id, url, alt, position) values
  ('11111111-1111-4111-8111-111111111111', 'images/fairies.jpg', 'Коллекция расписанных фей-балерин', 0),
  ('22222222-2222-4222-8222-222222222222', 'images/lambs.jpg', 'Две подвески с белыми барашками и золотыми бантами', 0)
on conflict do nothing;
