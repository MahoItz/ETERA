import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './helpers/supabase-test-db.mjs';

let db;
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const state = async () => (await db.query(`select jsonb_build_object(
  'categories', (select jsonb_agg(jsonb_build_object('name', name, 'position', position) order by position, name) from public.categories),
  'revision', (select revision from public.category_list_state where id)
) as value`)).rows[0].value;
const save = async (revision, names, originals) =>
  (await db.query('select * from public.save_categories($1, $2, $3)', [revision, names, originals])).rows[0];

before(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into auth.users values ('${admin}');
    insert into public.profiles(id) values ('${admin}') on conflict (id) do update set role = 'admin';
    select set_config('request.jwt.claim.sub', '${admin}', false);
    delete from public.categories;
    insert into public.categories(name, position) values ('Old', 0), ('Keep', 1);
    create function public.fail_category_update() returns trigger language plpgsql as $$
    begin
      if current_setting('test.fail_categories', true) = 'on' then
        raise exception 'Injected category failure' using errcode = '23514';
      end if;
      return new;
    end $$;
    create trigger test_category_failure before update on public.categories for each row execute function public.fail_category_update();`);
});
after(() => db.close());

test('renaming to a removed category name is one atomic list save', async () => {
  const before = await state();
  const saved = await save(before.revision, ['Old'], ['Keep']);
  assert.deepEqual(saved.names, ['Old']);
  assert.ok(saved.revision > before.revision);
  assert.deepEqual((await state()).categories, [{ name: 'Old', position: 0 }]);
});

test('a stale category list is rejected without changing anything', async () => {
  const before = await state();
  await db.query("insert into public.categories(name, position) values ('Concurrent', 1)");
  const changed = await state();
  await assert.rejects(() => save(before.revision, ['Replacement'], ['Old']), (error) => error.code === '40001');
  assert.deepEqual(await state(), changed);
});

test('an error during a list save rolls back every category and the revision', async () => {
  const before = await state();
  await db.query("select set_config('test.fail_categories', 'on', false)");
  await assert.rejects(() => save(before.revision, ['Changed', 'Concurrent'], ['Old', 'Concurrent']), (error) => error.code === '23514');
  assert.deepEqual(await state(), before);
  await db.query("select set_config('test.fail_categories', '', false)");
});
