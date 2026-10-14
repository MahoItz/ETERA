-- Optional cutout used on the interactive home-page tree.
alter table public.works
  add column if not exists tree_image text
    check (tree_image is null or char_length(tree_image) <= 1000),
  add column if not exists show_on_tree boolean not null default false;
