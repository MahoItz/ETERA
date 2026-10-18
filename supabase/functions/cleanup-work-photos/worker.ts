import type { SupabaseClient } from "@supabase/supabase-js";

type Claim = { object_path: string; claim_token: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createCleanupHandler(client: SupabaseClient) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    let token: string;
    try {
      const body = await request.text();
      if (body.length > 2048) throw new Error("Request too large");
      const input = JSON.parse(body);
      if (typeof input.token !== "string" || !input.token || input.token.length > 256) throw new Error("Missing token");
      token = input.token;
    } catch {
      return Response.json({ error: "Invalid cleanup credentials" }, { status: 401 });
    }

    const result = await client.rpc("claim_work_photo_cleanup", { worker_secret: token });
    if (result.error) {
      if (result.error.code === "42501") return Response.json({ error: "Invalid cleanup credentials" }, { status: 401 });
      console.error("Cannot claim photo cleanup:", result.error.message);
      return Response.json({ error: "Cleanup temporarily unavailable" }, { status: 503 });
    }
    let deleted = 0, failed = 0, deferred = 0;
    for (const claim of (result.data ?? []) as Claim[]) {
      const args = { worker_secret: token, object_path: claim.object_path, claim_token: claim.claim_token };
      try {
        if (!/^works\/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$/.test(claim.object_path)) throw new Error("Invalid managed photo path");
        // Recheck immediately before the Storage API call. The persistent
        // deleting state rejects new references even between separate requests.
        const verified = await client.rpc("confirm_work_photo_cleanup", args);
        if (verified.error) throw new Error(verified.error.message);
        if (verified.data !== true) { deferred++; continue; }
        const removed = await client.storage.from("work-photos").remove([claim.object_path]);
        if (removed.error) throw new Error(removed.error.message);
        const finished = await client.rpc("finish_work_photo_cleanup", { ...args, cleanup_error: null });
        if (finished.error) throw new Error(finished.error.message);
        deleted++;
      } catch (error) {
        failed++;
        const reason = message(error).slice(0, 1000);
        console.warn("Photo cleanup failed:", claim.object_path, reason);
        try {
          const recorded = await client.rpc("finish_work_photo_cleanup", { ...args, cleanup_error: reason });
          if (recorded.error) console.error("Cannot record cleanup failure:", recorded.error.message);
        } catch {
          // The claim expires automatically; its deleting state remains, so a
          // later worker can retry without risking a newly referenced object.
          console.error("Cannot record cleanup failure; claim will be retried");
        }
      }
    }
    return Response.json({ deleted, failed, deferred }, { status: failed ? 503 : 200 });
  };
}
