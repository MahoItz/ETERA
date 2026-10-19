import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export async function createTestDatabase() {
  const db = new PGlite();
  // Emulate platform schemas, roles and default grants. No remote resources.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, created_at timestamptz default now(), is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text,
      created_at timestamptz default now(), unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated;`);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  for (const filename of (await readdir(migrations)).filter((name) => name.endsWith('.sql') && name !== '0011_schedule_photo_cleanup.sql').sort()) {
    const sql = (await readFile(new URL(filename, migrations), 'utf8')).replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  }
  // pg_cron/pg_net are platform integrations, not available in PGlite.
  await db.query('select private.configure_photo_cleanup($1, $2)', ['https://test.supabase.co', 'publishable-test-key']);
  return db;
}
