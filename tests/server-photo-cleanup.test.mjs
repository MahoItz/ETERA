import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherAdmin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const visitor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const work = '11111111-1111-4111-8111-111111111111';
const otherWork = '22222222-2222-4222-8222-222222222222';
const path = 'works/shared.webp';
const url = `https://test.supabase.co/storage/v1/object/public/work-photos/${path}`;
const secret = 'test-worker-secret';
const queue = async () => (await db.query('select * from public.work_photo_cleanup where storage_path = $1', [path])).rows[0];
const claim = async (token = secret) => (await db.query('select * from public.claim_work_photo_cleanup($1)', [token])).rows;
const ready = () => db.exec("update public.work_photo_cleanup set available_at = now() - interval '1 day', protected_until = null, claim_until = null");
const photo = (workId = work, imageUrl = url, storagePath = null) => db.query('insert into public.photos(work_id,url,storage_path) values ($1,$2,$3) returning id', [workId, imageUrl, storagePath]);
const detach = () => db.query('delete from public.photos where work_id = $1 and url = $2', [work, url]);
const confirm = async (entry) => (await db.query('select public.confirm_work_photo_cleanup($1,$2,$3) as valid', [secret, entry.object_path, entry.claim_token])).rows[0].valid;
const finish = (entry, error = null) => db.query('select public.finish_work_photo_cleanup($1,$2,$3,$4)', [secret, entry.object_path, entry.claim_token, error]);
async function isolated(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}
async function rejectsSql(fn, code) {
  await db.exec('savepoint expected_failure');
  try { await assert.rejects(fn, (error) => error.code === code); }
  finally { await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure'); }
}

before(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into auth.users values ('${admin}'), ('${otherAdmin}'), ('${visitor}');
    insert into public.profiles(id) values ('${admin}'), ('${otherAdmin}') on conflict (id) do update set role = 'admin';
    select set_config('request.jwt.claim.sub', '${admin}', false);`);
  await db.query('update private.photo_cleanup_config set enabled = true, worker_secret = $1', [secret]);
});
after(() => db.close());

const references = {
  'another gallery': () => photo(otherWork),
  'a storage_path alias': () => photo(otherWork, 'images/legacy.jpg', path),
  'a variant': () => db.query("insert into public.variants(work_id,name,image_url) values ($1,'Variant',$2)", [otherWork, url]),
  'an ornament': () => db.query("insert into public.tree_ornaments(work_id,title,image_url) values ($1,'Ornament',$2)", [otherWork, url]),
  'a legacy tree image': () => db.query('update public.works set tree_image = $1 where id = $2', [url, otherWork]),
  'an encoded URL with query parameters': () => db.query("insert into public.variants(work_id,name,image_url) values ($1,'Variant',$2)", [otherWork, url.replace('shared', 'sh%61red') + '?download=1#image']),
};
for (const [name, addReference] of Object.entries(references)) {
  test(`Server preserves an image referenced by ${name} after gallery removal`, () => isolated(async () => {
    await photo(); await addReference(); await detach(); await ready();
    assert.deepEqual(await claim(), []);
    assert.equal((await queue()).state, 'in_use');
  }));
}

test('All references include drafts, archived and sold works regardless of visitor RLS', () => isolated(async () => {
  await photo();
  await photo(otherWork);
  await db.query("update public.works set status='archived', availability='sold' where id=$1", [otherWork]);
  await detach(); await ready();
  await db.exec('set local role service_role');
  assert.deepEqual(await claim(), []);
}));

test('Deleting a whole work queues gallery, variant photos, ornament and legacy tree image atomically', () => isolated(async () => {
  await photo();
  const paths = ['variant.webp', 'variant-photo.webp', 'ornament.webp', 'tree.webp'];
  const base = 'https://test.supabase.co/storage/v1/object/public/work-photos/works/';
  const variant = (await db.query("insert into public.variants(work_id,name,image_url) values ($1,'Variant',$2) returning id", [work, base + paths[0]])).rows[0];
  await db.query('insert into public.photos(variant_id,url) values ($1,$2)', [variant.id, base + paths[1]]);
  await db.query("insert into public.tree_ornaments(work_id,title,image_url) values ($1,'Ornament',$2)", [work, base + paths[2]]);
  await db.query('update public.works set tree_image=$1 where id=$2', [base + paths[3], work]);
  await db.exec('savepoint before_delete');
  await db.query('delete from public.works where id=$1', [work]);
  const queued = (await db.query("select storage_path,state,available_at > now() as delayed from public.work_photo_cleanup order by storage_path")).rows;
  assert.equal(queued.length, 5);
  assert.ok(queued.every((entry) => entry.state === 'queued' && entry.delayed));
  await db.exec('rollback to savepoint before_delete');
  assert.ok((await db.query('select state from public.work_photo_cleanup')).rows.every((entry) => entry.state === 'in_use'));
}));

test('Claiming a file blocks new references before Storage deletion and after completion', () => isolated(async () => {
  await photo(); await detach(); await ready();
  const [entry] = await claim();
  assert.equal(entry.object_path, path);
  assert.equal(await confirm(entry), true);
  await rejectsSql(() => photo(otherWork), '55000');
  await rejectsSql(() => db.query('update public.works set tree_image=$1 where id=$2', [url, otherWork]), '55000');
  assert.equal((await queue()).state, 'deleting');
  await finish(entry);
  assert.equal((await queue()).state, 'deleted');
  await rejectsSql(() => photo(otherWork), '55000');
}));

test('Failure and worker timeout retain the tombstone, error and retry schedule', () => isolated(async () => {
  await photo(); await detach(); await ready();
  const [first] = await claim();
  await finish(first, 'Storage unavailable');
  const failed = await queue();
  assert.equal(failed.state, 'deleting');
  assert.equal(failed.last_error, 'Storage unavailable');
  assert.equal(failed.attempts, 1);
  assert.ok(Date.parse(failed.available_at) > Date.now());
  assert.deepEqual(await claim(), []);
  await ready();
  const [second] = await claim();
  assert.notEqual(second.claim_token, first.claim_token);
  assert.equal(await confirm(first), false);
  await rejectsSql(() => finish(first), '55000');
  await db.exec("update public.work_photo_cleanup set claim_until=now()-interval '1 minute'");
  assert.equal(await confirm(second), false);
  const [third] = await claim();
  assert.notEqual(third.claim_token, second.claim_token);
  await finish(third);
  assert.equal((await queue()).state, 'deleted');
}));

test('The last removed reference starts a fresh 24-hour grace period', () => isolated(async () => {
  await photo(); await photo(otherWork);
  await detach(); await ready();
  assert.deepEqual(await claim(), []);
  await db.query('delete from public.photos where work_id=$1 and url=$2', [otherWork, url]);
  const entry = await queue();
  assert.equal(entry.state, 'queued');
  assert.ok(Date.parse(entry.available_at) - Date.now() > 23 * 3600000);
  assert.deepEqual(await claim(), []);
}));

test('Temporary uploads are protected, renewable and eventually collected without a catalogue row', () => isolated(async () => {
  const id = crypto.randomUUID();
  const registration = (await db.query('select public.begin_work_photo_upload($1) as data', [id])).rows[0].data;
  await db.exec("update public.work_photo_cleanup set available_at=now()-interval '1 day'");
  assert.deepEqual(await claim(), []);
  const renewed = (await db.query('select public.renew_work_photo_upload($1) as renewed', [registration.url])).rows[0].renewed;
  assert.equal(renewed, true);
  await ready();
  const [entry] = await claim();
  assert.equal(entry.object_path, registration.path);
  assert.equal(await confirm(entry), true);
  assert.equal((await db.query('select public.renew_work_photo_upload($1) as renewed', [registration.url])).rows[0].renewed, false);
  await rejectsSql(() => db.query('select public.begin_work_photo_upload($1)', [id]), '55000');
}));

test('Another admin cannot renew or take over a temporary upload', () => isolated(async () => {
  const id = crypto.randomUUID();
  const registration = (await db.query('select public.begin_work_photo_upload($1) as data', [id])).rows[0].data;
  await db.exec(`select set_config('request.jwt.claim.sub', '${otherAdmin}', true)`);
  assert.equal((await db.query('select public.renew_work_photo_upload($1) as renewed', [registration.url])).rows[0].renewed, false);
  await rejectsSql(() => db.query('select public.begin_work_photo_upload($1)', [id]), '55000');
}));

test('Failed saves retain the independently registered temporary upload', () => isolated(async () => {
  const registration = (await db.query('select public.begin_work_photo_upload($1) as data', [crypto.randomUUID()])).rows[0].data;
  await rejectsSql(() => db.query('select public.save_work($1,null,null,$2)', [crypto.randomUUID(), JSON.stringify({
    title: 'Failed', description: '', category: 'Test', material: '', dimensions: '', price: null, availability: 'order', status: 'published', featured: false,
    photos: [{ url: registration.url, alt: '' }], variants: [{ id: crypto.randomUUID(), name: 'Invalid', price: -1, availability: 'order' }],
  })]), '23514');
  const entry = (await db.query('select * from public.work_photo_cleanup where url=$1', [registration.url])).rows[0];
  assert.equal(entry.state, 'queued');
  assert.equal(entry.upload_actor, admin);
  assert.ok(Date.parse(entry.protected_until) > Date.now());
}));

test('Discovery quarantines old unregistered uploads and ignores unmanaged paths', () => isolated(async () => {
  await db.query("insert into storage.objects(bucket_id,name) values ('work-photos',$1), ('work-photos','other/unmanaged.webp')", [path]);
  assert.deepEqual(await claim(), []);
  const entry = await queue();
  assert.equal(entry.state, 'queued');
  assert.ok(Date.parse(entry.protected_until) - Date.now() > 6 * 86400000);
  assert.equal((await db.query('select count(*)::int as count from public.work_photo_cleanup')).rows[0].count, 1);
}));

test('Foreign and malformed URLs never register a file for deletion', () => isolated(async () => {
  await photo(work, url.replace('test.supabase.co', 'external.example'));
  await photo(otherWork, url.replace('shared', '%E0%A4%A'));
  await db.query('delete from public.photos where work_id in ($1,$2)', [work, otherWork]);
  await ready();
  assert.deepEqual(await claim(), []);
  assert.equal(await queue(), undefined);
}));

test('Admin browsers cannot delete files or forge cleanup claims; public reads continue', () => isolated(async () => {
  await db.query("insert into storage.objects(bucket_id,name) values ('work-photos',$1)", [path]);
  await db.exec('set local role authenticated');
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [path])).rows.length, 0);
  await rejectsSql(() => claim(), '42501');
  await rejectsSql(() => db.query("insert into public.work_photo_cleanup(url,state) values ($1,'deleted')", [url]), '42501');
  await rejectsSql(() => db.query('delete from public.work_photo_cleanup'), '42501');
  await rejectsSql(() => db.query('select * from private.photo_cleanup_config'), '42501');
  await db.exec('set local role anon');
  assert.equal((await db.query('select name from storage.objects where name=$1', [path])).rows.length, 1);
}));

test('Worker secrets and administrator checks are enforced on all entry points', () => isolated(async () => {
  await rejectsSql(() => claim('wrong'), '42501');
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${visitor}', true)`);
  await rejectsSql(() => db.query('select public.begin_work_photo_upload($1)', [crypto.randomUUID()]), '42501');
  await rejectsSql(() => db.query('select public.renew_work_photo_upload($1)', [url]), '42501');
  await rejectsSql(() => claim(), '42501');
}));

