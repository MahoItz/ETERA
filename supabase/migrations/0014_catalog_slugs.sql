-- Stable, human-readable identifiers for GitHub Pages query URLs. They are
-- assigned once and deliberately survive later title changes.
create or replace function private.catalog_slug_base(source text)
returns text language plpgsql immutable set search_path = '' as $$
declare value text := lower(coalesce(btrim(source), ''));
begin
  value := replace(value, 'щ', 'shch'); value := replace(value, 'ш', 'sh');
  value := replace(value, 'ч', 'ch'); value := replace(value, 'ц', 'ts');
  value := replace(value, 'ю', 'yu'); value := replace(value, 'я', 'ya');
  value := replace(value, 'ж', 'zh'); value := replace(value, 'х', 'kh');
  value := replace(value, 'ё', 'e'); value := replace(value, 'й', 'y');
  value := translate(value, 'абвгде зийклмнопрстуфьыъэ', 'abvgde ziyklmnoprstufyye');
  value := regexp_replace(value, '[^a-z0-9]+', '-', 'g');
  value := trim(both '-' from value);
  return coalesce(nullif(value, ''), 'work');
end;
$$;

alter table public.works add column slug text;
alter table public.variants add column slug text;

create or replace function private.next_work_slug(source text)
returns text language plpgsql security definer set search_path = '' as $$
declare base text := private.catalog_slug_base(source); candidate text := base; suffix integer := 2;
begin
  perform pg_advisory_xact_lock(hashtextextended('work-slug:' || base, 0));
  while exists (select 1 from public.works where slug = candidate) loop
    candidate := base || '-' || suffix; suffix := suffix + 1;
  end loop;
  return candidate;
end;
$$;

create or replace function private.next_variant_slug(parent_id uuid, source text)
returns text language plpgsql security definer set search_path = '' as $$
declare base text := private.catalog_slug_base(source); candidate text := base; suffix integer := 2;
begin
  perform pg_advisory_xact_lock(hashtextextended('variant-slug:' || parent_id::text || ':' || base, 0));
  while exists (select 1 from public.variants where work_id = parent_id and slug = candidate) loop
    candidate := base || '-' || suffix; suffix := suffix + 1;
  end loop;
  return candidate;
end;
$$;

update public.works set slug = private.next_work_slug(title) where slug is null;
update public.variants set slug = private.next_variant_slug(work_id, name) where slug is null;

alter table public.works alter column slug set not null;
alter table public.variants alter column slug set not null;
alter table public.works add constraint works_slug_key unique (slug);
alter table public.variants add constraint variants_work_slug_key unique (work_id, slug);
alter table public.works add constraint works_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
alter table public.variants add constraint variants_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create or replace function private.assign_work_slug()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.slug is null or btrim(new.slug) = '' then new.slug := private.next_work_slug(new.title); end if;
  return new;
end;
$$;
create or replace function private.assign_variant_slug()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.slug is null or btrim(new.slug) = '' then new.slug := private.next_variant_slug(new.work_id, new.name); end if;
  return new;
end;
$$;
create trigger works_assign_slug before insert on public.works for each row execute function private.assign_work_slug();
create trigger variants_assign_slug before insert on public.variants for each row execute function private.assign_variant_slug();
