-- Read-only summaries. The caller's underlying RLS still controls every row.
create view public.catalog_cards with (security_invoker = true) as
select w.id, w.slug, w.title, w.material, w.dimensions, w.measurements,
  w.sold_as_set, w.price, w.availability, w.status, w.featured, w.revision, w.updated_at,
  coalesce(c.name, 'Без категории') as category_name,
  w.title || ' ' || w.description || ' ' || w.material as search_text,
  cover.url as cover_url, cover.alt as cover_alt,
  (select count(*)::int from public.photos p where p.work_id = w.id) as photo_count,
  variants.variant_count,
  case when w.sold_as_set or variants.variant_count = 0 then w.price else variants.min_price end as catalog_price,
  coalesce(((select public.favorite_counts()) ->> w.id::text)::int, 0) as favorite_count
from public.works w
left join public.categories c on c.id = w.category_id
left join lateral (
  select p.url, p.alt from public.photos p where p.work_id = w.id
  order by p.position, p.id limit 1
) cover on true
cross join lateral (
  select count(*)::int as variant_count,
    min(v.price) filter (where v.availability <> 'sold') as min_price
  from public.variants v where v.work_id = w.id
) variants;

revoke all on public.catalog_cards from public, anon, authenticated;
grant select on public.catalog_cards to anon, authenticated;
