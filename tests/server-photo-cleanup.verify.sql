-- Database owner only. The fixture paths have no Storage objects. Everything
-- below is rolled back, including config changes, leases, claims and tombstones.
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role = 'admin' limit 1), true);
do $$
declare
  worker_secret text;
  image_url text;
  fixture_path text := 'works/verify-' || gen_random_uuid()::text || '.webp';
  first_work uuid;
  second_work uuid;
  claim record;
  upload jsonb;
begin
  update private.photo_cleanup_config set enabled = true where id returning photo_cleanup_config.worker_secret into worker_secret;
  image_url := private.photo_url(fixture_path);
  if image_url is null then raise exception 'Configure photo cleanup before verification'; end if;
  insert into public.works(title, status) values ('Photo cleanup verification', 'draft') returning id into first_work;
  insert into public.works(title, status) values ('Shared photo verification', 'archived') returning id into second_work;
  insert into public.photos(work_id,url) values (first_work,image_url);
  insert into public.variants(work_id,name,image_url) values (second_work,'Shared variant',image_url);
  delete from public.photos where work_id=first_work;
  update public.work_photo_cleanup set available_at=now()-interval '1 day',protected_until=null where storage_path=fixture_path;
  -- Claiming is limited to this fixture; the transaction rolls back all effects.
  if exists (select 1 from public.claim_work_photo_cleanup(worker_secret) c where c.object_path=fixture_path) then
    raise exception 'Shared variant image was claimed';
  end if;
  delete from public.variants where work_id=second_work;
  if not exists (select 1 from public.work_photo_cleanup q where q.storage_path=fixture_path and q.available_at > now()) then
    raise exception 'Final reference removal did not reset the grace period';
  end if;
  update public.work_photo_cleanup set available_at=now()-interval '1 day',protected_until=null where storage_path=fixture_path;
  select c.* into claim from public.claim_work_photo_cleanup(worker_secret) c where c.object_path=fixture_path;
  if claim.claim_token is null or not public.confirm_work_photo_cleanup(worker_secret,fixture_path,claim.claim_token) then
    raise exception 'Unused image was not confirmed';
  end if;
  begin
    insert into public.photos(work_id,url) values (second_work,image_url);
    raise exception 'A new reference bypassed the deleting state';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform public.finish_work_photo_cleanup(worker_secret,fixture_path,claim.claim_token,'Injected Storage failure');
  if not exists (select 1 from public.work_photo_cleanup q where q.storage_path=fixture_path and q.state='deleting'
    and q.last_error='Injected Storage failure' and q.available_at > now()) then
    raise exception 'Storage error was not retained for retry';
  end if;
  upload := public.begin_work_photo_upload(gen_random_uuid());
  if not public.renew_work_photo_upload(upload->>'url') then raise exception 'Upload protection could not be renewed'; end if;
  if exists (select 1 from public.claim_work_photo_cleanup(worker_secret) c where c.object_path=upload->>'path') then
    raise exception 'Protected temporary upload was claimed';
  end if;
end;
$$;
set local role authenticated;
do $$
begin
  if has_function_privilege(current_user,'public.claim_work_photo_cleanup(text)','EXECUTE') then
    raise exception 'Browser can claim cleanup work';
  end if;
  if has_table_privilege(current_user,'public.work_photo_cleanup','DELETE') then
    raise exception 'Browser can remove cleanup state';
  end if;
end;
$$;
rollback;
select 'shared references, deletion guard, retries and temporary uploads verified' as verification;
