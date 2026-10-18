import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherAdmin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const visitor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const oldWorkId = '11111111-1111-4111-8111-111111111111';
const draft = () => ({
  title: 'Транзакционная работа', description: 'Описание', category: 'Тестовая категория', material: 'Гипс',
  dimensions: '', price: null, availability: 'order', status: 'published', featured: false,
  photos: [{ url: 'images/new.jpg', alt: 'Новое фото', storage_path: null }],
  variants: [{ id: crypto.randomUUID(), name: 'Фигурка', imageUrl: 'images/new.jpg', price: 200, availability: 'order' }],
});
const call = async (payload, { requestId = crypto.randomUUID(), id = null, revision = null } = {}) =>
  (await db.query('select public.save_work($1, $2, $3, $4) as result', [requestId, id, revision, JSON.stringify(payload)])).rows[0].result;
const snapshot = async () => (await db.query(`select jsonb_build_object(
  'works', (select jsonb_agg(to_jsonb(t) order by id) from public.works t),
  'photos', (select jsonb_agg(to_jsonb(t) order by id) from public.photos t),
  'variants', (select jsonb_agg(to_jsonb(t) order by id) from public.variants t),
  'categories', (select jsonb_agg(to_jsonb(t) order by id) from public.categories t),
  'receipts', (select jsonb_agg(to_jsonb(t) order by request_id) from public.work_save_requests t),
  'cleanup', (select jsonb_agg(to_jsonb(t) order by url) from public.work_photo_cleanup t)
) as data`)).rows[0].data;

async function rejectsSql(fn, code) {
  await db.exec('savepoint expected_failure');
  try {
    await assert.rejects(fn, (error) => error.code === code);
  } finally {
    await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');
  }
}
async function isolated(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}

