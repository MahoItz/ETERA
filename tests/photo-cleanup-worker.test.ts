import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createCleanupHandler } from "../supabase/functions/cleanup-work-photos/worker.ts";

const claim = { object_path: "works/shared.webp", claim_token: "claim-1" };
function fixture({ verified = true, verificationFailure = false, storageFailure = false, finishFailure = false, unauthorized = false } = {}) {
  const calls: { route: string; body: unknown }[] = [];
  const client = createClient("https://test.supabase.co", "server-only-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const route = new URL(String(input)).pathname.split("/").pop()!;
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ route, body });
      if (route === "claim_work_photo_cleanup") return unauthorized
        ? Response.json({ code: "42501", message: "Invalid credentials" }, { status: 403 })
        : Response.json([claim]);
      if (route === "confirm_work_photo_cleanup") return verificationFailure
        ? Response.json({ code: "XX000", message: "Reference check unavailable" }, { status: 500 })
        : Response.json(verified);
      if (route === "finish_work_photo_cleanup") return finishFailure
        ? Response.json({ code: "XX000", message: "Cannot acknowledge" }, { status: 500 })
        : Response.json(null);
      if (route === "work-photos") return storageFailure
        ? Response.json({ message: "Storage unavailable" }, { status: 503 })
        : Response.json([{ name: claim.object_path }]);
      throw new Error("Unexpected route: " + route);
    } },
  });
  const handler = createCleanupHandler(client);
  return { calls, handler, run: () => handler(new Request("https://worker.example", { method: "POST", body: JSON.stringify({ token: "cron-token" }) })) };
}

test("The worker rechecks immediately before Storage deletion and acknowledges only afterwards", async () => {
  const { run, calls } = fixture();
  const response = await run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: 1, failed: 0, deferred: 0 });
  assert.deepEqual(calls.map((call) => call.route), ["claim_work_photo_cleanup", "confirm_work_photo_cleanup", "work-photos", "finish_work_photo_cleanup"]);
  assert.equal((calls[3].body as { cleanup_error: unknown }).cleanup_error, null);
});

test("A failed or expired confirmation never deletes bytes", async () => {
  for (const options of [{ verified: false }, { verificationFailure: true }]) {
    const { run, calls } = fixture(options);
    await run();
    assert.equal(calls.some((call) => call.route === "work-photos"), false);
  }
});

test("Storage errors are recorded durably and reported as a failed run", async () => {
  const { run, calls } = fixture({ storageFailure: true });
  const response = await run();
  assert.equal(response.status, 503);
  assert.match((calls.at(-1)!.body as { cleanup_error: string }).cleanup_error, /Storage unavailable/);
});

test("A lost acknowledgement leaves the claim available for retry instead of reporting success", async () => {
  const { run } = fixture({ finishFailure: true });
  const response = await run();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).deleted, 0);
});

test("The worker rejects unauthenticated calls without accessing Storage", async () => {
  const { handler, calls } = fixture();
  const noToken = await handler(new Request("https://worker.example", { method: "POST", body: "{}" }));
  assert.equal(noToken.status, 401);
  assert.equal(calls.length, 0);
  const wrongToken = fixture({ unauthorized: true });
  assert.equal((await wrongToken.run()).status, 401);
  assert.equal(wrongToken.calls.length, 1);
});
