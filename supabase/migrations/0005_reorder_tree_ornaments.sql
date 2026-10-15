-- Save a complete ornament order atomically, without overwriting its content.
-- No existing rows are changed when this migration is applied.
create function public.reorder_tree_ornaments(
  ordered_ids uuid[],
  expected_ids uuid[],
  expected_positions integer[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_ids uuid[];
  current_positions integer[];
begin
  if not (select private.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if ordered_ids is null or expected_ids is null or expected_positions is null
    or coalesce(array_ndims(ordered_ids), 1) <> 1
    or coalesce(array_ndims(expected_ids), 1) <> 1
    or coalesce(array_ndims(expected_positions), 1) <> 1
    or cardinality(ordered_ids) <> cardinality(expected_ids)
    or cardinality(expected_positions) <> cardinality(expected_ids)
    or exists (select 1 from unnest(ordered_ids) as ids(id) where id is null)
    or (select count(distinct id) from unnest(ordered_ids) as ids(id)) <> cardinality(ordered_ids)
    or exists (
      select id from unnest(ordered_ids) as ids(id)
      except
      select id from unnest(expected_ids) as ids(id)
    ) then
    raise exception 'Invalid ornament order' using errcode = '22023';
  end if;

  -- Serialize briefly with inserts, deletes, content edits and other reorders.
  -- SECURITY INVOKER and the existing RLS policies still apply.
  lock table public.tree_ornaments in share row exclusive mode;

  select coalesce(array_agg(id order by position, id), '{}'::uuid[]),
         coalesce(array_agg(position order by position, id), '{}'::integer[])
    into current_ids, current_positions
    from public.tree_ornaments;

  if current_ids is distinct from expected_ids
    or current_positions is distinct from expected_positions then
    raise exception 'Ornament order has changed; reload before retrying' using errcode = '40001';
  end if;

  update public.tree_ornaments as ornament
    set position = (ordered.ordinality - 1)::integer
    from unnest(ordered_ids) with ordinality as ordered(id, ordinality)
    where ornament.id = ordered.id
      and ornament.position is distinct from (ordered.ordinality - 1)::integer;
end;
$$;

revoke all on function public.reorder_tree_ornaments(uuid[], uuid[], integer[]) from public, anon, authenticated;
grant execute on function public.reorder_tree_ornaments(uuid[], uuid[], integer[]) to authenticated;

-- Rollback (does not undo a subsequently saved order):
-- drop function public.reorder_tree_ornaments(uuid[], uuid[], integer[]);
