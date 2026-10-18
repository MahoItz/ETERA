import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { cleanQueuedWorkPhotos, storagePathFromUrl } from "../src/work-photo-cleanup.ts";

const origin = "https://test.supabase.co";
const path = "works/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";
const photoUrl = `${origin}/storage/v1/object/public/work-photos/${path}`;
const candidate = { url: photoUrl, queued_at: "2026-01-01T00:00:00Z" };

function fixture({ references = [] as string[], failedCheck = "", storageFailure = false, candidates = [candidate] } = {}) {
  const calls: { url: URL; method: string }[] = [];
  const client = createClient(origin, "publishable-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const table = url.pathname.split("/").pop()!;
      if (method === "DELETE" && url.pathname.startsWith("/storage/")) {
        return Response.json(storageFailure ? { message: "Storage unavailable" } : [], { status: storageFailure ? 503 : 200 });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (table === "work_photo_cleanup") return Response.json(candidates);
      if (table === failedCheck) return Response.json({ message: "Reference check failed" }, { status: 500 });
      const column = ["url", "storage_path", "image_url", "tree_image"].find((name) => url.searchParams.has(name));
      return Response.json(references.includes(`${table}.${column}`) ? [{ id: "used" }] : []);
    } },
  });
  return { client, calls };
}

for (const reference of ["photos.url", "photos.storage_path", "variants.image_url", "tree_ornaments.image_url", "works.tree_image"]) {
  test(`Cleanup preserves an image referenced by ${reference}`, async () => {
    const { client, calls } = fixture({ references: [reference] });
    await cleanQueuedWorkPhotos(client);
    assert.equal(calls.some((call) => call.url.pathname.startsWith("/storage/") && call.method === "DELETE"), false);
  });
}

test("Cleanup waits 24 hours, checks references, then removes the file and acknowledges the candidate", async () => {
  const { client, calls } = fixture();
  await cleanQueuedWorkPhotos(client);
  const cutoff = calls[0].url.searchParams.get("queued_at")!;
  assert.ok(cutoff.startsWith("lte."));
  assert.ok(Math.abs(Date.parse(cutoff.slice(4)) - (Date.now() - 86400000)) < 5000);
  assert.equal(calls.filter((call) => call.method === "GET").length, 6);
  const deletions = calls.filter((call) => call.method === "DELETE");
  assert.equal(deletions.length, 2);
  assert.ok(deletions[0].url.pathname.startsWith("/storage/"));
  assert.equal(deletions[1].url.searchParams.get("queued_at"), `eq.${candidate.queued_at}`);
});

test("Failed reference checks retain the candidate and never delete Storage", async () => {
  const { client, calls } = fixture({ failedCheck: "variants" });
  await assert.rejects(cleanQueuedWorkPhotos(client));
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});

test("Failed Storage deletion leaves the candidate queued", async () => {
  const { client, calls } = fixture({ storageFailure: true });
  await assert.rejects(cleanQueuedWorkPhotos(client));
  assert.equal(calls.some((call) => call.url.pathname.endsWith("/work_photo_cleanup") && call.method === "DELETE"), false);
});

test("Malformed, foreign and non-managed image URLs never address this bucket", async () => {
  const { client, calls } = fixture({ candidates: [
    { ...candidate, url: photoUrl.replace(origin, "https://external.example") },
    { ...candidate, url: `${origin}/storage/v1/object/public/work-photos/works/%E0%A4%A` },
    { ...candidate, url: "/images/fairies.jpg" },
  ] });
  assert.equal(storagePathFromUrl(client, photoUrl), path);
  assert.equal(storagePathFromUrl(client, photoUrl + "?download=1"), null);
  await cleanQueuedWorkPhotos(client);
  assert.equal(calls.some((call) => call.url.pathname.startsWith("/storage/")), false);
});
