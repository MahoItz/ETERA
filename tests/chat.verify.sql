-- Run as database owner. Fixtures and messages are rolled back, so no
-- notifications are published and no real conversations are changed.
begin;
do $$
declare
  buyer uuid;
  master uuid;
  outsider uuid;
  work uuid := gen_random_uuid();
  request uuid := gen_random_uuid();
  first jsonb;
  reply jsonb;
  thread uuid;
  unread integer;
begin
  select p.id into master from public.profiles p where p.role = 'admin' limit 1;
  select u.id into buyer from auth.users u where not coalesce(u.is_anonymous, false)
    and not exists (select 1 from public.profiles p where p.id=u.id and p.role='admin') limit 1;
  select u.id into outsider from auth.users u where u.id<>buyer and u.id<>master
    and not exists (select 1 from public.profiles p where p.id=u.id and p.role='admin') limit 1;
  if master is null or buyer is null then raise exception 'An existing admin and customer are required'; end if;
  insert into public.works(id,title,status,availability) values(work,'Chat verification (rolled back)','published','available');
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  execute 'set local role authenticated';
  first := public.chat_send(request,work,null,'Verification question (rolled back)');
  thread := (first->>'conversation_id')::uuid;
  if public.chat_send(request,work,null,'Verification question (rolled back)') is distinct from first then raise exception 'Idempotent retry failed'; end if;
  execute 'reset role';
  if outsider is not null then
    perform set_config('request.jwt.claim.sub',outsider::text,true);
    execute 'set local role authenticated';
    if exists(select 1 from public.chat_messages where conversation_id=thread) then raise exception 'Other customer can read messages'; end if;
    begin
      perform public.chat_send(gen_random_uuid(),null,thread,'Unauthorized message');
      raise exception 'Other customer can send';
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
  end if;
  perform set_config('request.jwt.claim.sub',master::text,true);
  execute 'set local role authenticated';
  select (value->>'unread_count')::integer into unread from jsonb_array_elements(public.chat_inbox()->'threads') where value->>'id'=thread::text;
  if unread is distinct from 1 then raise exception 'Master unread count failed'; end if;
  perform public.chat_mark_read(thread,(first->'message'->>'seq')::bigint);
  reply := public.chat_send(gen_random_uuid(),null,thread,'Verification reply (rolled back)');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  execute 'set local role authenticated';
  select (value->>'unread_count')::integer into unread from jsonb_array_elements(public.chat_inbox()->'threads') where value->>'id'=thread::text;
  if unread is distinct from 1 then raise exception 'Buyer unread count failed'; end if;
  perform public.chat_mark_read(thread,(reply->'message'->>'seq')::bigint);
  select (value->>'unread_count')::integer into unread from jsonb_array_elements(public.chat_inbox()->'threads') where value->>'id'=thread::text;
  if unread is distinct from 0 then raise exception 'Read receipt failed'; end if;
  begin
    perform public.chat_delete(thread,(first->'message'->>'id')::uuid);
    raise exception 'Stale delete confirmation was accepted';
  exception when serialization_failure then null;
  end;
  perform public.chat_delete(thread,(reply->'message'->>'id')::uuid);
  perform public.chat_delete(thread,(reply->'message'->>'id')::uuid);
  if exists(select 1 from public.chat_messages where conversation_id=thread) then raise exception 'Deleted messages remain'; end if;
  if exists(select 1 from jsonb_array_elements(public.chat_inbox()->'threads') where value->>'id'=thread::text) then raise exception 'Deleted conversation remains in inbox'; end if;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.chat_inbox();
    raise exception 'Anonymous inbox access allowed';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $$;
select 'Chat send/reply/delete, confirmation snapshots, retries, isolation and unread receipts verified; all fixtures rolled back' as verification;
rollback;
