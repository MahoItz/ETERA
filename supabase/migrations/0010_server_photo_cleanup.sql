-- A durable registry doubles as the existing cleanup outbox. Tombstones are
-- retained: once deletion starts, the same path can never acquire new references.
alter table public.work_photo_cleanup
  add column storage_path text,
  add column state text not null default 'queued' check (state in ('queued', 'in_use', 'deleting', 'deleted', 'ignored')),
  add column available_at timestamptz not null default (now() + interval '24 hours'),
  add column protected_until timestamptz,
  add column upload_actor uuid references auth.users(id) on delete set null,
  add column claim_token uuid,
  add column claim_until timestamptz,
  add column attempts integer not null default 0,
  add column last_error text;
create index work_photo_cleanup_ready_idx on public.work_photo_cleanup(available_at)
  where state in ('queued', 'deleting');
create unique index work_photo_cleanup_path_idx on public.work_photo_cleanup(storage_path)
  where storage_path is not null;

-- Legacy save_work inserts URL candidates; it cannot claim/delete/forge leases.
revoke all on public.work_photo_cleanup from public, anon, authenticated;
grant select, insert(url) on public.work_photo_cleanup to authenticated;

create table private.photo_cleanup_config (
  id boolean primary key default true check (id),
  project_url text,
  publishable_key text,
  worker_secret text not null default (gen_random_uuid()::text || gen_random_uuid()::text),
  enabled boolean not null default false
);
insert into private.photo_cleanup_config(id) values (true);
revoke all on private.photo_cleanup_config from public, anon, authenticated, service_role;

