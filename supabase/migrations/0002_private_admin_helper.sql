-- Keep the SECURITY DEFINER helper outside the exposed `public` API schema.
create schema if not exists private;
revoke all on schema private from public;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

drop policy "admins can read profiles" on public.profiles;
drop policy "admins manage categories" on public.categories;
drop policy "admins manage site settings" on public.site_settings;
drop policy "public can read visible works" on public.works;
drop policy "admins manage works" on public.works;
drop policy "public can read visible variants" on public.variants;
drop policy "admins manage variants" on public.variants;
drop policy "public can read visible photos" on public.photos;
drop policy "admins manage photos" on public.photos;
drop policy "admins manage work photos" on storage.objects;

create policy "admins can read profiles" on public.profiles for select to authenticated using ((select private.is_admin()));
create policy "admins manage categories" on public.categories for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins manage site settings" on public.site_settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "anon can read visible works" on public.works for select to anon using (status = 'published' and availability <> 'sold');
create policy "authenticated can read visible works" on public.works for select to authenticated using ((status = 'published' and availability <> 'sold') or (select private.is_admin()));
create policy "admins manage works" on public.works for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "anon can read visible variants" on public.variants for select to anon using (exists (select 1 from public.works w where w.id = work_id and w.status = 'published' and w.availability <> 'sold'));
create policy "authenticated can read visible variants" on public.variants for select to authenticated using ((select private.is_admin()) or exists (select 1 from public.works w where w.id = work_id and w.status = 'published' and w.availability <> 'sold'));
create policy "admins manage variants" on public.variants for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "anon can read visible photos" on public.photos for select to anon using (exists (select 1 from public.works w where w.id = photos.work_id and w.status = 'published' and w.availability <> 'sold') or exists (select 1 from public.variants v join public.works w on w.id = v.work_id where v.id = photos.variant_id and w.status = 'published' and w.availability <> 'sold'));
create policy "authenticated can read visible photos" on public.photos for select to authenticated using ((select private.is_admin()) or exists (select 1 from public.works w where w.id = photos.work_id and w.status = 'published' and w.availability <> 'sold') or exists (select 1 from public.variants v join public.works w on w.id = v.work_id and w.status = 'published' and w.availability <> 'sold'));
create policy "admins manage photos" on public.photos for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins manage work photos" on storage.objects for all to authenticated using (bucket_id = 'work-photos' and (select private.is_admin())) with check (bucket_id = 'work-photos' and (select private.is_admin()));

drop function public.is_admin();
