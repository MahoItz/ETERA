-- Anonymous browser identifiers only: no URLs, IP addresses or account linkage.
create table private.site_traffic_settings (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default clock_timestamp(),
  budget_minute_at timestamptz,
  minute_views integer not null default 0,
  budget_day date,
  day_views integer not null default 0,
  last_cleanup_day date
);
insert into private.site_traffic_settings(singleton) values (true);

create table private.site_traffic_visitors (
  visitor_id uuid primary key,
  session_id uuid not null default gen_random_uuid(),
  last_seen_at timestamptz,
  minute_at timestamptz,
  minute_views integer not null default 0
);
create table private.site_pageviews (
  event_id uuid primary key,
  visitor_id uuid not null,
  session_id uuid not null,
  occurred_at timestamptz not null,
  visit_started boolean not null
);
create index site_pageviews_occurred_at_idx on private.site_pageviews(occurred_at);
create index site_traffic_visitors_last_seen_idx on private.site_traffic_visitors(last_seen_at);
alter table private.site_traffic_settings enable row level security;
alter table private.site_traffic_visitors enable row level security;
alter table private.site_pageviews enable row level security;
revoke all on private.site_traffic_settings, private.site_traffic_visitors, private.site_pageviews from public, anon, authenticated;

create function private.record_site_pageview(visitor_id uuid, session_id uuid, event_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  visitor private.site_traffic_visitors%rowtype;
  settings private.site_traffic_settings%rowtype;
  recorded_at timestamptz := clock_timestamp();
  recorded_day date;
  starts_visit boolean;
  canonical_session uuid;
  inserted integer;
begin
  if visitor_id is null or session_id is null or event_id is null then
    raise exception 'Visitor, session and event identifiers are required' using errcode = '22023';
  end if;
  if private.is_admin() then return false; end if;
  if exists(select 1 from private.site_pageviews p where p.event_id = record_site_pageview.event_id) then return false; end if;

  -- Serialize the global budget before allocating any visitor or event rows.
  -- Rotating arbitrary browser IDs cannot bypass these storage limits.
  select * into settings from private.site_traffic_settings where singleton for update;
  recorded_at := clock_timestamp();
  recorded_day := (recorded_at at time zone 'Europe/Moscow')::date;
  if exists(select 1 from private.site_pageviews p where p.event_id = record_site_pageview.event_id) then return false; end if;
  if settings.last_cleanup_day is distinct from recorded_day then
    -- Bounded daily batches exceed the daily intake budget. After a long idle
    -- interval old backlog is removed over subsequent days without a large delete.
    delete from private.site_pageviews expired where expired.event_id in (
      select p.event_id from private.site_pageviews p
      where p.occurred_at < recorded_at - interval '100 days'
      order by p.occurred_at limit 20000
    );
    delete from private.site_traffic_visitors expired where expired.visitor_id in (
      select v.visitor_id from private.site_traffic_visitors v
      where v.last_seen_at < recorded_at - interval '100 days'
      order by v.last_seen_at limit 20000
    );
    update private.site_traffic_settings set last_cleanup_day=recorded_day where singleton;
  end if;
  if (settings.budget_minute_at = date_trunc('minute',recorded_at) and settings.minute_views >= 300)
    or (settings.budget_day = recorded_day and settings.day_views >= 10000) then return false; end if;

  insert into private.site_traffic_visitors(visitor_id) values (record_site_pageview.visitor_id) on conflict do nothing;
  select * into visitor from private.site_traffic_visitors v
    where v.visitor_id = record_site_pageview.visitor_id for update;
  recorded_at := clock_timestamp();
  -- Serialize each browser's events, including requests from different tabs.
  if exists(select 1 from private.site_pageviews p where p.event_id = record_site_pageview.event_id) then return false; end if;
  if visitor.minute_at = date_trunc('minute', recorded_at) and visitor.minute_views >= 60 then return false; end if;
  starts_visit := visitor.last_seen_at is null or visitor.last_seen_at <= recorded_at - interval '30 minutes';
  canonical_session := case when starts_visit then gen_random_uuid() else visitor.session_id end;
  -- The caller's session hint cannot manufacture visits by rotating its value.
  insert into private.site_pageviews(event_id,visitor_id,session_id,occurred_at,visit_started)
    values (record_site_pageview.event_id,record_site_pageview.visitor_id,canonical_session,recorded_at,starts_visit)
    on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return false; end if;
  update private.site_traffic_visitors v set session_id = canonical_session, last_seen_at = recorded_at,
    minute_at = date_trunc('minute', recorded_at),
    minute_views = case when visitor.minute_at = date_trunc('minute', recorded_at) then visitor.minute_views + 1 else 1 end
    where v.visitor_id = record_site_pageview.visitor_id;
  update private.site_traffic_settings set
    budget_minute_at=date_trunc('minute',recorded_at),
    minute_views=case when settings.budget_minute_at=date_trunc('minute',recorded_at) then settings.minute_views+1 else 1 end,
    budget_day=recorded_day,
    day_views=case when settings.budget_day=recorded_day then settings.day_views+1 else 1 end
    where singleton;
  return true;
end;
$$;
revoke all on function private.record_site_pageview(uuid,uuid,uuid) from public, anon, authenticated;
grant usage on schema private to anon;
grant execute on function private.record_site_pageview(uuid,uuid,uuid) to anon, authenticated;

create function public.record_site_pageview(visitor_id uuid, session_id uuid, event_id uuid)
returns boolean language sql volatile security invoker set search_path = ''
as $$ select private.record_site_pageview(visitor_id,session_id,event_id); $$;
revoke all on function public.record_site_pageview(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_site_pageview(uuid,uuid,uuid) to anon, authenticated;

create function private.admin_site_traffic(period_days integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  first_day date;
  result jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if period_days is null or period_days not in (7,30,90) then
    raise exception 'Choose 7, 30 or 90 days' using errcode = '22023';
  end if;
  first_day := (now() at time zone 'Europe/Moscow')::date - (period_days - 1);
  with period_views as materialized (
    select p.*, (p.occurred_at at time zone 'Europe/Moscow')::date as day
    from private.site_pageviews p
    where p.occurred_at >= (first_day::timestamp at time zone 'Europe/Moscow') and p.occurred_at <= now()
  ), totals as (
    select count(distinct visitor_id) as visitors, count(*) filter(where visit_started) as visits, count(*) as pageviews
    from period_views
  ), daily as (
    select day, count(distinct visitor_id) as visitors, count(*) filter(where visit_started) as visits, count(*) as pageviews
    from period_views group by day
  ), days as (
    select first_day + n as date, coalesce(d.visitors,0) as visitors, coalesce(d.visits,0) as visits, coalesce(d.pageviews,0) as pageviews
    from generate_series(0,period_days-1) n left join daily d on d.day = first_day + n
  )
  select to_jsonb(totals) || jsonb_build_object('days',
    (select jsonb_agg(to_jsonb(days) order by date) from days),
    'started_at',(select started_at from private.site_traffic_settings where singleton)) into result from totals;
  return result;
end;
$$;
revoke all on function private.admin_site_traffic(integer) from public, anon, authenticated;
grant execute on function private.admin_site_traffic(integer) to authenticated;

create function public.admin_site_traffic(period_days integer default 30)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_site_traffic(period_days); $$;
revoke all on function public.admin_site_traffic(integer) from public, anon, authenticated;
grant execute on function public.admin_site_traffic(integer) to authenticated;
