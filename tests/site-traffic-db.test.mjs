import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const record = async (visitor = randomUUID(), session = randomUUID(), event = randomUUID()) =>
  (await db.query('select public.record_site_pageview($1,$2,$3) as accepted', [visitor, session, event])).rows[0].accepted;
const stats = async (days = 30) => (await db.query('select public.admin_site_traffic($1) as data', [days])).rows[0].data;
async function isolated(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}
async function rejected(fn, code) {
  await db.exec('savepoint forbidden');
  try { await assert.rejects(fn, error => error.code === code); }
  finally { await db.exec('rollback to savepoint forbidden; release savepoint forbidden'); }
}
async function asAdmin() {
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${admin}',true)`);
}
before(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into auth.users(id,is_anonymous) values ('${admin}',false),('${customer}',false);
    update public.profiles set role='admin' where id='${admin}';`);
});
after(() => db.close());

test('guests and customers can record, duplicates are ignored, admin visits are excluded', () => isolated(async () => {
  const visitor = randomUUID(), session = randomUUID(), event = randomUUID();
  await db.exec('set local role anon');
  assert.equal(await record(visitor, session, event), true);
  assert.equal(await record(visitor, session, event), false);
  assert.equal(await record(visitor), true, 'rotating client session hint is still the same visit');
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${customer}',true)`);
  assert.equal(await record(), true);
  await asAdmin();
  assert.equal(await record(), false);
  // now() is transaction start; advance fixture timestamps to the transaction's clock for aggregation.
  await db.exec('reset role; update private.site_pageviews set occurred_at=now()');
  await asAdmin();
  const data = await stats();
  assert.equal(data.visitors, 2);
  assert.equal(data.visits, 2);
  assert.equal(data.pageviews, 3);
}));

