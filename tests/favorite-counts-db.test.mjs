import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ids = [1, 2, 3, 4, 5].map(n => `00000000-0000-4000-8000-00000000000${n}`);
const counts = async () => (await db.query('select public.favorite_counts() as data')).rows[0].data;

before(async () => {
  db = await createTestDatabase();
  await db.exec(`delete from public.works;
    insert into auth.users(id) values ('${first}'), ('${second}');
    insert into public.works(id,title,status,availability) values
    ('${ids[0]}','Visible','published','available'),
    ('${ids[1]}','Zero','published','order'),
    ('${ids[2]}','Draft','draft','available'),
    ('${ids[3]}','Sold','published','sold'),
    ('${ids[4]}','Archived','archived','available');
    insert into public.favorites(user_id,work_id) values
    ('${first}','${ids[0]}'), ('${second}','${ids[0]}'),
    ('${first}','${ids[2]}'), ('${first}','${ids[3]}'), ('${first}','${ids[4]}');`);
});
after(() => db.close());

async function isolated(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}

test('guests see combined totals without zero, draft, sold or archived works', () => isolated(async () => {
  await db.exec('set local role anon');
  assert.deepEqual(await counts(), { [ids[0]]: 2 });
  assert.deepEqual((await db.query('select * from public.favorites')).rows, []);
}));

test('customers see the same totals while individual favorites remain private', () => isolated(async () => {
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${first}',true)`);
  assert.deepEqual(await counts(), { [ids[0]]: 2 });
  assert.deepEqual((await db.query('select distinct user_id from public.favorites')).rows, [{ user_id: first }]);
}));

test('removing the last like removes its count; adding it back restores one', () => isolated(async () => {
  await db.exec(`delete from public.favorites where user_id='${second}';
    set local role authenticated; select set_config('request.jwt.claim.sub','${first}',true)`);
  assert.deepEqual(await counts(), { [ids[0]]: 1 });
  await db.exec(`delete from public.favorites where work_id='${ids[0]}'`);
  assert.deepEqual(await counts(), {});
  await db.exec(`insert into public.favorites(user_id,work_id) values ('${first}','${ids[0]}')`);
  assert.deepEqual(await counts(), { [ids[0]]: 1 });
}));
