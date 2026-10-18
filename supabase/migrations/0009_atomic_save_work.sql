-- Additive migration. Existing catalogue rows and RLS policies are unchanged.
-- Retain receipts even if a work is later deleted: replay must never recreate it.
create table public.work_save_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.work_save_requests enable row level security;
revoke all on public.work_save_requests from public, anon, authenticated;
grant select, insert on public.work_save_requests to authenticated;
create policy "admins read own work save receipts" on public.work_save_requests
  for select to authenticated using (actor_id = (select auth.uid()) and (select private.is_admin()));
create policy "admins insert own work save receipts" on public.work_save_requests
  for insert to authenticated with check (actor_id = (select auth.uid()) and (select private.is_admin()));

-- A durable outbox, populated in the same transaction as the save. Storage is
-- cleaned only after a grace period and another check of every image reference.
create table public.work_photo_cleanup (
  url text primary key,
  queued_at timestamptz not null default now()
);
create index work_photo_cleanup_queued_idx on public.work_photo_cleanup(queued_at);
alter table public.work_photo_cleanup enable row level security;
revoke all on public.work_photo_cleanup from public, anon, authenticated;
grant select, insert, delete on public.work_photo_cleanup to authenticated;
create policy "admins manage work photo cleanup" on public.work_photo_cleanup
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create function public.save_work(
  request_id uuid,
  work_id uuid,
  expected_revision integer,
  payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_body jsonb;
  receipt public.work_save_requests%rowtype;
  current_work public.works%rowtype;
  saved_work public.works%rowtype;
  target_id uuid;
  resolved_category_id uuid;
  category_name text;
  response jsonb;
  photo jsonb;
  variant jsonb;
  photo_position integer := 0;
  variant_position integer := 0;
  old_paths jsonb;
  variant_ids uuid[];
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if request_id is null or payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Invalid save request' using errcode = '22023';
  end if;
  request_body := jsonb_build_object('work_id', work_id, 'revision', expected_revision, 'payload', payload);

  -- Serialize retries of the same operation, including two simultaneous creates.
  perform pg_advisory_xact_lock(hashtextextended(request_id::text, 0));
  select r.* into receipt from public.work_save_requests r where r.request_id = save_work.request_id;
  if found then
    if receipt.actor_id <> auth.uid() or receipt.request <> request_body then
      raise exception 'Save request identifier has already been used' using errcode = '22023';
    end if;
    return receipt.result;
  end if;

  if (work_id is null and expected_revision is not null)
    or (work_id is not null and (expected_revision is null or expected_revision < 1)) then
    raise exception 'Invalid work revision' using errcode = '22023';
  end if;
  if work_id is not null then
    select w.* into current_work from public.works w where w.id = save_work.work_id for update;
    if not found or current_work.revision <> expected_revision then
      raise exception 'Work has changed; reload before saving' using errcode = '40001';
    end if;
  end if;

  -- Validate on the server as well as in the editor. Table constraints cover
  -- text lengths, prices and enum values; no client blob URLs may be committed.
  category_name := btrim(payload->>'category');
  if category_name is null or char_length(category_name) not between 1 and 80
    or coalesce(btrim(payload->>'title'), '') = ''
    or jsonb_typeof(payload->'photos') is distinct from 'array'
    or jsonb_typeof(payload->'variants') is distinct from 'array' then
    raise exception 'Invalid work fields' using errcode = '22023';
  end if;
  if jsonb_array_length(payload->'photos') > 8
    or (payload->>'status' = 'published' and jsonb_array_length(payload->'photos') = 0) then
    raise exception 'Published work requires 1 to 8 photos' using errcode = '22023';
  end if;

  -- Preserve IDs and non-editor variant fields, including variant-level photos.
  select coalesce(array_agg((v->>'id')::uuid), '{}'::uuid[]) into variant_ids
    from jsonb_array_elements(payload->'variants') v;
  if array_position(variant_ids, null) is not null
    or cardinality(variant_ids) <> (select count(distinct id) from unnest(variant_ids) ids(id))
    or exists (select 1 from public.variants v where v.id = any(variant_ids) and v.work_id is distinct from save_work.work_id) then
    raise exception 'Invalid variant identifiers' using errcode = '22023';
  end if;

  insert into public.categories(name) values (category_name) on conflict (name) do nothing;
  select c.id into resolved_category_id from public.categories c where c.name = category_name;
  target_id := coalesce(work_id, gen_random_uuid());

  -- Capture cleanup candidates BEFORE changing references, but commit the
  -- candidates only if every subsequent database write succeeds.
  if work_id is not null then
    insert into public.work_photo_cleanup(url)
      select p.url from public.photos p where p.work_id = save_work.work_id
      union select v.image_url from public.variants v where v.work_id = save_work.work_id and v.image_url is not null
      union select p.url from public.photos p join public.variants v on v.id = p.variant_id
        where v.work_id = save_work.work_id and not (v.id = any(variant_ids))
      union select current_work.tree_image where current_work.tree_image is not null
      on conflict (url) do nothing;
  end if;
  select coalesce(jsonb_object_agg(p.url, p.storage_path) filter (where p.storage_path is not null), '{}')
    into old_paths from public.photos p where p.work_id = target_id;

  if work_id is null then
    insert into public.works(id, title, description, category_id, material, dimensions, price,
      availability, status, featured, tree_image, show_on_tree, published_at)
    values (target_id, btrim(payload->>'title'), btrim(payload->>'description'), resolved_category_id,
      btrim(payload->>'material'), btrim(payload->>'dimensions'), (payload->>'price')::numeric,
      payload->>'availability', payload->>'status', (payload->>'featured')::boolean,
      payload->>'treeImage', coalesce((payload->>'showOnTree')::boolean, false),
      case when payload->>'status' = 'published' then now() end)
    returning * into saved_work;
  else
    update public.works w set title = btrim(payload->>'title'), description = btrim(payload->>'description'),
      category_id = resolved_category_id, material = btrim(payload->>'material'), dimensions = btrim(payload->>'dimensions'),
      price = (payload->>'price')::numeric, availability = payload->>'availability', status = payload->>'status',
      featured = (payload->>'featured')::boolean, revision = w.revision + 1,
      tree_image = case when payload ? 'treeImage' then payload->>'treeImage' else w.tree_image end,
      show_on_tree = case when payload ? 'showOnTree' then (payload->>'showOnTree')::boolean else w.show_on_tree end,
      published_at = case when payload->>'status' = 'published' then coalesce(w.published_at, now()) end
      where w.id = target_id returning * into saved_work;
  end if;
  if coalesce(saved_work.tree_image, '') ~* '^(blob|data|javascript):' then
    raise exception 'Invalid tree image URL' using errcode = '22023';
  end if;

  delete from public.photos p where p.work_id = target_id;
  for photo in select value from jsonb_array_elements(payload->'photos') loop
    if coalesce(photo->>'url', '') = '' or photo->>'url' ~* '^(blob|data|javascript):' then
      raise exception 'Invalid photo URL' using errcode = '22023';
    end if;
    insert into public.photos(work_id, url, alt, position, storage_path)
      values (target_id, photo->>'url', left(coalesce(photo->>'alt', ''), 200), photo_position,
        coalesce(old_paths->>(photo->>'url'), photo->>'storage_path'));
    photo_position := photo_position + 1;
  end loop;

  delete from public.variants v where v.work_id = target_id and not (v.id = any(variant_ids));
  for variant in select value from jsonb_array_elements(payload->'variants') loop
    if coalesce(btrim(variant->>'name'), '') = '' or coalesce(variant->>'imageUrl', '') ~* '^(blob|data|javascript):' then
      raise exception 'Invalid variant fields' using errcode = '22023';
    end if;
    insert into public.variants as v(id, work_id, name, image_url, price, availability, position)
      values ((variant->>'id')::uuid, target_id, btrim(variant->>'name'), variant->>'imageUrl',
        (variant->>'price')::numeric, variant->>'availability', variant_position)
      on conflict (id) do update set name = excluded.name, image_url = excluded.image_url,
        price = excluded.price, availability = excluded.availability, position = excluded.position
      where v.work_id = target_id;
    if not found then
      raise exception 'Variant belongs to another work' using errcode = '22023';
    end if;
    variant_position := variant_position + 1;
  end loop;

  select to_jsonb(saved_work) || jsonb_build_object(
    'category', jsonb_build_object('name', category_name),
    'photos', (select coalesce(jsonb_agg(to_jsonb(p) order by p.position), '[]') from public.photos p where p.work_id = target_id),
    'variants', (select coalesce(jsonb_agg(to_jsonb(v) order by v.position), '[]') from public.variants v where v.work_id = target_id)
  ) into response;
  insert into public.work_save_requests(request_id, actor_id, request, result)
    values (save_work.request_id, auth.uid(), request_body, response);
  return response;
end;
$$;

revoke all on function public.save_work(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_work(uuid, uuid, integer, jsonb) to authenticated;

-- Rollback: disable saving in the UI first. Keep receipts and cleanup queue.
-- drop function public.save_work(uuid, uuid, integer, jsonb);