test('raw records are inaccessible and reading statistics requires a current admin profile', () => isolated(async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set local role ${role}`);
    await rejected(() => stats(), '42501');
    await rejected(() => db.query('select private.admin_site_traffic(30)'), '42501');
    for (const table of ['site_pageviews','site_traffic_visitors','site_traffic_settings']) {
      await rejected(() => db.query(`select * from private.${table}`), '42501');
      await rejected(() => db.query(`delete from private.${table}`), '42501');
    }
  }
  await db.exec(`select set_config('request.jwt.claim.sub','${customer}',true)`);
  await rejected(() => stats(), '42501');
  await asAdmin();
  assert.equal((await stats()).pageviews, 0);
  await db.exec(`reset role; update public.profiles set role='customer' where id='${admin}'`);
  await asAdmin();
  await rejected(() => stats(), '42501');
}));

test('server inactivity starts a new visit and rate limits apply per browser', () => isolated(async () => {
  const visitor = randomUUID();
  await db.exec('set local role anon');
  assert.equal(await record(visitor), true);
  await db.exec('reset role');
  await db.query("update private.site_traffic_visitors set last_seen_at=clock_timestamp()-interval '31 minutes' where visitor_id=$1", [visitor]);
  await db.exec('set local role anon');
  assert.equal(await record(visitor), true);
  await db.exec('reset role');
  assert.equal((await db.query('select count(distinct session_id)::int as sessions from private.site_pageviews')).rows[0].sessions, 2);
  await db.query("update private.site_traffic_visitors set minute_at=date_trunc('minute',clock_timestamp()), minute_views=60 where visitor_id=$1", [visitor]);
  await db.exec('set local role anon');
  assert.equal(await record(visitor), false);
  assert.equal(await record(), true, 'another visitor is unaffected');
  await rejected(() => record(null), '22023');
}));

test('calendar periods include zero days, Moscow boundaries, unique visitors and no future events', () => isolated(async () => {
  const visitor = randomUUID(), session = randomUUID();
  const firstDay = "((now() at time zone 'Europe/Moscow')::date - 6)::timestamp at time zone 'Europe/Moscow'";
  await db.query(`insert into private.site_pageviews values
    ($1,$2,$3,${firstDay},true),
    ($4,$2,$3,now()-interval '1 minute',false),
    ($5,$2,$3,(${firstDay})-interval '1 millisecond',true),
    ($6,$2,$3,now()+interval '1 day',true)`, [randomUUID(),visitor,session,randomUUID(),randomUUID(),randomUUID()]);
  await asAdmin();
  const data = await stats(7);
  assert.equal(data.visitors, 1);
  assert.equal(data.visits, 1);
  assert.equal(data.pageviews, 2);
  assert.equal(data.days.length, 7);
  assert.equal(data.days[0].pageviews, 1);
  assert.ok(data.days.some(day => day.pageviews === 0));
  assert.equal(data.days.reduce((sum,day) => sum+day.pageviews,0), data.pageviews);
  assert.ok(Number.isFinite(Date.parse(data.started_at)));
  assert.equal((await stats(30)).pageviews, 3);
  assert.equal((await stats(90)).days.length, 90);
  for (const days of [null,0,-1,365]) await rejected(() => stats(days), '22023');
}));

test('empty statistics return zeros and the full daily series', () => isolated(async () => {
  await asAdmin();
  const data = await stats(7);
  assert.equal(data.visitors, 0);
  assert.equal(data.visits, 0);
  assert.equal(data.pageviews, 0);
  assert.equal(data.days.length, 7);
  assert.ok(data.days.every(day => day.visitors === 0 && day.visits === 0 && day.pageviews === 0));
}));

test('rotating visitor IDs cannot bypass global minute and daily budgets or allocate extra rows', () => isolated(async () => {
  const visitor=randomUUID(), session=randomUUID(), event=randomUUID();
  await db.exec('set local role anon');
  assert.equal(await record(visitor,session,event),true);
  await db.exec(`reset role; update private.site_traffic_settings set
    budget_minute_at=date_trunc('minute',clock_timestamp()), minute_views=299,
    budget_day=(clock_timestamp() at time zone 'Europe/Moscow')::date, day_views=9998`);
  await db.exec('set local role anon');
  assert.equal(await record(visitor,session,event),false,'duplicate does not consume remaining budget');
  assert.equal(await record(),true);
  for (let n=0;n<4;n++) assert.equal(await record(),false,'fresh UUID is still globally limited');
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from private.site_traffic_visitors')).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int as n from private.site_pageviews')).rows[0].n,2);
  assert.equal((await db.query('select day_views from private.site_traffic_settings')).rows[0].day_views,9999);
  await db.exec("update private.site_traffic_settings set budget_minute_at=clock_timestamp()-interval '2 minutes',minute_views=0");
  await db.exec('set local role anon');
  assert.equal(await record(),true,'next minute has budget, up to daily maximum');
  assert.equal(await record(),false,'daily maximum applies even with a fresh visitor');
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from private.site_pageviews')).rows[0].n,3);
  assert.equal((await db.query('select count(*)::int as n from private.site_traffic_visitors')).rows[0].n,3);
  assert.equal((await db.query('select day_views from private.site_traffic_settings')).rows[0].day_views,10000);
}));

test('intake prunes expired events and visitor state while preserving recent records', () => isolated(async () => {
  const oldVisitor=randomUUID(), recentVisitor=randomUUID();
  await db.query(`insert into private.site_traffic_visitors(visitor_id,last_seen_at) values
    ($1,clock_timestamp()-interval '101 days'),($2,clock_timestamp()-interval '99 days');
  `,[oldVisitor,recentVisitor]);
  await db.query(`insert into private.site_pageviews values
    ($1,$2,$3,clock_timestamp()-interval '101 days',true),
    ($4,$5,$6,clock_timestamp()-interval '99 days',true)`,
    [randomUUID(),oldVisitor,randomUUID(),randomUUID(),recentVisitor,randomUUID()]);
  await db.exec('set local role anon');
  assert.equal(await record(),true);
  await db.exec('reset role');
  const visitors=(await db.query('select visitor_id from private.site_traffic_visitors')).rows.map(row=>row.visitor_id);
  assert.ok(!visitors.includes(oldVisitor));
  assert.ok(visitors.includes(recentVisitor));
  assert.equal((await db.query('select count(*)::int as n from private.site_pageviews')).rows[0].n,2);
  assert.ok((await db.query('select last_cleanup_day from private.site_traffic_settings')).rows[0].last_cleanup_day);
}));
