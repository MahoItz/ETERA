-- Customer accounts and their saved catalogue works.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'customer'));

create or replace function private.create_customer_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'customer')
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.create_customer_profile() from public;

drop trigger if exists create_customer_profile on auth.users;
create trigger create_customer_profile
  after insert on auth.users
  for each row execute procedure private.create_customer_profile();

create table public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

create index favorites_user_created_at_idx on public.favorites (user_id, created_at desc);

alter table public.favorites enable row level security;

grant select on public.profiles to authenticated;
grant select, insert, delete on public.favorites to authenticated;

create policy "users can read own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "users can read own favorites"
  on public.favorites for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users can add visible works to favorites"
  on public.favorites for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.works
      where id = work_id and status = 'published' and availability <> 'sold'
    )
  );

create policy "users can remove own favorites"
  on public.favorites for delete to authenticated
  using ((select auth.uid()) = user_id);
