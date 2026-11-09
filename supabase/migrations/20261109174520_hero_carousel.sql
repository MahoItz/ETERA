-- NULL preserves the automatic carousel; an empty array deliberately hides cards.
alter table public.site_settings add column hero_work_ids uuid[] default null
  constraint site_settings_hero_work_ids_check check (
    hero_work_ids is null or (
      cardinality(hero_work_ids) <= 10
      and coalesce(array_ndims(hero_work_ids), 1) = 1
      and array_position(hero_work_ids, null) is null
    )
  );

create function public.save_hero_carousel(expected_ids uuid[], ordered_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_ids uuid[];
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if ordered_ids is not null and (
    cardinality(ordered_ids) > 10
    or coalesce(array_ndims(ordered_ids), 1) <> 1
    or array_position(ordered_ids, null) is not null
    or (select count(distinct id) from unnest(ordered_ids) as ids(id)) <> cardinality(ordered_ids)
  ) then
    raise exception 'Choose up to 10 distinct works' using errcode = '22023';
  end if;

  -- Lock only the singleton settings row; unrelated settings are never replaced.
  select hero_work_ids into current_ids from public.site_settings where id = true for update;
  if not found then
    raise exception 'Site settings missing; reload the catalogue' using errcode = '55000';
  end if;
  if current_ids is distinct from expected_ids then
    raise exception 'Carousel changed; reload before retrying' using errcode = '40001';
  end if;

  if exists (
    select 1 from unnest(ordered_ids) as chosen(id)
    where not exists (
      select 1 from public.works as work
      where work.id = chosen.id and work.status = 'published' and work.availability <> 'sold'
        and exists (select 1 from public.photos as photo where photo.work_id = work.id)
    )
  ) then
    raise exception 'Carousel works must be published, unsold and have main photos' using errcode = '22023';
  end if;

  update public.site_settings set hero_work_ids = ordered_ids where id = true;
  return jsonb_build_object('ids', ordered_ids);
end;
$$;

revoke all on function public.save_hero_carousel(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.save_hero_carousel(uuid[], uuid[]) to authenticated;

-- Existing public SELECT and admin USING/WITH CHECK policies remain in force.
-- Rollback: drop function public.save_hero_carousel(uuid[], uuid[]);
-- alter table public.site_settings drop column hero_work_ids;
