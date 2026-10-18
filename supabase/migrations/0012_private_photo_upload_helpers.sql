-- Keep privileged implementations outside the exposed API schema. Public RPCs
-- execute as the caller and delegate only to helpers with explicit admin checks.
alter function public.begin_work_photo_upload(uuid) set schema private;
alter function public.renew_work_photo_upload(text) set schema private;

create function public.begin_work_photo_upload(upload_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.begin_work_photo_upload(upload_id);
$$;
create function public.renew_work_photo_upload(image_url text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.renew_work_photo_upload(image_url);
$$;
revoke all on function public.begin_work_photo_upload(uuid), public.renew_work_photo_upload(text) from public, anon, authenticated, service_role;
grant execute on function public.begin_work_photo_upload(uuid), public.renew_work_photo_upload(text) to authenticated;
