-- Closed-schema, anonymous client observations. No bodies, tokens, URLs or IPs.
create table private.site_diagnostics (
  id uuid primary key,
  received_at timestamptz not null default clock_timestamp(),
  event jsonb not null
);
create index site_diagnostics_received_idx on private.site_diagnostics(received_at desc);
create table private.site_diagnostic_budget (
  singleton boolean primary key default true check (singleton),
  minute_at timestamptz,
  minute_events integer not null default 0,
  day_at date,
  day_events integer not null default 0
);
insert into private.site_diagnostic_budget(singleton) values (true);
alter table private.site_diagnostics enable row level security;
alter table private.site_diagnostic_budget enable row level security;
revoke all on private.site_diagnostics, private.site_diagnostic_budget from public, anon, authenticated;

create function private.record_site_diagnostic(event jsonb)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare
  budget private.site_diagnostic_budget%rowtype;
  recorded_at timestamptz := clock_timestamp();
  event_id uuid;
  occurred timestamptz;
  keys text[];
begin
  if event is null or jsonb_typeof(event) <> 'object' or octet_length(event::text) > 1200 then
    raise exception 'Invalid diagnostic report' using errcode = '22023';
  end if;
  select array_agg(k order by k) into keys from jsonb_object_keys(event) as k;
  if keys is distinct from array['browser','build','duration_ms','id','kind','method','occurred_at','online','platform','resource','service','status']::text[]
    or jsonb_typeof(event->'online') <> 'boolean'
    or jsonb_typeof(event->'status') <> 'number'
    or jsonb_typeof(event->'duration_ms') <> 'number'
    or (event->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (event->>'kind') not in ('network','http','slow','body','catalog','render')
    or (event->>'service') not in ('rest','auth','app')
    or (event->>'resource') not in ('catalog_cards','site_settings','categories','category_list_state','tree_ornaments','works','profiles','favorites','favorite_counts','rpc','auth','catalog','render','other')
    or (event->>'method') not in ('GET','POST','PATCH','PUT','DELETE','HEAD','OTHER')
    or (event->>'browser') not in ('Edge','Chrome','Firefox','Safari','Other')
    or (event->>'platform') not in ('Android','iOS','Windows','macOS','Linux','Other')
    or (event->>'build') !~ '^[a-zA-Z0-9._-]{1,40}$'
    or (event->>'duration_ms') !~ '^[0-9]{1,7}$'
    or (event->>'status') !~ '^[0-9]{1,3}$'
    or exists(select 1 from jsonb_each(event) p where p.key not in ('online','status','duration_ms') and jsonb_typeof(p.value) <> 'string') then
    raise exception 'Invalid diagnostic fields' using errcode = '22023';
  end if;
  -- JSON nulls must not bypass SQL's three-valued predicates above.
  if exists(select 1 from jsonb_each(event) p where p.value = 'null'::jsonb) then
    raise exception 'Diagnostic fields cannot be null' using errcode = '22023';
  end if;
  event_id := (event->>'id')::uuid;
  occurred := (event->>'occurred_at')::timestamptz;
  if occurred < recorded_at - interval '7 days' or occurred > recorded_at + interval '5 minutes'
    or (event->>'duration_ms')::integer > 3600000
    or ((event->>'status')::integer <> 0 and (event->>'status')::integer not between 100 and 599) then
    raise exception 'Invalid diagnostic range' using errcode = '22023';
  end if;
  -- One bounded global budget cannot be bypassed by rotating anonymous IDs.
  select * into budget from private.site_diagnostic_budget where singleton for update;
  recorded_at := clock_timestamp();
  if exists(select 1 from private.site_diagnostics d where d.id = event_id) then return true; end if;
  if (budget.minute_at = date_trunc('minute', recorded_at) and budget.minute_events >= 120)
    or (budget.day_at = (recorded_at at time zone 'UTC')::date and budget.day_events >= 1000) then return false; end if;
  if budget.day_at is distinct from (recorded_at at time zone 'UTC')::date then
    delete from private.site_diagnostics expired where expired.id in (
      select d.id from private.site_diagnostics d where d.received_at < recorded_at - interval '30 days'
      order by d.received_at limit 2000
    );
  end if;
  insert into private.site_diagnostics(id,event,received_at) values (event_id,event,recorded_at);
  update private.site_diagnostic_budget set
    minute_at = date_trunc('minute', recorded_at),
    minute_events = case when budget.minute_at = date_trunc('minute', recorded_at) then budget.minute_events+1 else 1 end,
    day_at = (recorded_at at time zone 'UTC')::date,
    day_events = case when budget.day_at = (recorded_at at time zone 'UTC')::date then budget.day_events+1 else 1 end
    where singleton;
  return true;
end;
$$;
revoke all on function private.record_site_diagnostic(jsonb) from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.record_site_diagnostic(jsonb) to anon, authenticated;
create function public.record_site_diagnostic(event jsonb)
returns boolean language sql volatile security invoker set search_path = ''
as $$ select private.record_site_diagnostic(event); $$;
revoke all on function public.record_site_diagnostic(jsonb) from public, anon, authenticated;
grant execute on function public.record_site_diagnostic(jsonb) to anon, authenticated;

create function private.admin_site_diagnostics(period_days integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if period_days is null or period_days not in (1,7,30) then
    raise exception 'Choose 1, 7 or 30 days' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(reports.event || jsonb_build_object('received_at',reports.received_at) order by reports.received_at desc,reports.id), '[]'::jsonb)
    from (select d.* from private.site_diagnostics d
      where d.received_at >= now() - make_interval(days => period_days)
      order by d.received_at desc,d.id limit 100) reports);
end;
$$;
revoke all on function private.admin_site_diagnostics(integer) from public, anon, authenticated;
grant execute on function private.admin_site_diagnostics(integer) to authenticated;
create function public.admin_site_diagnostics(period_days integer default 7)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_site_diagnostics(period_days); $$;
revoke all on function public.admin_site_diagnostics(integer) from public, anon, authenticated;
grant execute on function public.admin_site_diagnostics(integer) to authenticated;
