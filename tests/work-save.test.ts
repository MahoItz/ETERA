import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkSaveError, WorkSaveSession, type WorkDraft, type WorkSaveRequest } from "../src/work-save.ts";
import type { Work } from "../lib/model.ts";

const draft: WorkDraft = {
  title: "Работа", description: "", category: "Гипс", material: "Гипс", dimensions: "",
  price: null, availability: "order", status: "published", featured: false,
  photos: [{ url: "images/fairies.jpg", alt: "Фото" }], variants: [],
};
const saved = (request: WorkSaveRequest): Work => ({
  ...request.input, id: request.id ?? "new-id", revision: (request.revision ?? 0) + 1,
  updatedAt: "2026-10-18T00:00:00Z",
});

test("Lost create response replays the exact operation, without another create", async () => {
  const calls: WorkSaveRequest[] = [];
  const session = new WorkSaveSession(async (request) => {
    calls.push(structuredClone(request));
    if (calls.length === 1) throw new TypeError("Failed to fetch after commit");
    return saved(request);
  }, null);
  await assert.rejects(session.save(draft));
  const result = await session.save(draft);
  assert.equal(result.id, "new-id");
  assert.deepEqual(calls[1], calls[0]);
});

test("Lost update response replays the acknowledged revision before saving new edits", async () => {
  const calls: WorkSaveRequest[] = [];
  const session = new WorkSaveSession(async (request) => {
    calls.push(structuredClone(request));
    if (calls.length === 1) throw new WorkSaveError("Timeout", false);
    return saved(request);
  }, { id: "existing", revision: 1 });
  await assert.rejects(session.save(draft));
  const result = await session.save({ ...draft, title: "Исправлено после таймаута" });
  assert.deepEqual(calls[1], calls[0]);
  assert.notEqual(calls[2].requestId, calls[0].requestId);
  assert.equal(calls[2].id, "existing");
  assert.equal(calls[2].revision, 2);
  assert.equal(result.revision, 3);
  assert.equal(result.title, "Исправлено после таймаута");
});

test("A confirmed rollback allows correcting the draft and retrying the same work version", async () => {
  const calls: WorkSaveRequest[] = [];
  const session = new WorkSaveSession(async (request) => {
    calls.push(structuredClone(request));
    if (calls.length === 1) throw new WorkSaveError("Photo insert failed", true);
    return saved(request);
  }, { id: "existing", revision: 1 });
  await assert.rejects(session.save(draft));
  const result = await session.save({ ...draft, title: "Исправлено" });
  assert.notEqual(calls[1].requestId, calls[0].requestId);
  assert.equal(calls[1].revision, 1);
  assert.equal(result.revision, 2);
});

test("Changed draft after a lost create response updates the created ID", async () => {
  const calls: WorkSaveRequest[] = [];
  const session = new WorkSaveSession(async (request) => {
    calls.push(structuredClone(request));
    if (calls.length === 1) throw new Error("Connection lost");
    return saved(request);
  }, null);
  await assert.rejects(session.save(draft));
  const result = await session.save({ ...draft, description: "Новые детали" });
  assert.equal(calls.filter((call) => call.id === null).length, 2); // same request, twice
  assert.equal(calls[2].id, "new-id");
  assert.equal(calls[2].revision, 1);
  assert.equal(result.revision, 2);
});

test("Double submit is blocked while an operation is pending", async () => {
  let complete!: (result: Work) => void;
  let request!: WorkSaveRequest;
  const session = new WorkSaveSession((value) => {
    request = value;
    return new Promise((resolve) => { complete = resolve; });
  }, null);
  const first = session.save(draft);
  await assert.rejects(session.save(draft), /Дождитесь/);
  complete(saved(request));
  await first;
});