before(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into auth.users values ('${admin}'), ('${otherAdmin}'), ('${visitor}');
    insert into public.profiles(id) values ('${admin}'), ('${otherAdmin}');
    select set_config('request.jwt.claim.sub', '${admin}', false);
    create function public.test_fail_insertion() returns trigger language plpgsql as $$
    begin
      if current_setting('test.fail_table', true) = tg_table_name then
        raise exception 'Injected insert failure' using errcode = '23514';
      end if;
      return new;
    end $$;
    create trigger test_photo_failure before insert on public.photos for each row execute function public.test_fail_insertion();
    create trigger test_variant_failure before insert on public.variants for each row execute function public.test_fail_insertion();`);
});
after(() => db.close());

for (const table of ['photos', 'variants']) {
  for (const creating of [true, false]) {
    test(`${table} failure rolls back ${creating ? 'creation' : 'update'}, and retry succeeds`, () => isolated(async () => {
      const input = draft();
      const args = { requestId: crypto.randomUUID(), id: creating ? null : oldWorkId, revision: creating ? null : 1 };
      const previous = await snapshot();
      await db.query("select set_config('test.fail_table', $1, true)", [table]);
      await rejectsSql(() => call(input, args), '23514');
      assert.deepEqual(await snapshot(), previous, 'including revision, publication, old photos, category, queue and receipt');
      await db.exec("select set_config('test.fail_table', '', true)");
      const result = await call(input, args);
      assert.equal(result.revision, creating ? 1 : 2);
      assert.equal(result.photos.length, 1);
      assert.equal(result.variants.length, 1);
      assert.equal(result.status, 'published');
    }));
  }
}

test('Replayed create and update return the original response with no further changes', () => isolated(async () => {
  const input = draft(), requestId = crypto.randomUUID();
  const created = await call(input, { requestId });
  const once = await snapshot();
  assert.deepEqual(await call(input, { requestId }), created);
  assert.deepEqual(await snapshot(), once);
  const updateId = crypto.randomUUID();
  const updated = await call(input, { requestId: updateId, id: created.id, revision: 1 });
  const twice = await snapshot();
  assert.deepEqual(await call(input, { requestId: updateId, id: created.id, revision: 1 }), updated);
  assert.deepEqual(await snapshot(), twice);
}));

test('Stale revisions and reused request IDs with different payloads leave the catalogue intact', () => isolated(async () => {
  const input = draft(), requestId = crypto.randomUUID();
  const created = await call(input, { requestId });
  await call(input, { id: created.id, revision: 1 });
  const previous = await snapshot();
  await rejectsSql(() => call(input, { id: created.id, revision: 1 }), '40001');
  await rejectsSql(() => call({ ...input, title: 'Different' }, { requestId }), '22023');
  assert.deepEqual(await snapshot(), previous);
}));

test('A retry after subsequent deletion never recreates the work', () => isolated(async () => {
  const input = draft(), requestId = crypto.randomUUID();
  const created = await call(input, { requestId });
  await db.query('delete from public.works where id = $1', [created.id]);
  assert.deepEqual(await call(input, { requestId }), created);
  assert.equal((await db.query('select id from public.works where id = $1', [created.id])).rows.length, 0);
}));

test('Variant IDs, non-editor fields and variant-level photos survive an update', () => isolated(async () => {
  const input = draft(), created = await call(input), variantId = input.variants[0].id;
  await db.query("update public.variants set finish = 'Позолота', weight = '10 г' where id = $1", [variantId]);
  await db.query("insert into public.photos(variant_id, url) values ($1, 'images/variant.jpg')", [variantId]);
  const updated = await call({ ...input, title: 'Изменено' }, { id: created.id, revision: 1 });
  assert.deepEqual(updated.variants.map((variant) => variant.id), [variantId]);
  assert.equal((await db.query('select finish from public.variants where id = $1', [variantId])).rows[0].finish, 'Позолота');
  assert.equal((await db.query('select id from public.photos where variant_id = $1', [variantId])).rows.length, 1);
}));

test('Variant identifiers cannot be duplicated or transferred from another work', () => isolated(async () => {
  const input = draft();
  await call(input);
  const previous = await snapshot();
  await rejectsSql(() => call(input), '22023');
  await rejectsSql(() => call({ ...draft(), variants: [input.variants[0], input.variants[0]] }), '22023');
  assert.deepEqual(await snapshot(), previous);
}));

test('Photo cleanup is queued atomically, including removed variant and legacy tree images', () => isolated(async () => {
  const input = draft();
  input.treeImage = 'images/tree.jpg';
  const created = await call(input);
  await db.query("insert into public.photos(variant_id, url) values ($1, 'images/variant-only.jpg')", [input.variants[0].id]);
  await call({ ...input, photos: [{ url: 'images/next.jpg', alt: '' }], variants: [], treeImage: null }, { id: created.id, revision: 1 });
  const urls = (await db.query('select url from public.work_photo_cleanup order by url')).rows.map((row) => row.url);
  assert.deepEqual(urls, ['images/new.jpg', 'images/tree.jpg', 'images/variant-only.jpg']);
}));

test('Published cards require photos and blob URLs are rejected on the server', () => isolated(async () => {
  const previous = await snapshot();
  await rejectsSql(() => call({ ...draft(), photos: [] }), '22023');
  await rejectsSql(() => call({ ...draft(), photos: [{ url: 'blob:unsaved', alt: '' }] }), '22023');
  const input = draft(); input.variants[0].imageUrl = 'blob:unsaved';
  await rejectsSql(() => call(input), '22023');
  assert.deepEqual(await snapshot(), previous);
}));

test('Anonymous users and non-admins cannot save or read receipts', () => isolated(async () => {
  const input = draft();
  await call(input);
  await db.exec(`set local role anon; select set_config('request.jwt.claim.sub', '', true)`);
  await rejectsSql(() => call(draft()), '42501');
  await rejectsSql(() => db.query('select * from public.work_save_requests'), '42501');
  await db.exec(`reset role; set local role authenticated; select set_config('request.jwt.claim.sub', '${visitor}', true)`);
  await rejectsSql(() => call(draft()), '42501');
  assert.equal((await db.query('select * from public.work_save_requests')).rows.length, 0);
}));

test('Admin RPC honors RLS; another admin cannot read or replay a receipt', () => isolated(async () => {
  await db.exec('set local role authenticated');
  const input = draft(), requestId = crypto.randomUUID();
  const created = await call(input, { requestId });
  assert.equal(created.revision, 1);
  assert.equal((await db.query('select * from public.work_save_requests')).rows.length, 1);
  await db.exec(`select set_config('request.jwt.claim.sub', '${otherAdmin}', true)`);
  assert.equal((await db.query('select * from public.work_save_requests')).rows.length, 0);
  // Hidden receipt collides with its primary key; its contents stay private.
  await rejectsSql(() => call(draft(), { requestId }), '23505');
}));

test('The live verification script rolls back all its fixtures', async () => {
  const previous = await snapshot();
  await db.exec(await readFile(new URL('./atomic-save-work.verify.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await snapshot(), previous);
});