test('Storage permits immutable uploads, but cannot overwrite or reuse a deleting path', () => isolated(async () => {
  await photo(); await detach(); await ready(); await claim();
  await db.exec('set local role authenticated');
  await db.query("insert into storage.objects(bucket_id,name) values ('work-photos','works/fresh.webp')");
  assert.equal((await db.query("update storage.objects set name='works/changed.webp' where name='works/fresh.webp' returning id")).rows.length, 0);
  await rejectsSql(() => db.query("insert into storage.objects(bucket_id,name) values ('work-photos',$1)", [path]), '42501');
}));

test('Admin upload RPCs work through invoker facades without granting direct registry updates', () => isolated(async () => {
  await db.exec('set local role authenticated');
  const registered = (await db.query('select public.begin_work_photo_upload($1) as data', [crypto.randomUUID()])).rows[0].data;
  assert.equal((await db.query('select public.renew_work_photo_upload($1) as renewed', [registered.url])).rows[0].renewed, true);
  await rejectsSql(() => db.query("update public.work_photo_cleanup set state='deleted' where url=$1", [registered.url]), '42501');
}));

test('The live server-cleanup verification script leaves no fixtures', async () => {
  await db.exec(await readFile(new URL('./server-photo-cleanup.verify.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query('select count(*)::int as count from public.work_photo_cleanup')).rows[0].count, 0);
  assert.equal((await db.query('select count(*)::int as count from public.works')).rows[0].count, 2);
});
