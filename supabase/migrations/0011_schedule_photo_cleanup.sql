-- No secret is embedded in the cron command or in client code. Only the owner
-- can read the private configuration; requests carry a dedicated random token.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create function private.dispatch_photo_cleanup()
returns bigint language plpgsql security definer set search_path = '' as $$
declare config private.photo_cleanup_config%rowtype; request_id bigint;
begin
  select c.* into config from private.photo_cleanup_config c where c.id;
  if not config.enabled or config.project_url is null then return null; end if;
  select net.http_post(
    url := config.project_url || '/functions/v1/cleanup-work-photos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', config.publishable_key),
    body := jsonb_build_object('token', config.worker_secret),
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function private.dispatch_photo_cleanup() from public, anon, authenticated, service_role;
select cron.schedule('cleanup-work-photos', '*/15 * * * *', 'select private.dispatch_photo_cleanup();');
