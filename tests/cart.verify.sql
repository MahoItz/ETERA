-- Run as database owner. Every fixture/change is rolled back; Realtime does not
-- publish the uncommitted messages and existing carts/conversations are restored.
begin;
do $$
declare
  buyer uuid; master uuid; outsider uuid;
  work uuid := gen_random_uuid(); variant uuid := gen_random_uuid();
  request uuid := gen_random_uuid(); item jsonb; sent jsonb; reply jsonb; thread uuid;
begin
  select id into master from public.profiles where role = 'admin' limit 1;
  select u.id into buyer from auth.users u where not coalesce(u.is_anonymous, false)
    and not exists (select 1 from public.profiles p where p.id = u.id and p.role = 'admin') limit 1;
  select u.id into outsider from auth.users u where u.id <> buyer and u.id <> master
    and not exists (select 1 from public.profiles p where p.id = u.id and p.role = 'admin') limit 1;
  if buyer is null or master is null then raise exception 'An existing customer and admin are required'; end if;
  -- Free space only inside this rolled-back transaction.
  delete from public.cart_items where user_id = buyer;
  insert into public.works(id, title, status, availability) values (work, 'Cart verification (rolled back)', 'published', 'available');
  insert into public.variants(id, work_id, name, availability, price) values (variant, work, 'Exact variant (rolled back)', 'available', 123);
  perform set_config('request.jwt.claim.sub', buyer::text, true);
  execute 'set local role authenticated';
  item := public.cart_add(work, variant);
  if public.cart_add(work, variant)->>'id' is distinct from item->>'id' then raise exception 'Duplicate add'; end if;
  if jsonb_array_length(public.cart_list()) <> 1 then raise exception 'Cart list mismatch'; end if;
  sent := public.cart_submit(request, array[(item->>'id')::uuid], 'Verification selection (rolled back)');
  thread := (sent->>'conversation_id')::uuid;
  if sent->'message'->'selection'->0->>'variant_id' is distinct from variant::text then raise exception 'Wrong variant'; end if;
  execute 'reset role';
  if outsider is not null then
    perform set_config('request.jwt.claim.sub', outsider::text, true);
    execute 'set local role authenticated';
    if exists (select 1 from public.cart_items where id = (item->>'id')::uuid) then raise exception 'Other customer reads cart'; end if;
    if exists (select 1 from public.chat_messages where conversation_id = thread) then raise exception 'Other customer reads selection'; end if;
    execute 'reset role';
  end if;
  perform set_config('request.jwt.claim.sub', master::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.cart_items where id = (item->>'id')::uuid) then raise exception 'Master reads private cart'; end if;
  if not exists (select 1 from public.chat_messages where id = request and jsonb_array_length(selection) = 1) then raise exception 'Master cannot read attachment'; end if;
  reply := public.chat_send(gen_random_uuid(), null, thread, 'Verification reply (rolled back)');
  execute 'reset role';
  update public.variants set availability = 'sold' where id = variant;
  perform set_config('request.jwt.claim.sub', buyer::text, true);
  execute 'set local role authenticated';
  if (public.cart_list()->0->>'available')::boolean then raise exception 'Sold variant remains available'; end if;
  begin
    perform public.cart_submit(gen_random_uuid(), array[(item->>'id')::uuid], 'Unavailable');
    raise exception 'Sold variant accepted';
  exception when no_data_found then null;
  end;
  delete from public.cart_items where id = (item->>'id')::uuid;
  if public.cart_submit(request, array[(item->>'id')::uuid], 'Verification selection (rolled back)') is distinct from sent then raise exception 'Retry failed after removal'; end if;
  if not exists (select 1 from public.chat_messages where id = (reply->'message'->>'id')::uuid) then raise exception 'Reply unavailable'; end if;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.cart_list();
    raise exception 'Anon reads cart';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $$;
select 'Cart, exact variants, submission, immutable snapshot, reply, retries, availability and RLS verified; all fixtures rolled back' as verification;
rollback;
