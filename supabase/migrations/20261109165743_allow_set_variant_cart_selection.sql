-- A set and each of its available variants are distinct cart positions.
-- Existing cart/message snapshots and function privileges remain unchanged.
create or replace function private.cart_selection(target_work_id uuid, target_variant_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare w public.works; v public.variants; image text;
begin
  select * into w from public.works where id = target_work_id and status = 'published' and availability <> 'sold';
  if w.id is null then raise exception 'Selection unavailable' using errcode = 'P0002'; end if;
  if target_variant_id is not null then
    select * into v from public.variants where id = target_variant_id and work_id = w.id and availability <> 'sold';
    if v.id is null then raise exception 'Variant unavailable' using errcode = 'P0002'; end if;
  elsif not w.sold_as_set and exists (select 1 from public.variants where work_id = w.id) then
    raise exception 'Choose a variant' using errcode = 'P0002';
  end if;
  if v.id is not null then
    select url into image from public.photos where variant_id = v.id order by position, id limit 1;
    image := coalesce(image, v.image_url);
  end if;
  if image is null then
    select url into image from public.photos where work_id = w.id and variant_id is null order by position, id limit 1;
  end if;
  return jsonb_build_object('work_id', w.id, 'variant_id', v.id, 'work_slug', w.slug, 'variant_slug', v.slug,
    'title', w.title, 'variant_name', v.name, 'image_url', image, 'sold_as_set', w.sold_as_set and v.id is null,
    'price', case when v.id is null then w.price else v.price end);
end;
$$;
