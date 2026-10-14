-- Each ornament has its own image; several ornaments may link to one work.
create table public.tree_ornaments (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  image_url text not null check (char_length(image_url) between 1 and 1000),
  work_id uuid not null references public.works(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index tree_ornaments_work_idx on public.tree_ornaments(work_id);
alter table public.tree_ornaments enable row level security;
create policy "public can read visible ornaments" on public.tree_ornaments
  for select to anon, authenticated using (
    exists (
      select 1 from public.works w where w.id = work_id
      and w.status = 'published' and w.availability <> 'sold'
    )
  );
create policy "admins manage tree ornaments" on public.tree_ornaments
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
-- Preserve previously configured images without copying Storage objects.
insert into public.tree_ornaments (id, title, image_url, work_id, position)
select id, title, tree_image, id, row_number() over(order by featured desc, updated_at desc)::integer
from public.works where tree_image is not null and show_on_tree
on conflict (id) do nothing;
