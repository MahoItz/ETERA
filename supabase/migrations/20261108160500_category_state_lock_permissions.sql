-- SELECT FOR UPDATE requires an UPDATE privilege and an UPDATE RLS policy.
-- The singleton key is constrained to true, and revision remains read-only.
grant update (id) on public.category_list_state to authenticated;
create policy "admins can lock category list state" on public.category_list_state
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
