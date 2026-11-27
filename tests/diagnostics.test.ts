import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDiagnosticQueue, diagnosticDevice, diagnosticEndpoint, validDiagnostic, type Diagnostic } from '../lib/diagnostics.ts';

const now = Date.now();
const event = (fields: Partial<Diagnostic> = {}): Diagnostic => ({ id: randomUUID(), occurred_at: new Date(now).toISOString(), kind: 'network', service: 'rest', resource: 'catalog_cards', method: 'GET', status: 0, duration_ms: 12, online: true, browser: 'Chrome', platform: 'Windows', build: 'test', ...fields });
test('reports exclude arbitrary fields, URLs, identifiers and stale or malformed data', () => {
  assert.equal(validDiagnostic(event(), now), true);
  for (const unsafe of [{ ...event(), token: 'secret' }, event({ resource: 'https://secret.test/token' as Diagnostic['resource'] }), event({ build: 'https://secret.test' }), { ...event(), id: [randomUUID()] }, event({ occurred_at: new Date(now - 8 * 86400000).toISOString() }), event({ duration_ms: -1 }), event({ status: 999 })]) assert.equal(validDiagnostic(unsafe, now), false);
});
test('outbox survives reload, caps at 20, deduplicates and removes only acknowledged events', () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  const queue = createDiagnosticQueue(storage, () => now);
  const first = event(); queue.add(first); assert.equal(queue.add(event())?.id, first.id); assert.equal(queue.list().length, 1);
  assert.equal(createDiagnosticQueue(storage, () => now).list()[0].id, first.id);
  const second = event({ kind: 'body' }); queue.add(second); queue.remove(first.id);
  assert.deepEqual(queue.list().map(d => d.id), [second.id]);
  for (let i = 0; i < 25; i++) queue.add(event({ kind: 'http', status: 400 + i }));
  assert.equal(queue.list().length, 20);
  assert.equal(createDiagnosticQueue(storage, () => now + 8 * 86400000).list().length, 0);
});
test('denied or corrupted storage does not prevent local diagnostic capture', () => {
  const queue = createDiagnosticQueue({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }, () => now);
  queue.add(event()); assert.equal(queue.list().length, 1);
  const broken = createDiagnosticQueue({ getItem: () => '{', setItem() {} }, () => now);
  broken.add(event()); assert.equal(broken.list().length, 1);
  const quota = createDiagnosticQueue({ getItem: () => null, setItem() { throw new Error('quota exceeded'); } }, () => now);
  quota.add(event()); assert.equal(quota.list().length, 1);
});
test('endpoint classification strips query values and excludes reporter recursion and other origins', () => {
  const base = 'https://test.supabase.co';
  assert.deepEqual(diagnosticEndpoint(`${base}/rest/v1/catalog_cards?email=private&token=secret`, base), { service: 'rest', resource: 'catalog_cards' });
  assert.deepEqual(diagnosticEndpoint(`${base}/rest/v1/rpc/cart_submit`, base), { service: 'rest', resource: 'rpc' });
  for (const href of [`${base}/rest/v1/rpc/record_site_diagnostic`, `${base}/rest/v1/rpc/admin_site_diagnostics`, `${base}/storage/v1/private/secret`, 'https://other.test/rest/v1/catalog_cards']) assert.equal(diagnosticEndpoint(href, base), null);
  assert.deepEqual(diagnosticDevice('Mozilla/5.0 (Android) Chrome/123.0'), { browser: 'Chrome', platform: 'Android' });
});
