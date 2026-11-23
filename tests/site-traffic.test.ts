import { test } from "node:test";
import assert from "node:assert/strict";
import { createTrafficTracker, trafficRoute } from "../lib/site-traffic.ts";

function setup(blocked = false) {
  const values = new Map<string, string>();
  let id = 0;
  const storage = {
    getItem: (key: string) => { if (blocked) throw Error(); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (blocked) throw Error(); values.set(key, value); },
  };
  const uuid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++id).padStart(12, "0")}`;
  return { storage, uuid, tracker: createTrafficTracker(storage, uuid) };
}

test("route ignores tokens, variants, searches and hashes; counts catalog and work transitions", () => {
  const root = trafficRoute("https://example.test/?utm_source=test#catalog");
  assert.equal(root, trafficRoute("https://example.test/?search=abc"));
  const work = trafficRoute("https://example.test/?work=one&variant=small");
  assert.equal(work, trafficRoute("https://example.test/?work=one&variant=large"));
  assert.notEqual(root, work);
  assert.equal(trafficRoute("https://example.test/?account=admin&conversation=secret"), null);
  assert.equal(trafficRoute("https://example.test/#access_token=secret"), null);
  assert.equal(trafficRoute("https://example.test/?type=recovery"), null);
});

test("rerenders and StrictMode don't count again; returning to catalog and reload do", () => {
  const { tracker, storage, uuid } = setup();
  const first = tracker("catalog", 1000)!;
  assert.equal(tracker("catalog", 1001), null);
  const second = tracker("work", 1002)!;
  assert.equal(second.visitor_id, first.visitor_id);
  assert.equal(second.session_id, first.session_id);
  assert.notEqual(second.event_id, first.event_id);
  assert.ok(tracker("catalog", 1003));
  const reloaded = createTrafficTracker(storage, uuid)("catalog", 1004)!;
  assert.equal(reloaded.visitor_id, first.visitor_id);
  assert.equal(reloaded.session_id, first.session_id);
});

test("after 30 minutes a new visit is recorded; denied storage retains identity in memory", () => {
  const { tracker } = setup(true);
  const first = tracker("catalog", 1000)!;
  assert.equal(tracker("catalog", 1001), null);
  const returning = tracker("catalog", 1000 + 30 * 60 * 1000)!;
  assert.equal(returning.visitor_id, first.visitor_id);
  assert.notEqual(returning.session_id, first.session_id);
  const work = tracker("work", 1001 + 30 * 60 * 1000)!;
  assert.equal(work.session_id, returning.session_id);
});
