import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const dimensions = { heightMm: 80, widthMm: 55, depthMm: null, unit: 'cm' };
const draft = () => ({ title: 'Размеры', description: '', category: 'Тест', material: 'Гипс', dimensions: '', measurements: dimensions,
  price: null, availability: 'order', status: 'draft', featured: false, photos: [], variants: [
    { id: crypto.randomUUID(), name: 'Фигурка', imageUrl: null, price: null, availability: 'order', measurements: { heightMm: 95, widthMm: null, depthMm: null, unit: 'mm' } },
  ] });
const save = async (payload, id = null, revision = null, requestId = crypto.randomUUID()) =>
  (await db.query('select public.save_work($1,$2,$3,$4) as result', [requestId, id, revision, JSON.stringify(payload)])).rows[0].result;
const suggestions = async () => (await db.query('select value_mm::float8 as value from public.dimension_suggestions order by value_mm')).rows.map(row => row.value);
before(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into auth.users values ('${admin}'), ('${customer}');
    update public.profiles set role='admin' where id='${admin}';
    select set_config('request.jwt.claim.sub', '${admin}', false); set role authenticated;`);
});
after(async () => { await db.close(); });

test('atomic save returns dimensions for works and variants and numerically deduplicates history', async () => {
  const input = draft(), requestId = crypto.randomUUID();
  const saved = await save(input, null, null, requestId);
  assert.deepEqual(saved.measurements, dimensions);
  assert.deepEqual(saved.variants[0].measurements, input.variants[0].measurements);
  assert.deepEqual(await suggestions(), [55, 80, 95]);
  assert.deepEqual(await save(input, null, null, requestId), saved);
  assert.deepEqual(await suggestions(), [55, 80, 95]);
  await db.query('delete from public.dimension_suggestions where value_mm=80');
  await save({ ...input, measurements: { ...dimensions, unit: 'mm' } }, saved.id, saved.revision);
  assert.deepEqual(await suggestions(), [55, 95], 'unit-only edits do not resurrect deleted suggestions');
  assert.equal((await db.query('select measurements->>\'heightMm\' as height from public.works where id=$1', [saved.id])).rows[0].height, '80');
});

test('malformed dimensions roll back the entire save, including suggestion history', async () => {
  const initial = await suggestions();
  for (const value of [0, -1, '8', 0.00001, 1000001]) {
    await assert.rejects(() => save({ ...draft(), measurements: { ...dimensions, heightMm: value } }), error => error.code === '23514');
    assert.deepEqual(await suggestions(), initial);
  }
  const input = draft();
  input.measurements = { ...dimensions, heightMm: 999 };
  input.variants[0].measurements.heightMm = -1;
  await assert.rejects(() => save(input), error => error.code === '23514');
  assert.deepEqual(await suggestions(), initial, 'variant failure rolls back newly remembered work dimensions');
});

test('old callers preserve structured dimensions and old text is still accepted', async () => {
  const input = draft(), saved = await save(input);
  delete input.measurements;
  delete input.variants[0].measurements;
  input.dimensions = '8*3 см';
  const updated = await save(input, saved.id, saved.revision);
  assert.deepEqual(updated.measurements, saved.measurements);
  assert.deepEqual(updated.variants[0].measurements, saved.variants[0].measurements);
  assert.equal(updated.dimensions, input.dimensions);
});

test('customers cannot see or alter size suggestions; admins can restore them', async () => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${customer}', false)`);
  assert.deepEqual(await suggestions(), []);
  await assert.rejects(() => db.exec('insert into public.dimension_suggestions(value_mm) values (450)'), error => error.code === '42501');
  await db.exec('delete from public.dimension_suggestions');
  await db.exec(`select set_config('request.jwt.claim.sub', '${admin}', false)`);
  assert.ok((await suggestions()).length > 0);
  await db.exec('insert into public.dimension_suggestions(value_mm) values (80) on conflict do nothing');
  assert.ok((await suggestions()).includes(80));
});

test('live verification script rolls back all fixtures and history changes', async () => {
  const initial = await suggestions();
  const count = (await db.query('select count(*) from public.works')).rows[0].count;
  await db.exec(await readFile(new URL('./measurements.verify.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await suggestions(), initial);
  assert.equal((await db.query('select count(*) from public.works')).rows[0].count, count);
});
