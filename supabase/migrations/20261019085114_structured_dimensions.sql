-- Physical values are stored in mm; unit controls display only.
-- Existing free-text dimensions remain untouched until an editor replaces them.
create or replace function private.valid_measurements(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare field text; number numeric;
begin
  if value is null then return true; end if;
  if jsonb_typeof(value) <> 'object' or not (value ?& array['heightMm', 'widthMm', 'depthMm', 'unit'])
    or value - array['heightMm', 'widthMm', 'depthMm', 'unit'] <> '{}'::jsonb
    or coalesce(value->>'unit', '') not in ('mm', 'cm') then return false; end if;
  foreach field in array array['heightMm', 'widthMm', 'depthMm'] loop
    if value->field = 'null'::jsonb then continue; end if;
    if jsonb_typeof(value->field) <> 'number' then return false; end if;
    number := (value->>field)::numeric;
    if number <= 0 or number > 1000000 or number <> round(number, 3) then return false; end if;
  end loop;
  return value->'heightMm' <> 'null'::jsonb or value->'widthMm' <> 'null'::jsonb or value->'depthMm' <> 'null'::jsonb;
end;
$$;
revoke all on function private.valid_measurements(jsonb) from public;
grant execute on function private.valid_measurements(jsonb) to authenticated, service_role;

alter table public.works add column measurements jsonb
  constraint works_measurements_valid check (private.valid_measurements(measurements));
alter table public.variants add column measurements jsonb
  constraint variants_measurements_valid check (private.valid_measurements(measurements));

create table public.dimension_suggestions (
  value_mm numeric(12,3) primary key check (value_mm > 0 and value_mm <= 1000000),
  created_at timestamptz not null default now()
);
alter table public.dimension_suggestions enable row level security;
revoke all on public.dimension_suggestions from public, anon, authenticated;
grant select, insert, delete on public.dimension_suggestions to authenticated;
grant all on public.dimension_suggestions to service_role;
create policy "admins manage dimension suggestions" on public.dimension_suggestions
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Reuse explicitly labelled legacy values as suggestions without guessing axes.
-- Unitless records remain untouched because their physical size is ambiguous.
insert into public.dimension_suggestions(value_mm)
select distinct replace(number[1], ',', '.')::numeric * case when source.dimensions ~* 'см' then 10 else 1 end
from (select dimensions from public.works union all select dimensions from public.variants) source
cross join lateral regexp_matches(source.dimensions, '([0-9]+(?:[.,][0-9]+)?)', 'g') number
where (source.dimensions ~* 'см' and source.dimensions !~* 'мм' or source.dimensions ~* 'мм' and source.dimensions !~* 'см')
  and replace(number[1], ',', '.')::numeric * case when source.dimensions ~* 'см' then 10 else 1 end > 0
  and replace(number[1], ',', '.')::numeric * case when source.dimensions ~* 'см' then 10 else 1 end <= 1000000
on conflict (value_mm) do nothing;

-- Saving a new or changed physical value remembers it in the same transaction.
-- Deleted suggestions are not restored by saving an unchanged size.
create or replace function private.remember_measurements()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare field text;
begin
  foreach field in array array['heightMm', 'widthMm', 'depthMm'] loop
    if new.measurements->>field is not null
      and (tg_op = 'INSERT' or new.measurements->field is distinct from old.measurements->field) then
      insert into public.dimension_suggestions(value_mm)
      values ((new.measurements->>field)::numeric) on conflict (value_mm) do nothing;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.remember_measurements() from public;
grant execute on function private.remember_measurements() to authenticated, service_role;
create trigger works_remember_measurements after insert or update of measurements on public.works
  for each row execute function private.remember_measurements();
create trigger variants_remember_measurements after insert or update of measurements on public.variants
  for each row execute function private.remember_measurements();

create or replace function public.save_work(
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
    insert into public.works(id, title, description, category_id, material, dimensions, measurements, price,
      availability, status, featured, tree_image, show_on_tree, published_at)
    values (target_id, btrim(payload->>'title'), btrim(payload->>'description'), resolved_category_id,
      btrim(payload->>'material'), btrim(payload->>'dimensions'), nullif(payload->'measurements', 'null'::jsonb), (payload->>'price')::numeric,
      payload->>'availability', payload->>'status', (payload->>'featured')::boolean,
      payload->>'treeImage', coalesce((payload->>'showOnTree')::boolean, false),
      case when payload->>'status' = 'published' then now() end)
    returning * into saved_work;
  else
    update public.works w set title = btrim(payload->>'title'), description = btrim(payload->>'description'),
      category_id = resolved_category_id, material = btrim(payload->>'material'), dimensions = btrim(payload->>'dimensions'),
      measurements = case when payload ? 'measurements' then nullif(payload->'measurements', 'null'::jsonb) else w.measurements end,
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
    insert into public.variants as v(id, work_id, name, image_url, price, availability, position, measurements)
      values ((variant->>'id')::uuid, target_id, btrim(variant->>'name'), variant->>'imageUrl',
        (variant->>'price')::numeric, variant->>'availability', variant_position, nullif(variant->'measurements', 'null'::jsonb))
      on conflict (id) do update set name = excluded.name, image_url = excluded.image_url,
        price = excluded.price, availability = excluded.availability, position = excluded.position,
        measurements = case when variant ? 'measurements' then excluded.measurements else v.measurements end
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
