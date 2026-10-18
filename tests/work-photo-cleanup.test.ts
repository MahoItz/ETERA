import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { renewPhotoUpload, storagePathFromUrl, uploadProtectedPhoto } from "../src/work-photo-cleanup.ts";

const origin = "https://test.supabase.co";
const path = "works/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";
const photoUrl = `${origin}/storage/v1/object/public/work-photos/${path}`;

function fixture({ registrationFailure = false, uploadFailure = false, renewable = true } = {}) {
  const calls: { url: URL; method: string }[] = [];
  const client = createClient(origin, "publishable-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.pathname.endsWith("/begin_work_photo_upload")) {
        return registrationFailure
          ? Response.json({ message: "Registration failed", code: "55000" }, { status: 400 })
          : Response.json({ url: photoUrl, path });
      }
      if (url.pathname.endsWith("/renew_work_photo_upload")) return Response.json(renewable);
      if (url.pathname.startsWith("/storage/")) return Response.json(uploadFailure ? { message: "Upload failed" } : { Key: path }, { status: uploadFailure ? 503 : 200 });
      throw new Error("Unexpected request: " + url.pathname);
    } },
  });
  return { client, calls };
}

test("A temporary upload is registered on the server before sending the bytes", async () => {
  const { client, calls } = fixture();
  assert.deepEqual(await uploadProtectedPhoto(client, new Blob(["image"])), { url: photoUrl });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.pathname.endsWith("/begin_work_photo_upload"));
  assert.ok(calls[1].url.pathname.startsWith("/storage/"));
  assert.ok(calls.every((call) => call.method !== "DELETE"));
});

test("Registration errors prevent uploading untracked bytes", async () => {
  const { client, calls } = fixture({ registrationFailure: true });
  await assert.rejects(uploadProtectedPhoto(client, new Blob(["image"])), /Registration failed/);
  assert.equal(calls.length, 1);
});

test("An upload error is surfaced and never causes eager deletion", async () => {
  const { client, calls } = fixture({ uploadFailure: true });
  await assert.rejects(uploadProtectedPhoto(client, new Blob(["image"])), /Upload failed/);
  assert.ok(calls.every((call) => call.method !== "DELETE"));
});

test("Retries renew a temporary upload; expired files can be uploaded again", async () => {
  assert.equal(await renewPhotoUpload(fixture().client, photoUrl), true);
  assert.equal(await renewPhotoUpload(fixture({ renewable: false }).client, photoUrl), false);
});

test("Storage paths reject foreign, malformed and unmanaged URLs", () => {
  const { client } = fixture();
  assert.equal(storagePathFromUrl(client, photoUrl), path);
  assert.equal(storagePathFromUrl(client, photoUrl.replace(path, "works/shared.webp")), "works/shared.webp");
  assert.equal(storagePathFromUrl(client, photoUrl.replace(origin, "https://external.example")), null);
  assert.equal(storagePathFromUrl(client, photoUrl.replace(path, "works/%E0%A4%A")), null);
  assert.equal(storagePathFromUrl(client, photoUrl.replace(path, "works/../shared.webp")), null);
  assert.equal(storagePathFromUrl(client, "/images/fairies.jpg"), null);
});
