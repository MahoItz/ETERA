-- The category editor saves a whole ordered list, so keep one revision for the
-- list rather than trying to make independently issued row updates consistent.
create table public.category_list_state (
  id boolean primary key default true check (id),
  revision integer not null default 1 check (revision > 0)
);
alter table public.category_list_state enable row level security;
revoke all on public.category_list_state from public, anon, authenticated;
grant select on public.category_list_state to anon, authenticated;
create policy "public can read category list state" on public.category_list_state
  for select to anon, authenticated using (true);
insert into public.category_list_state (id) values (true) on conflict (id) do nothing;

create function private.bump_category_list_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.category_list_state set revision = revision + 1 where id;
  return null;
end;
$$;
create trigger categories_bump_list_revision
after insert or update or delete on public.categories
for each statement execute function private.bump_category_list_revision();

create function public.save_categories(
  expected_revision integer,
  category_names text[],
  original_names text[]
)
returns table(names text[], revision integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_revision integer;
  source_count integer;
  staging_prefix text;
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision < 1
    or category_names is null or original_names is null
    or coalesce(array_ndims(category_names), 1) <> 1
    or coalesce(array_ndims(original_names), 1) <> 1
    or cardinality(category_names) <> cardinality(original_names)
    or exists (select 1 from unnest(category_names) as item(name)
               where btrim(name) = '' or char_length(btrim(name)) > 80)
    or (select count(*) from unnest(category_names) as item(name))
       <> (select count(distinct lower(btrim(name))) from unnest(category_names) as item(name)) then
    raise exception 'Invalid category list' using errcode = '22023';
  end if;

  -- Take this lock before the revision row. Other category writes then finish
  -- and bump the revision, or wait until this complete list has committed.
  lock table public.categories in share row exclusive mode;
  select state.revision into current_revision
    from public.category_list_state state where state.id for update;
  if current_revision is distinct from expected_revision then
    raise exception 'Category list has changed; reload before saving' using errcode = '40001';
  end if;

  select count(*) into source_count
    from unnest(original_names) as item(name) where name is not null;
  if source_count <> (select count(distinct name) from unnest(original_names) as item(name) where name is not null) then
    raise exception 'Invalid category sources' using errcode = '22023';
  end if;
  if exists ((select item.name from unnest(original_names) as item(name) where item.name is not null)
             except (select c.name from public.categories c)) then
    raise exception 'Category list has changed; reload before saving' using errcode = '40001';
  end if;

  delete from public.categories c
    where not exists (select 1 from unnest(original_names) as item(name) where item.name = c.name);

  -- Move renamed rows aside first. This also handles A -> B, B -> A without
  -- changing the regular unique constraint used by save_work's ON CONFLICT.
  loop
    staging_prefix := '__etera_category_stage_' || left(replace(gen_random_uuid()::text, '-', ''), 10) || '_';
    exit when not exists (
      select 1 from public.categories c where c.name like staging_prefix || '%'
    );
  end loop;
  update public.categories c
    set name = staging_prefix || requested.ordinality::text
    from unnest(category_names, original_names) with ordinality as requested(name, original_name, ordinality)
    where requested.original_name = c.name
      and c.name is distinct from btrim(requested.name);

  update public.categories c
    set name = btrim(requested.name), position = requested.ordinality - 1
    from unnest(category_names, original_names) with ordinality as requested(name, original_name, ordinality)
    where (requested.original_name = c.name or c.name = staging_prefix || requested.ordinality::text)
      and (c.name is distinct from btrim(requested.name) or c.position is distinct from requested.ordinality - 1);

  insert into public.categories(name, position)
    select btrim(requested.name), requested.ordinality - 1
    from unnest(category_names, original_names) with ordinality as requested(name, original_name, ordinality)
    where requested.original_name is null;

  return query
    select coalesce(array_agg(c.name order by c.position, c.name) filter (where c.id is not null), '{}'::text[]), state.revision
      from public.category_list_state state left join public.categories c on true
      where state.id
      group by state.revision;
end;
$$;

revoke all on function public.save_categories(integer, text[], text[]) from public, anon, authenticated;
grant execute on function public.save_categories(integer, text[], text[]) to authenticated;
