import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';
let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const photo = name => ({ url: `https://test.supabase.co/storage/v1/object/public/work-photos/works/${name}.webp`, alt: name });
const draft = () => ({ title: 'Коллекция с галереями', description: '', category: 'Тест', material: 'Гипс', dimensions: '', measurements: null,
 soldAsSet: false, price: 9999, availability: 'available', status: 'published', featured: false, photos: [photo('common')],
 variants: [
  { id: crypto.randomUUID(), name: 'Первая', description: 'Своё описание', price: 400, availability: 'available', measurements: { heightMm: 40, widthMm: null, depthMm: null, unit: 'mm' }, photos: [photo('first'), photo('second')] },
  { id: crypto.randomUUID(), name: 'Вторая', price: null, availability: 'order', measurements: null, photos: [photo('common')] },
 ] });
const save = async (payload, id = null, revision = null, request = crypto.randomUUID()) =>
 (await db.query('select public.save_work($1,$2,$3,$4) as result', [request, id, revision, JSON.stringify(payload)])).rows[0].result;
const snapshot = async () => (await db.query(`select jsonb_build_object(
 'works',(select jsonb_agg(to_jsonb(t) order by id) from public.works t),
 'variants',(select jsonb_agg(to_jsonb(t) order by id) from public.variants t),
 'photos',(select jsonb_agg(to_jsonb(t) order by id) from public.photos t),
 'cleanup',(select jsonb_agg(to_jsonb(t) order by url) from public.work_photo_cleanup t),
 'receipts',(select jsonb_agg(to_jsonb(t) order by request_id) from public.work_save_requests t)) as data`)).rows[0].data;
async function isolated(fn) { await db.exec('begin'); try { await fn(); } finally { await db.exec('rollback'); } }
async function rejectsSql(fn, code) {
 await db.exec('savepoint invalid_gallery');
 try { await assert.rejects(fn, error => error.code === code); }
 finally { await db.exec('rollback to savepoint invalid_gallery; release savepoint invalid_gallery'); }
}
before(async () => {
 db = await createTestDatabase();
 await db.exec(`insert into auth.users values ('${admin}'); update public.profiles set role='admin' where id='${admin}';
 select set_config('request.jwt.claim.sub','${admin}',false);`);
});
after(() => db.close());

test('each gallery has independent ordering, cover, description, nullable price and measurements', () => isolated(async () => {
 const input = draft(), request = crypto.randomUUID();
 const created = await save(input, null, null, request);
 assert.equal(created.sold_as_set, false);
 assert.equal(created.photos.length, 1);
 assert.deepEqual(created.variants[0].photos.map(p => p.url), input.variants[0].photos.map(p => p.url));
 assert.equal(created.variants[0].image_url, input.variants[0].photos[0].url);
 assert.equal(created.variants[0].description, 'Своё описание');
 assert.equal(created.variants[1].price, null);
 assert.equal(created.variants[1].measurements, null);
 assert.deepEqual(await save(input, null, null, request), created, 'lost-response replay does not duplicate galleries');
 const previous = await snapshot();
 const changed = structuredClone(input);
 changed.variants[0].photos.reverse();
 const updated = await save(changed, created.id, 1);
 assert.equal(updated.variants[0].image_url, input.variants[0].photos[1].url);
 assert.deepEqual(updated.photos.map(p => p.url), created.photos.map(p => p.url));
 assert.equal(updated.variants[1].photos[0].url, created.variants[1].photos[0].url);
 assert.notDeepEqual(await snapshot(), previous);
}));

test('twenty photos are allowed per gallery, not twenty for the entire collection', () => isolated(async () => {
 const input = draft();
 input.photos = Array.from({ length: 20 }, (_, i) => photo('common-' + i));
 input.variants[0].photos = Array.from({ length: 20 }, (_, i) => photo('individual-' + i));
 const saved = await save(input);
 assert.equal(saved.photos.length, 20);
 assert.equal(saved.variants[0].photos.length, 20);
}));

test('invalid, empty published and oversized galleries roll back all work changes', () => isolated(async () => {
 const input = draft(), created = await save(input), previous = await snapshot();
 for (const gallery of [[], Array.from({ length: 21 }, (_, i) => photo('extra-' + i)), [{ url: 'blob:temporary', alt: '' }]]) {
  for (const target of ['main', 'variant']) {
   const changed = structuredClone(input);
   if (target === 'main') changed.photos = gallery; else changed.variants[0].photos = gallery;
   await rejectsSql(() => save(changed, created.id, 1), '22023');
   assert.deepEqual(await snapshot(), previous);
  }
 }
}));

test('removing a shared main photo keeps the individual gallery and protects its bytes', () => isolated(async () => {
 const input = draft(), created = await save(input);
 input.photos = [photo('replacement')];
 const updated = await save(input, created.id, 1);
 assert.equal(updated.variants[1].photos[0].url, photo('common').url);
 assert.equal((await db.query("select private.photo_is_used('works/common.webp') as used")).rows[0].used, true);
 input.variants = input.variants.slice(0, 1);
 await save(input, created.id, 2);
 assert.equal((await db.query("select private.photo_is_used('works/common.webp') as used")).rows[0].used, false);
 const candidate = (await db.query('select * from public.work_photo_cleanup where url=$1', [photo('common').url])).rows[0];
 assert.ok(candidate);
 assert.ok(Date.parse(candidate.available_at) > Date.now(), 'removed file remains recoverable during cleanup grace period');
}));

test('replacing or clearing a draft gallery queues old images and clears its cover', () => isolated(async () => {
 const input = draft(), created = await save(input);
 input.status = 'draft'; input.variants[0].photos = [];
 const updated = await save(input, created.id, 1);
 assert.deepEqual(updated.variants[0].photos, []);
 assert.equal(updated.variants[0].image_url, null);
 assert.ok((await db.query('select 1 from public.work_photo_cleanup where url=$1', [photo('first').url])).rows.length);
}));

test('old clients omitting galleries, descriptions and sale mode preserve new data', () => isolated(async () => {
 const input = draft(); input.soldAsSet = true;
 const created = await save(input);
 delete input.soldAsSet;
 for (const variant of input.variants) { variant.imageUrl = variant.photos[0].url; delete variant.photos; delete variant.description; }
 const updated = await save(input, created.id, 1);
 assert.equal(updated.sold_as_set, true);
 assert.equal(updated.variants[0].description, created.variants[0].description);
 assert.deepEqual(updated.variants[0].photos, created.variants[0].photos);
}));

test('live gallery verification rolls back every fixture', async () => {
 const previous = await snapshot();
 await db.exec(await readFile(new URL('./variant-galleries.verify.sql', import.meta.url), 'utf8'));
 assert.deepEqual(await snapshot(), previous);
});
