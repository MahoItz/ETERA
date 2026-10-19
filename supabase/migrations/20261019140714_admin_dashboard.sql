-- Aggregate account data without exposing auth.users or other users' favorites.
create or replace function private.admin_dashboard(period_days integer)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  since_at timestamptz;
  result jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if period_days is null or period_days not in (7, 30, 90) then
    raise exception 'Choose 7, 30 or 90 days' using errcode = '22023';
  end if;
  since_at := now() - make_interval(days => period_days);

  with registrations as (
    select count(*) as total_users,
      count(*) filter (where created_at >= since_at and created_at <= now()) as new_users
    from auth.users where not coalesce(is_anonymous, false)
  ), saves as (
    select count(*) as total_favorites,
      count(*) filter (where created_at >= since_at and created_at <= now()) as period_favorites,
      count(distinct work_id) as favorited_works,
      count(distinct user_id) as users_with_favorites
    from public.favorites
  ), catalog as (
    select count(*) as total_works,
      count(*) filter (where status = 'published' and availability <> 'sold') as published_works,
      count(*) filter (where status = 'draft' and availability <> 'sold') as draft_works,
      count(*) filter (where status = 'archived' or availability = 'sold') as archived_works
    from public.works
  ), popular as (
    select w.id, w.slug, w.title, w.status, w.availability, count(*) as favorites,
      (select p.url from public.photos p where p.work_id = w.id order by p.position, p.id limit 1) as photo_url
    from public.favorites f join public.works w on w.id = f.work_id
    group by w.id
    order by count(*) desc, w.title, w.id
    limit 8
  )
  select to_jsonb(registrations) || to_jsonb(saves) || to_jsonb(catalog)
    || jsonb_build_object('period_days', period_days, 'generated_at', now(),
      'popular_works', coalesce((select jsonb_agg(to_jsonb(popular) order by favorites desc, title, id) from popular), '[]'::jsonb))
  into result from registrations cross join saves cross join catalog;
  return result;
end;
$$;

revoke all on function private.admin_dashboard(integer) from public, anon, authenticated;
grant execute on function private.admin_dashboard(integer) to authenticated;

-- Only this invoker wrapper is exposed through the Data API. The private
-- function checks the current user's admin profile before aggregating.
create or replace function public.admin_dashboard(period_days integer default 30)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$ select private.admin_dashboard(period_days); $$;

revoke all on function public.admin_dashboard(integer) from public, anon, authenticated;
grant execute on function public.admin_dashboard(integer) to authenticated;
