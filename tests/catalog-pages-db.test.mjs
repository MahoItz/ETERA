import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';
let db, ids, categoryId;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
before(async () => {
  db = await createTestDatabase();
  await db.exec(`delete from public.works;
    insert into auth.users(id) values ('${admin}'), ('${customer}');
    update public.profiles set role='admin' where id='${admin}';`);
  categoryId = (await db.query("insert into public.categories(name) values ('Тестовая категория') returning id")).rows[0].id;
  ids = (await db.query(`insert into public.works(title,description,material,status,availability,price,category_id)
    select 'Работа ' || lpad(n::text,3,'0'), case when n=60 then 'Скрытое слово для поиска' else repeat('Описание ',100) end,
      'Гипс','published','available',n,$1 from generate_series(1,61) n returning id`, [categoryId])).rows.map(row => row.id);
  await db.query(`insert into public.photos(work_id,url,alt,position)
    select w.id, 'https://example.com/' || w.id || '/' || n || '.webp', 'Ракурс ' || n, n
    from public.works w cross join generate_series(0,19) n`);
  await db.query(`insert into public.works(title,status,availability) values ('Черновик','draft','available'),
    ('Архив','archived','available'),('Продано','published','sold')`);
});
after(() => db.close());
async function isolated(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}
test('server pages are bounded, stable, distinct and contain one cover with accurate photo counts', () => isolated(async () => {
  await db.exec('set local role anon');
  const page = async offset => (await db.query('select * from public.catalog_cards order by title,id limit 24 offset $1', [offset])).rows;
  const first = await page(0), second = await page(24), third = await page(48);
  assert.deepEqual([first.length,second.length,third.length],[24,24,13]);
  assert.equal(new Set([...first,...second,...third].map(row=>row.id)).size,61);
  assert.deepEqual(await page(0),first);
  assert.equal(first[0].photo_count,20);
  assert.ok(first.every(row=>row.cover_url.endsWith('/0.webp')));
  assert.ok(!Object.hasOwn(first[0],'photos') && !Object.hasOwn(first[0],'variants') && !Object.hasOwn(first[0],'description'));
  assert.equal((await db.query('select count(*)::int as total from public.catalog_cards')).rows[0].total,61);
}));
test('search includes descriptions outside the first page; category and price sort happen before LIMIT', () => isolated(async () => {
  await db.exec('set local role anon');
  assert.equal((await db.query("select title from public.catalog_cards where search_text ilike '%Скрытое слово%' limit 24")).rows[0].title,'Работа 060');
  assert.equal((await db.query("select count(*)::int as n from public.catalog_cards where category_name='Тестовая категория'")).rows[0].n,61);
  const prices = (await db.query('select catalog_price from public.catalog_cards order by catalog_price desc nulls last,id limit 2')).rows;
  assert.deepEqual(prices.map(row=>Number(row.catalog_price)),[61,60]);
}));
test('catalog price distinguishes sets, individual variants, sold variants, zero and unknown prices', () => isolated(async () => {
  await db.query(`insert into public.variants(work_id,name,price,availability) values
    ($1,'Дорогая',500,'available'),($1,'Бесплатная',0,'available'),($1,'Проданная',1,'sold'),($2,'Без цены',null,'available')`, [ids[0],ids[1]]);
  const value = async id => (await db.query('select catalog_price,variant_count from public.catalog_cards where id=$1',[id])).rows[0];
  assert.equal(Number((await value(ids[0])).catalog_price),0);
  assert.equal((await value(ids[0])).variant_count,3);
  assert.equal((await value(ids[1])).catalog_price,null);
  await db.query('update public.works set sold_as_set=true,price=900 where id=$1',[ids[0]]);
  assert.equal(Number((await value(ids[0])).catalog_price),900);
}));
test('popularity uses public totals, rather than only the requesting customer favorites', () => isolated(async () => {
  await db.query('insert into public.favorites(user_id,work_id) values ($1,$3),($2,$3),($1,$4)',[admin,customer,ids[60],ids[0]]);
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${customer}',true)`);
  const rows = (await db.query('select id,favorite_count from public.catalog_cards order by favorite_count desc,id limit 2')).rows;
  assert.deepEqual(rows,[{id:ids[60],favorite_count:2},{id:ids[0],favorite_count:1}]);
  assert.equal((await db.query('select count(*)::int as n from public.favorites')).rows[0].n,1);
}));
test('summary view preserves RLS for guests/customers, allows admin reads and never allows writes', () => isolated(async () => {
  const hidden = (await db.query("select id from public.works where status<>'published' or availability='sold'")).rows.map(row=>row.id);
  for (const role of ['anon','authenticated']) {
    await db.exec(`set local role ${role}; select set_config('request.jwt.claim.sub','${role==='authenticated'?customer:''}',true)`);
    assert.deepEqual((await db.query('select id from public.catalog_cards where id=any($1::uuid[])',[hidden])).rows,[]);
    await db.exec('savepoint write_view');
    await assert.rejects(()=>db.query("update public.catalog_cards set title='Hacked'"),error=>error.code==='42501'||error.code==='55000');
    await db.exec('rollback to savepoint write_view; release savepoint write_view');
  }
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',true)`);
  assert.equal((await db.query('select id from public.catalog_cards where id=any($1::uuid[])',[hidden])).rows.length,3);
}));
