import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';
let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const event = fields => ({ id: randomUUID(), occurred_at: new Date().toISOString(), kind: 'network', service: 'rest', resource: 'catalog_cards', method: 'GET', status: 0, duration_ms: 20000, online: true, browser: 'Chrome', platform: 'Windows', build: 'test', ...fields });
const record = async e => (await db.query('select public.record_site_diagnostic($1::jsonb) as accepted', [JSON.stringify(e)])).rows[0].accepted;
const reports = async (days = 7) => (await db.query('select public.admin_site_diagnostics($1) as data', [days])).rows[0].data;
async function isolated(fn) { await db.exec('begin'); try { await fn(); } finally { await db.exec('rollback'); } }
async function rejected(fn, code = '42501') {
  await db.exec('savepoint forbidden');
  try { await assert.rejects(fn, e => e.code === code); }
  finally { await db.exec('rollback to savepoint forbidden; release savepoint forbidden'); }
}
before(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into auth.users(id) values ('${admin}'),('${customer}'); update public.profiles set role='admin' where id='${admin}';`);
});
after(() => db.close());
test('guests can report without reading; duplicates accepted once; only current admins can list', () => isolated(async () => {
  const e = event();
  await db.exec('set local role anon');
  assert.equal(await record(e), true); assert.equal(await record(e), true);
  await rejected(() => reports());
  await rejected(() => db.query('select * from private.site_diagnostics'));
  await rejected(() => db.query('delete from private.site_diagnostics'));
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${customer}',true)`);
  await rejected(() => reports());
  await rejected(() => db.query('select private.admin_site_diagnostics(7)'));
  await rejected(() => db.query('select * from private.site_diagnostic_budget'));
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',true)`);
  assert.equal((await reports()).length, 1);
  assert.equal((await reports())[0].id, e.id);
  await rejected(() => reports(90), '22023');
  await db.exec(`reset role; update public.profiles set role='customer' where id='${admin}'; set local role authenticated;`);
  await rejected(() => reports());
}));
test('server rejects extra fields, nulls, URLs, oversized payloads and invalid ranges', () => isolated(async () => {
  await db.exec('set local role anon');
  for (const invalid of [event({ token: 'secret' }), event({ browser: null }), event({ online: 'true' }), event({ id: [randomUUID()] }), event({ build: 'https://secret' }), event({ resource: 'private-user-id' }), event({ duration_ms: 3600001 }), event({ status: 999 }), event({ occurred_at: '2020-01-01T00:00:00Z' }), event({ build: 'x'.repeat(2000) })]) await rejected(() => record(invalid), '22023');
}));
test('global budgets survive rotating report IDs; expired rows are cleaned; reader is bounded', () => isolated(async () => {
  await db.exec(`update private.site_diagnostic_budget set minute_at=date_trunc('minute',clock_timestamp()),minute_events=120`);
  await db.exec('set local role anon'); assert.equal(await record(event()), false);
  await db.exec(`reset role; update private.site_diagnostic_budget set minute_at=null,day_at=(clock_timestamp() at time zone 'UTC')::date,day_events=1000; set local role anon`);
  assert.equal(await record(event()), false);
  await db.exec(`reset role; update private.site_diagnostic_budget set minute_at=null,day_at=null,day_events=0`);
  const old = event();
  await db.query("insert into private.site_diagnostics(id,event,received_at) values ($1,$2,clock_timestamp()-interval '31 days')", [old.id, JSON.stringify(old)]);
  await db.exec('set local role anon'); assert.equal(await record(event()), true);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from private.site_diagnostics where id=$1', [old.id])).rows[0].n, 0);
  for (let i = 0; i < 105; i++) await record(event());
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${admin}',true)`);
  assert.equal((await reports()).length, 100);
}));
