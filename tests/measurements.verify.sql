-- Run as the database owner. All test records and suggestions are rolled back.
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role='admin' limit 1), true);
set local role authenticated;
do $$
declare payload jsonb; saved jsonb; updated jsonb; before_count integer;
begin
  payload := jsonb_build_object(
    'title', 'Dimension verification (rolled back)', 'description', '', 'category', 'Dimension verification (rolled back)',
    'material', 'Гипс', 'dimensions', '', 'price', null, 'availability', 'order', 'status', 'draft', 'featured', false,
    'measurements', jsonb_build_object('heightMm', 80, 'widthMm', 55, 'depthMm', null, 'unit', 'cm'),
    'photos', '[]'::jsonb,
    'variants', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'name', 'Variant', 'imageUrl', null,
      'price', null, 'availability', 'order', 'measurements', jsonb_build_object('heightMm',95,'widthMm',null,'depthMm',null,'unit','mm')))
  );
  saved := public.save_work(gen_random_uuid(), null, null, payload);
  if saved->'measurements' is distinct from payload->'measurements'
    or saved->'variants'->0->'measurements' is distinct from payload->'variants'->0->'measurements' then
    raise exception 'Structured dimensions did not round-trip';
  end if;
  if not exists(select 1 from public.dimension_suggestions where value_mm=95) then raise exception 'History not saved'; end if;
  delete from public.dimension_suggestions where value_mm=80;
  updated := public.save_work(gen_random_uuid(), (saved->>'id')::uuid, 1, jsonb_set(payload,'{measurements,unit}','"mm"'));
  if exists(select 1 from public.dimension_suggestions where value_mm=80) then raise exception 'Deleted suggestion was restored'; end if;
  select count(*) into before_count from public.work_save_requests;
  begin
    perform public.save_work(gen_random_uuid(), null, null,
      jsonb_set(jsonb_set(payload,'{variants}','[]'),'{measurements,heightMm}','-1'));
    raise exception 'Invalid size accepted';
  exception when check_violation then null;
  end;
  if (select count(*) from public.work_save_requests) <> before_count then raise exception 'Invalid save left a receipt'; end if;
end;
$$;
rollback;
select 'Dimensions, variants, suggestions, deletion and validation verified; all fixtures rolled back' as verification;
