import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
before(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into auth.users(id) values ('${admin}'), ('${customer}');
    update public.profiles set role='admin' where id='${admin}';`);
});
after(() => db.close());

test('the default mode is public; only the administrator can switch it, and invalid modes are rejected', async () => {
  await db.exec('begin');
  try {
    await db.exec('set local role anon');
    assert.equal((await db.query('select hero_mode from public.site_settings')).rows[0].hero_mode, 'standard');
    assert.equal((await db.query("update public.site_settings set hero_mode='new-year' returning id")).rows.length, 0);
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${customer}',true);`);
    assert.equal((await db.query("update public.site_settings set hero_mode='new-year' returning id")).rows.length, 0);
    await db.exec(`select set_config('request.jwt.claim.sub','${admin}',true);`);
    assert.equal((await db.query("update public.site_settings set hero_mode='new-year' returning hero_mode")).rows[0].hero_mode, 'new-year');
    await db.exec('savepoint invalid');
    await assert.rejects(() => db.query("update public.site_settings set hero_mode='invalid'"), (error) => error.code === '23514');
    await db.exec('rollback to savepoint invalid; set local role anon');
    assert.equal((await db.query('select hero_mode from public.site_settings')).rows[0].hero_mode, 'new-year');
  } finally { await db.exec('rollback'); }
});
