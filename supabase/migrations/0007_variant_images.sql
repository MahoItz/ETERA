alter table public.variants
  add column if not exists image_url text check (image_url is null or char_length(image_url) <= 1000);