create function private.photo_valid_path(object_path text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(object_path ~ '^works/[A-Za-z0-9][A-Za-z0-9._-]*[.]webp$', false)
    and char_length(object_path) <= 240;
$$;

create function private.photo_decode_path(encoded_path text)
returns text language plpgsql immutable set search_path = '' as $$
declare decoded bytea := ''::bytea; i integer := 1; part text;
begin
  if encoded_path is null or length(encoded_path) > 1000 then return null; end if;
  while i <= length(encoded_path) loop
    part := substr(encoded_path, i, 1);
    if part = '%' then
      part := substr(encoded_path, i + 1, 2);
      if part !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
      decoded := decoded || decode(part, 'hex'); i := i + 3;
    else
      decoded := decoded || convert_to(part, 'UTF8'); i := i + 1;
    end if;
  end loop;
  return convert_from(decoded, 'UTF8');
exception when character_not_in_repertoire or untranslatable_character then return null;
end;
$$;

create function private.photo_path(image_url text)
returns text language sql stable security definer set search_path = '' as $$
  with decoded as (
    select c.project_url || '/storage/v1/object/public/work-photos/' as base,
      private.photo_decode_path(split_part(split_part(substr(image_url,
        length(c.project_url || '/storage/v1/object/public/work-photos/') + 1), '?', 1), '#', 1)) as path
    from private.photo_cleanup_config c where c.id
  )
  select case when lower(left(image_url, length(base))) = lower(base) and private.photo_valid_path(path) then path end from decoded;
$$;

create function private.photo_url(object_path text)
returns text language sql stable security definer set search_path = '' as $$
  select c.project_url || '/storage/v1/object/public/work-photos/' || object_path
    from private.photo_cleanup_config c where c.id;
$$;

create function private.photo_is_used(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.photos p where p.storage_path = object_path or private.photo_path(p.url) = object_path)
    or exists (select 1 from public.variants v where private.photo_path(v.image_url) = object_path)
    or exists (select 1 from public.tree_ornaments o where private.photo_path(o.image_url) = object_path)
    or exists (select 1 from public.works w where private.photo_path(w.tree_image) = object_path);
$$;

create function private.photo_prepare_candidate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.storage_path is null then new.storage_path := private.photo_path(new.url); end if;
  if new.storage_path is null then new.state := 'ignored';
  else new.url := private.photo_url(new.storage_path); end if;
  return new;
end;
$$;
create trigger photo_prepare_candidate before insert on public.work_photo_cleanup
  for each row execute function private.photo_prepare_candidate();

-- BEFORE triggers lock the registry before a reference can be inserted. The
-- worker holds the same row lock while checking references and claiming a file.
create function private.photo_track_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_paths text[] := '{}';
  new_paths text[] := '{}';
  object_path text;
  object_url text;
  current_state text;
begin
  if tg_op <> 'INSERT' then
    old_paths := array[private.photo_path(to_jsonb(old)->>tg_argv[0])];
    if tg_table_name = 'photos' and private.photo_valid_path(to_jsonb(old)->>'storage_path') then
      old_paths := array_append(old_paths, to_jsonb(old)->>'storage_path');
    end if;
  end if;
  if tg_op <> 'DELETE' then
    new_paths := array[private.photo_path(to_jsonb(new)->>tg_argv[0])];
    if tg_table_name = 'photos' and private.photo_valid_path(to_jsonb(new)->>'storage_path') then
      new_paths := array_append(new_paths, to_jsonb(new)->>'storage_path');
    end if;
  end if;
  for object_path in select distinct p from unnest(old_paths || new_paths) p where p is not null order by p loop
    object_url := private.photo_url(object_path);
    if object_url is null then continue; end if;
    insert into public.work_photo_cleanup(url, storage_path) values (object_url, object_path) on conflict (url) do nothing;
    select q.state into current_state from public.work_photo_cleanup q where q.url = object_url for update;
    if object_path = any(new_paths) then
      if current_state in ('deleting', 'deleted') then
        raise exception 'Image is being deleted; upload it again' using errcode = '55000';
      end if;
      update public.work_photo_cleanup set state = 'in_use', storage_path = object_path, last_error = null where url = object_url;
    elsif object_path = any(old_paths) then
      update public.work_photo_cleanup set state = 'queued', storage_path = object_path,
        queued_at = now(), available_at = now() + interval '24 hours'
        where url = object_url and state not in ('deleting', 'deleted');
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger photos_track_file before insert or update of url, storage_path or delete on public.photos
  for each row execute function private.photo_track_reference('url');
create trigger variants_track_file before insert or update of image_url or delete on public.variants
  for each row execute function private.photo_track_reference('image_url');
create trigger ornaments_track_file before insert or update of image_url or delete on public.tree_ornaments
  for each row execute function private.photo_track_reference('image_url');
create trigger works_track_file before insert or update of tree_image or delete on public.works
  for each row execute function private.photo_track_reference('tree_image');

create function public.begin_work_photo_upload(upload_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  object_path text := 'works/' || upload_id::text || '.webp';
  object_url text;
  entry public.work_photo_cleanup%rowtype;
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  object_url := private.photo_url(object_path);
  if upload_id is null or object_url is null then
    raise exception 'Photo uploads are not configured' using errcode = '55000';
  end if;
  insert into public.work_photo_cleanup(url, storage_path, upload_actor, protected_until)
    values (object_url, object_path, auth.uid(), now() + interval '24 hours') on conflict (url) do nothing;
  select q.* into entry from public.work_photo_cleanup q where q.url = object_url for update;
  if entry.upload_actor is distinct from auth.uid() or entry.state in ('deleting', 'deleted') then
    raise exception 'Upload identifier is unavailable' using errcode = '55000';
  end if;
  update public.work_photo_cleanup set protected_until = now() + interval '24 hours',
    available_at = greatest(available_at, now() + interval '24 hours') where url = object_url;
  return jsonb_build_object('url', object_url, 'path', object_path);
end;
$$;

create function public.renew_work_photo_upload(image_url text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare entry public.work_photo_cleanup%rowtype;
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  select q.* into entry from public.work_photo_cleanup q where q.url = image_url for update;
  if not found or entry.upload_actor is distinct from auth.uid() or entry.state in ('deleting', 'deleted') then return false; end if;
  update public.work_photo_cleanup set protected_until = now() + interval '24 hours',
    available_at = greatest(available_at, now() + interval '24 hours') where url = image_url;
  return true;
end;
$$;

-- Deletions are now server-only. Older clients may still upload new immutable
-- paths; discovery quarantines their unregistered uploads for seven days.
create function private.photo_may_upload(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.photo_valid_path(object_path) and not exists (
    select 1 from public.work_photo_cleanup q where q.storage_path = object_path and q.state in ('deleting', 'deleted')
  );
$$;
drop policy "admins manage work photos" on storage.objects;
create policy "admins upload immutable work photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'work-photos' and (select private.is_admin()) and private.photo_may_upload(name));
create policy "work photo deletion is server only" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'work-photos');

-- Register existing Storage metadata without touching the bytes. Used at setup
-- and by the worker to cover uploads left by older clients after a failed save.
create function private.photo_discover()
returns void language sql security definer set search_path = '' as $$
  insert into public.work_photo_cleanup(url, storage_path, protected_until, available_at)
    select private.photo_url(o.name), o.name, now() + interval '7 days', now() + interval '7 days'
    from storage.objects o
    where o.bucket_id = 'work-photos' and private.photo_valid_path(o.name) and private.photo_url(o.name) is not null
      and not exists (select 1 from public.work_photo_cleanup q where q.storage_path = o.name)
    order by o.created_at limit 128
    on conflict (url) do nothing;
$$;

create function private.configure_photo_cleanup(project_url text, publishable_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' or coalesce(publishable_key, '') = '' then
    raise exception 'Invalid project configuration' using errcode = '22023';
  end if;
  if exists (select 1 from private.photo_cleanup_config c where c.project_url is not null and c.project_url <> configure_photo_cleanup.project_url) then
    raise exception 'Cannot change the Storage origin after initialization' using errcode = '55000';
  end if;
  update private.photo_cleanup_config c set project_url = configure_photo_cleanup.project_url,
    publishable_key = configure_photo_cleanup.publishable_key where c.id;
  insert into public.work_photo_cleanup(url, storage_path)
    select distinct private.photo_url(private.photo_path(q.url)), private.photo_path(q.url)
    from public.work_photo_cleanup q where private.photo_path(q.url) is not null
    on conflict (url) do nothing;
  update public.work_photo_cleanup q set
    storage_path = case when q.url = private.photo_url(private.photo_path(q.url)) then private.photo_path(q.url) end,
    state = case when private.photo_path(q.url) is null or q.url <> private.photo_url(private.photo_path(q.url)) then 'ignored'
      when q.state = 'ignored' then 'queued' else q.state end;
  perform private.photo_discover();
end;
$$;

create function private.photo_check_worker(worker_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if worker_secret is null or not exists (
    select 1 from private.photo_cleanup_config c where c.id and c.enabled and c.worker_secret = photo_check_worker.worker_secret
  ) then raise exception 'Invalid cleanup credentials' using errcode = '42501'; end if;
end;
$$;

create function public.claim_work_photo_cleanup(worker_secret text)
returns table(object_path text, claim_token uuid)
language plpgsql security definer set search_path = '' as $$
declare entry public.work_photo_cleanup%rowtype; next_token uuid;
begin
  perform private.photo_check_worker(worker_secret);
  perform private.photo_discover();
  for entry in select q.* from public.work_photo_cleanup q
    where q.state in ('queued', 'deleting') and q.available_at <= now()
      and (q.protected_until is null or q.protected_until <= now())
      and (q.claim_until is null or q.claim_until <= now())
      and q.storage_path is not null
    order by q.available_at limit 16 for update skip locked
  loop
    if entry.state = 'queued' and private.photo_is_used(entry.storage_path) then
      update public.work_photo_cleanup set state = 'in_use' where url = entry.url;
      continue;
    end if;
    if private.photo_is_used(entry.storage_path) then
      update public.work_photo_cleanup set last_error = 'References found during deletion; manual review required',
        available_at = now() + interval '1 day' where url = entry.url;
      continue;
    end if;
    next_token := gen_random_uuid();
    update public.work_photo_cleanup set state = 'deleting', claim_token = next_token,
      claim_until = now() + interval '5 minutes', attempts = attempts + 1 where url = entry.url;
    object_path := entry.storage_path; claim_token := next_token;
    return next;
  end loop;
end;
$$;

create function public.confirm_work_photo_cleanup(worker_secret text, object_path text, claim_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare entry public.work_photo_cleanup%rowtype;
begin
  perform private.photo_check_worker(worker_secret);
  select q.* into entry from public.work_photo_cleanup q where q.storage_path = object_path for update;
  return found and entry.state = 'deleting' and entry.claim_token = confirm_work_photo_cleanup.claim_token
    and entry.claim_until > now() and not private.photo_is_used(object_path);
end;
$$;

create function public.finish_work_photo_cleanup(worker_secret text, object_path text, claim_token uuid, cleanup_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.photo_check_worker(worker_secret);
  update public.work_photo_cleanup q set state = case when cleanup_error is null then 'deleted' else 'deleting' end,
    claim_until = null, claim_token = null, last_error = left(cleanup_error, 1000),
    available_at = now() + (least(1440, 5 * power(2, least(q.attempts - 1, 8)))::integer * interval '1 minute')
    where q.storage_path = object_path and q.state = 'deleting' and q.claim_token = finish_work_photo_cleanup.claim_token;
  if not found then raise exception 'Cleanup claim expired' using errcode = '55000'; end if;
end;
$$;

-- Only these narrow functions cross the private-schema boundary.
do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and (p.proname like 'photo_%' or p.proname = 'configure_photo_cleanup')
  loop execute format('revoke all on function %s from public, anon, authenticated, service_role', fn.signature); end loop;
end;
$$;
grant execute on function private.photo_may_upload(text) to authenticated;
revoke all on function public.begin_work_photo_upload(uuid), public.renew_work_photo_upload(text) from public, anon, authenticated, service_role;
grant execute on function public.begin_work_photo_upload(uuid), public.renew_work_photo_upload(text) to authenticated;
revoke all on function public.claim_work_photo_cleanup(text), public.confirm_work_photo_cleanup(text,text,uuid), public.finish_work_photo_cleanup(text,text,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_work_photo_cleanup(text), public.confirm_work_photo_cleanup(text,text,uuid), public.finish_work_photo_cleanup(text,text,uuid,text) to service_role;
