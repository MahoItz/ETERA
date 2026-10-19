import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const first = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const second = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const anonymous = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const workIds = [1, 2, 3, 4, 5].map(n => `00000000-0000-4000-8000-00000000000${n}`);
const dashboard = async (days = 30) => (await db.query('select public.admin_dashboard($1) as data', [days])).rows[0].data;
async function isolated(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}
async function rejected(fn, code) {
  await db.exec('savepoint forbidden');
  try { await assert.rejects(fn, error => error.code === code); }
  finally { await db.exec('rollback to savepoint forbidden; release savepoint forbidden'); }
}
before(async () => {
  db = await createTestDatabase();
  await db.exec(`delete from public.works;
    insert into auth.users(id,created_at,is_anonymous) values
    ('${admin}',now()-interval '120 days',false), ('${first}',now()-interval '2 days',false),
    ('${second}',now()-interval '45 days',false), ('${anonymous}',now(),true);
    update public.profiles set role='admin' where id='${admin}';
    -- An older account without a profile must still be counted by auth creation time.
    delete from public.profiles where id='${second}';
    insert into public.works(id,title,status,availability) values
    ('${workIds[0]}','Первая','published','available'), ('${workIds[1]}','Вторая','published','order'),
    ('${workIds[2]}','Черновик','draft','order'), ('${workIds[3]}','Архив','archived','order'),
    ('${workIds[4]}','Проданная','draft','sold');
    insert into public.photos(work_id,url,position) values
    ('${workIds[0]}','images/later.webp',5), ('${workIds[0]}','images/cover.webp',0);
    insert into public.favorites(user_id,work_id,created_at) values
    ('${first}','${workIds[0]}',now()-interval '2 days'), ('${second}','${workIds[0]}',now()-interval '40 days'),
    ('${first}','${workIds[2]}',now()-interval '1 day'), ('${second}','${workIds[4]}',now()-interval '80 days');
    select set_config('request.jwt.claim.sub','${admin}',false);`);
});
after(() => db.close());

test('administrator gets distinct totals, registration dates, period counts and ordered popular works', () => isolated(async () => {
  await db.exec('set local role authenticated');
  const data = await dashboard();
  assert.equal(data.total_users, 3, 'anonymous accounts are excluded; missing profiles are included');
  assert.equal(data.new_users, 1);
  assert.equal(data.total_favorites, 4);
  assert.equal(data.period_favorites, 2);
  assert.equal(data.favorited_works, 3);
  assert.equal(data.users_with_favorites, 2);
  assert.equal(data.total_works, 5);
  assert.equal(data.published_works, 2);
  assert.equal(data.draft_works, 1);
  assert.equal(data.archived_works, 2, 'sold drafts are counted once in the archive');
  assert.equal(data.popular_works.length, 3);
  assert.equal(data.popular_works[0].id, workIds[0]);
  assert.equal(data.popular_works[0].favorites, 2);
  assert.equal(data.popular_works[0].photo_url, 'images/cover.webp');
  assert.equal(data.popular_works[1].photo_url, null);
  assert.equal(data.period_days, 30);
  assert.ok(Number.isFinite(Date.parse(data.generated_at)));
  const longer = await dashboard(90);
  assert.equal(longer.new_users, 2);
  assert.equal(longer.period_favorites, 4);
  assert.deepEqual(longer.popular_works, data.popular_works, 'ranking always uses all current favorites');
  assert.equal((await dashboard(7)).new_users, 1);
}));

test('anon, customers and missing identities cannot call either entry point', () => isolated(async () => {
  await db.exec('set local role anon');
  await rejected(() => dashboard(), '42501');
  await rejected(() => db.query('select private.admin_dashboard(30)'), '42501');
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${first}',true);`);
  await rejected(() => dashboard(), '42501');
  await rejected(() => db.query('select private.admin_dashboard(30)'), '42501');
  await db.exec("select set_config('request.jwt.claim.sub','',true)");
  await rejected(() => dashboard(), '42501');
}));

test('statistics do not broaden access to favorites or user records', () => isolated(async () => {
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${first}',true);`);
  assert.deepEqual((await db.query('select distinct user_id from public.favorites')).rows, [{ user_id: first }]);
  assert.equal((await db.query('select count(*)::int as count from public.favorites')).rows[0].count, 2);
  await rejected(() => db.query('select * from auth.users'), '42501');
  await db.exec(`reset role; update public.profiles set role='customer' where id='${admin}';
    set local role authenticated; select set_config('request.jwt.claim.sub','${admin}',true);`);
  await rejected(() => dashboard(), '42501');
}));

test('invalid and null periods fail; empty data returns zeros and an empty list', () => isolated(async () => {
  await db.exec('set local role authenticated');
  for (const period of [null, 0, -1, 365]) await rejected(() => dashboard(period), '22023');
  await db.exec(`reset role; delete from public.favorites; delete from public.works;
    set local role authenticated;`);
  const empty = await dashboard();
  assert.equal(empty.total_favorites, 0);
  assert.equal(empty.users_with_favorites, 0);
  assert.equal(empty.favorited_works, 0);
  assert.equal(empty.total_works, 0);
  assert.deepEqual(empty.popular_works, []);
}));

test('removing a favorite changes current totals and ranking without retaining an event count', () => isolated(async () => {
  await db.exec(`delete from public.favorites where user_id='${first}' and work_id='${workIds[0]}'; set local role authenticated;`);
  const data = await dashboard();
  assert.equal(data.total_favorites, 3);
  assert.equal(data.period_favorites, 1);
  assert.equal(data.favorited_works, 3);
  assert.ok(data.popular_works.every(work => work.favorites === 1));
}));
