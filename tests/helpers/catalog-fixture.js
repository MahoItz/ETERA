// Shared adapter for older browser fixtures after splitting summaries from details.
export function catalogFixture(works, href) {
  const p = new URL(href).searchParams;
  let rows = works.filter(work => !p.get('status') || work.status === p.get('status').slice(3));
  if (p.get('availability') === 'neq.sold') rows = rows.filter(work => work.availability !== 'sold');
  if (p.get('category_name')) rows = rows.filter(work => (work.category?.name ?? 'Без категории') === p.get('category_name').slice(3));
  if (p.get('id')?.startsWith('in.')) rows = rows.filter(work => p.get('id').includes(work.id));
  if (p.get('cover_url')) rows = rows.filter(work => work.photos?.length);
  const price = work => work.sold_as_set || !work.variants?.length ? work.price
    : work.variants.filter(variant => variant.availability !== 'sold' && variant.price !== null).map(variant => variant.price).sort((a,b)=>a-b)[0] ?? null;
  if (p.get('search_text')) {
    const query = p.get('search_text').slice(7,-1).replace(/\\([%_\\])/g,'$1').toLocaleLowerCase('ru');
    rows = rows.filter(work => `${work.title} ${work.description} ${work.material}`.toLocaleLowerCase('ru').includes(query));
  }
  rows.sort((a,b) => {
    if (p.get('order')?.startsWith('title')) return a.title.localeCompare(b.title,'ru');
    if (p.get('order')?.startsWith('catalog_price')) return (price(a)??Infinity)-(price(b)??Infinity);
    return Number(b.featured)-Number(a.featured)||b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id);
  });
  const total=rows.length,offset=Number(p.get('offset')||0),limit=Number(p.get('limit')||24);
  rows=rows.slice(offset,offset+limit).map(work=>({
    id:work.id,slug:work.slug,title:work.title,material:work.material,dimensions:work.dimensions,measurements:work.measurements,
    sold_as_set:work.sold_as_set,price:work.price,availability:work.availability,status:work.status,featured:work.featured,
    revision:work.revision,updated_at:work.updated_at,category_name:work.category?.name??'Без категории',
    cover_url:work.photos?.[0]?.url,cover_alt:work.photos?.[0]?.alt,photo_count:work.photos?.length??0,
    variant_count:work.variants?.length??0,catalog_price:price(work),
  }));
  return {rows,total};
}
