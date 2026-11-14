-- Publish totals only; individual favorites remain protected by their RLS policies.
create or replace function private.favorite_counts()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.work_id, t.total), '{}'::jsonb)
  from (
    select f.work_id, count(*) as total
    from public.favorites f
    join public.works w on w.id = f.work_id
    where w.status = 'published' and w.availability <> 'sold'
    group by f.work_id
  ) t;
$$;

revoke all on function private.favorite_counts() from public, anon, authenticated;
grant usage on schema private to anon;
grant execute on function private.favorite_counts() to anon, authenticated;

create or replace function public.favorite_counts()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$ select private.favorite_counts(); $$;

revoke all on function public.favorite_counts() from public, anon, authenticated;
grant execute on function public.favorite_counts() to anon, authenticated;
