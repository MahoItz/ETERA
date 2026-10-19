-- Run as owner. All fixtures, save receipts and cleanup candidates are rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' limit 1),true);
set local role authenticated;
do $$
declare payload jsonb; saved jsonb; updated jsonb; gallery jsonb; request uuid := gen_random_uuid(); target uuid;
begin
  payload := jsonb_build_object('title','Variant gallery verification (rolled back)', 'description','',
    'category','Variant gallery verification (rolled back)', 'material','Гипс', 'dimensions','', 'measurements',null,
    'soldAsSet',false, 'price',12345, 'availability','available', 'status','draft', 'featured',false,
    'photos',jsonb_build_array(jsonb_build_object('url','images/gallery-shared.webp','alt','Общий вид')),
    'variants',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','Отдельная фигурка',
      'description','Своё описание','price',null,'availability','order','measurements',null,
      'photos',jsonb_build_array(jsonb_build_object('url','images/gallery-one.webp','alt','Первое'),
        jsonb_build_object('url','images/gallery-shared.webp','alt','Второе')))));
  saved := public.save_work(request,null,null,payload);
  target := (saved->>'id')::uuid;
  if public.save_work(request,null,null,payload) is distinct from saved then raise exception 'Replay changed galleries'; end if;
  if jsonb_array_length(saved->'photos') <> 1 or jsonb_array_length(saved->'variants'->0->'photos') <> 2
    or saved->'variants'->0->>'image_url' <> 'images/gallery-one.webp'
    or saved->'variants'->0->>'description' <> 'Своё описание'
    or saved->'variants'->0->'price' <> 'null'::jsonb then raise exception 'Independent gallery did not round-trip'; end if;
  payload := jsonb_set(payload,'{variants,0,photos}',jsonb_build_array(
    jsonb_build_object('url','images/gallery-shared.webp','alt','Новая обложка')));
  payload := jsonb_set(payload,'{soldAsSet}','true');
  updated := public.save_work(gen_random_uuid(),target,1,payload);
  if updated->'variants'->0->>'image_url' <> 'images/gallery-shared.webp'
    or updated->>'sold_as_set' <> 'true'
    or not exists(select 1 from public.work_photo_cleanup where url='images/gallery-one.webp') then
    raise exception 'Cover, sale mode or cleanup failed';
  end if;
  begin
    perform public.save_work(gen_random_uuid(),target,2,
      jsonb_set(jsonb_set(payload,'{status}','"published"'),'{variants,0,photos}','[]'));
    raise exception 'Empty published gallery was accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select revision from public.works where id=target) <> 2 then raise exception 'Invalid gallery did not roll back'; end if;
  select jsonb_agg(jsonb_build_object('url','images/gallery-limit-' || n || '.webp','alt',''))
    into gallery from generate_series(1,20) n;
  payload := jsonb_set(jsonb_set(payload,'{photos}',gallery),'{variants,0,photos}',gallery);
  updated := public.save_work(gen_random_uuid(),target,2,payload);
  if jsonb_array_length(updated->'photos') <> 20
    or jsonb_array_length(updated->'variants'->0->'photos') <> 20 then
    raise exception 'Twenty photos per gallery did not round-trip';
  end if;
  gallery := gallery || jsonb_build_array(jsonb_build_object('url','images/gallery-limit-21.webp','alt',''));
  begin
    perform public.save_work(gen_random_uuid(),target,3,jsonb_set(payload,'{photos}',gallery));
    raise exception 'Oversized main gallery was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_work(gen_random_uuid(),target,3,jsonb_set(payload,'{variants,0,photos}',gallery));
    raise exception 'Oversized variant gallery was accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select revision from public.works where id=target) <> 3 then raise exception 'Oversized gallery did not roll back'; end if;
end;
$$;
rollback;
select 'Independent galleries, covers, replay, sale mode, cleanup and 20-photo limits verified; fixtures rolled back' as verification;
