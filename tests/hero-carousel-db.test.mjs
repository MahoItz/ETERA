import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let works;
const save = async (expected, ordered) => (await db.query(
  'select public.save_hero_carousel($1::uuid[],$2::uuid[]) as result', [expected, ordered],
)).rows[0].result;
const current = async () => (await db.query('select hero_work_ids from public.site_settings')).rows[0].hero_work_ids;
async function isolated(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}
async function rejectsSql(fn, code) {
  await db.exec('savepoint invalid_carousel');
  try { await assert.rejects(fn, error => error.code === code); }
  finally { await db.exec('rollback to savepoint invalid_carousel; release savepoint invalid_carousel'); }
}
const asAdmin = () => db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${admin}',true)`);

before(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into auth.users(id) values ('${admin}'), ('${customer}');
    update public.profiles set role='admin' where id='${admin}';`);
  works = (await db.query(`insert into public.works(title,status,availability)
    select 'Carousel ' || n, 'published', 'available' from generate_series(1,11) as n returning id`)).rows.map(row => row.id);
  await db.query(`insert into public.photos(work_id,url) select id, 'https://example.com/' || id || '.webp'
    from public.works where id=any($1::uuid[])`, [works]);
});
after(() => db.close());

test('public reads default and explicit order; anon and customer cannot write by RPC or table', () => isolated(async () => {
  await db.exec('set local role anon');
  assert.equal(await current(), null);
  await rejectsSql(() => save(null, []), '42501');
  assert.equal((await db.query("update public.site_settings set hero_work_ids='{}' returning id")).rows.length, 0);
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${customer}',true)`);
  await rejectsSql(() => save(null, []), '42501');
  assert.equal((await db.query("update public.site_settings set hero_work_ids='{}' returning id")).rows.length, 0);
  await asAdmin();
  assert.deepEqual(await save(null, works.slice(0, 2)), { ids: works.slice(0, 2) });
  await db.exec('set local role anon');
  assert.deepEqual(await current(), works.slice(0, 2));
}));

test('manual order, empty list and automatic selection are distinct; unrelated settings survive', () => isolated(async () => {
  await asAdmin();
  const settings = (await db.query('select name, contact, hero_mode, vk, telegram, phone from public.site_settings')).rows[0];
  const ordered = [works[2], works[0], works[1]];
  assert.deepEqual(await save(null, ordered), { ids: ordered });
  assert.deepEqual(await current(), ordered);
  await db.query("update public.site_settings set name='Concurrent name', hero_mode='new-year'");
  assert.deepEqual(await save(ordered, []), { ids: [] });
  assert.deepEqual(await current(), []);
  assert.deepEqual((await db.query('select name, hero_mode from public.site_settings')).rows[0], { name: 'Concurrent name', hero_mode: 'new-year' });
  assert.deepEqual(await save([], null), { ids: null });
  assert.equal(await current(), null);
  const remaining = (await db.query('select contact, vk, telegram, phone from public.site_settings')).rows[0];
  for (const [key, value] of Object.entries(remaining)) assert.equal(value, settings[key]);
}));

test('stale saves cannot overwrite a changed list, including null versus empty', () => isolated(async () => {
  await asAdmin();
  await save(null, []);
  await rejectsSql(() => save(null, [works[0]]), '40001');
  assert.deepEqual(await current(), []);
  await save([], [works[1], works[0]]);
  await rejectsSql(() => save([], null), '40001');
  await rejectsSql(() => save([works[0], works[1]], null), '40001');
  assert.deepEqual(await current(), [works[1], works[0]]);
}));

test('ten cards allowed; duplicate, null, oversized and multidimensional arrays are rejected', () => isolated(async () => {
  await asAdmin();
  await save(null, works.slice(0, 10));
  for (const invalid of [[works[0], works[0]], [null], works, [[works[0]], [works[1]]]]) {
    await rejectsSql(() => save(works.slice(0, 10), invalid), '22023');
    assert.deepEqual(await current(), works.slice(0, 10));
  }
  await rejectsSql(() => db.query("update public.site_settings set hero_work_ids=$1::uuid[]", [works]), '23514');
  await rejectsSql(() => db.query("update public.site_settings set hero_work_ids=array[null]::uuid[]"), '23514');
}));

test('deleted, draft, sold, archived and missing-main-photo works are rejected atomically', () => isolated(async () => {
  await db.query("update public.works set status='draft' where id=$1", [works[1]]);
  await db.query("update public.works set availability='sold' where id=$1", [works[2]]);
  await db.query("update public.works set status='archived' where id=$1", [works[3]]);
  await db.query('delete from public.photos where work_id=$1', [works[4]]);
  const variant = (await db.query("insert into public.variants(work_id,name) values($1,'Variant only') returning id", [works[4]])).rows[0].id;
  await db.query("insert into public.photos(variant_id,url) values($1,'https://example.com/variant.webp')", [variant]);
  await db.query('delete from public.works where id=$1', [works[5]]);
  await asAdmin();
  await save(null, [works[0]]);
  for (const id of [...works.slice(1, 6), crypto.randomUUID()]) {
    await rejectsSql(() => save([works[0]], [works[0], id]), '22023');
    assert.deepEqual(await current(), [works[0]]);
  }
  await db.query("update public.works set availability='sold' where id=$1", [works[0]]);
  await save([works[0]], null);
  assert.equal(await current(), null);
}));

test('RPC runs with invoker permissions and does not grant anon execution', async () => {
  const result = (await db.query(`select prosecdef, proconfig,
    has_function_privilege('anon', oid, 'execute') as anon_execute,
    has_function_privilege('authenticated', oid, 'execute') as authenticated_execute
    from pg_proc where oid='public.save_hero_carousel(uuid[],uuid[])'::regprocedure`)).rows[0];
  assert.equal(result.prosecdef, false);
  assert.equal(result.anon_execute, false);
  assert.equal(result.authenticated_execute, true);
  assert.ok(result.proconfig.some(value => value.startsWith('search_path=')));
});
