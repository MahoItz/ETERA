-- Run as the database owner. All fixtures and receipts are rolled back.
-- Requires the migration and at least one existing administrator.
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles limit 1), true);
set local role authenticated;

do $$
declare
  payload jsonb;
  invalid_payload jsonb;
  created jsonb;
  updated jsonb;
  replay jsonb;
  create_request uuid := gen_random_uuid();
  update_request uuid := gen_random_uuid();
  failed_request uuid;
  target_id uuid;
  previous_photos jsonb;
  previous_variants jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Verification requires an existing admin';
  end if;
  payload := jsonb_build_object(
    'title', 'Atomic save verification (rolled back)', 'description', '',
    'category', 'Atomic test ' || gen_random_uuid()::text, 'material', 'Гипс', 'dimensions', '',
    'price', null, 'availability', 'order', 'status', 'published', 'featured', false,
    'photos', jsonb_build_array(jsonb_build_object('url', 'images/atomic-test.jpg', 'alt', 'Test')),
    'variants', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'name', 'Test variant',
      'imageUrl', 'images/atomic-test.jpg', 'price', 100, 'availability', 'order'))
  );
  -- Creation must also roll back if insertion of a child fails.
  failed_request := gen_random_uuid();
  invalid_payload := jsonb_set(payload, '{photos,0,url}', to_jsonb(repeat('x', 1001)));
  begin
    perform public.save_work(failed_request, null, null, invalid_payload);
    raise exception 'Expected photo constraint failure';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.categories where name = payload->>'category')
    or exists (select 1 from public.work_save_requests where request_id = failed_request) then
    raise exception 'Failed create left a category or receipt behind';
  end if;
  created := public.save_work(create_request, null, null, payload);
  target_id := (created->>'id')::uuid;
  replay := public.save_work(create_request, null, null, payload);
  if replay <> created or (created->>'revision')::integer <> 1 then
    raise exception 'Create replay changed the result';
  end if;
  if (select count(*) from public.works where category_id = (created->>'category_id')::uuid) <> 1 then
    raise exception 'Create replay produced a duplicate';
  end if;
  previous_photos := created->'photos';
  previous_variants := created->'variants';

  -- Both failures occur after the parent row is updated inside the RPC.
  for invalid_payload in
    select jsonb_set(payload, '{photos,0,url}', to_jsonb(repeat('x', 1001)))
    union all select jsonb_set(payload, '{variants,0,price}', '-1'::jsonb)
  loop
    failed_request := gen_random_uuid();
    begin
      perform public.save_work(failed_request, target_id, 1, invalid_payload);
      raise exception 'Expected child insertion failure';
    exception when check_violation then null;
    end;
    if (select revision from public.works where id = target_id) <> 1
      or (select jsonb_agg(to_jsonb(p) order by position) from public.photos p where p.work_id = target_id) <> previous_photos
      or (select jsonb_agg(to_jsonb(v) order by position) from public.variants v where v.work_id = target_id) <> previous_variants
      or exists (select 1 from public.work_save_requests where request_id = failed_request)
      or exists (select 1 from public.work_photo_cleanup where url = 'images/atomic-test.jpg') then
      raise exception 'Child failure did not roll back the whole save';
    end if;
  end loop;

  updated := public.save_work(update_request, target_id, 1, payload);
  replay := public.save_work(update_request, target_id, 1, payload);
  if replay <> updated or (updated->>'revision')::integer <> 2
    or (select revision from public.works where id = target_id) <> 2 then
    raise exception 'Update replay incremented revision';
  end if;
  begin
    perform public.save_work(gen_random_uuid(), target_id, 1, payload);
    raise exception 'Expected stale revision rejection';
  exception when serialization_failure then null;
  end;
  begin
    perform public.save_work(create_request, null, null, jsonb_set(payload, '{title}', '"Changed payload"'));
    raise exception 'Expected request ID mismatch rejection';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- A signed-in user without an admin profile must not write or see receipts.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$
begin
  begin
    perform public.save_work(gen_random_uuid(), null, null, '{}'::jsonb);
    raise exception 'Non-admin was allowed to save';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.work_save_requests) then
    raise exception 'Non-admin can read save receipts';
  end if;
end;
$$;
set local role anon;
do $$
begin
  if has_function_privilege(current_user, 'public.save_work(uuid,uuid,integer,jsonb)', 'EXECUTE') then
    raise exception 'Anonymous RPC execution is allowed';
  end if;
end;
$$;
rollback;
select 'atomic save, rollback, retries, revisions and RLS verified' as verification;
