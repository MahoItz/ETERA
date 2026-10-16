update public.variants v
set image_url = (
  select p.url
  from public.photos p
  where p.work_id = v.work_id
  order by p.position
  limit 1
)
where v.image_url like 'blob:%';
