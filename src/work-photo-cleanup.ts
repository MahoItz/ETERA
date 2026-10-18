import type { SupabaseClient } from "@supabase/supabase-js";

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export function storagePathFromUrl(client: SupabaseClient, url: string): string | null {
  // Never turn an external lookalike URL into a deletion in our own bucket.
  const base = client.storage.from("work-photos").getPublicUrl("").data.publicUrl;
  if (!url.startsWith(base)) return null;
  try {
    const path = decodeURIComponent(url.slice(base.length));
    return /^works\/[a-f0-9-]+\.webp$/.test(path) ? path : null;
  } catch {
    return null;
  }
}

export async function workPhotoIsUsed(client: SupabaseClient, url: string, path: string): Promise<boolean> {
  const results = await Promise.all([
    client.from("tree_ornaments").select("id").eq("image_url", url).limit(1),
    client.from("photos").select("id").eq("url", url).limit(1),
    client.from("photos").select("id").eq("storage_path", path).limit(1),
    client.from("variants").select("id").eq("image_url", url).limit(1),
    client.from("works").select("id").eq("tree_image", url).limit(1),
  ]);
  for (const result of results) fail(result.error);
  return results.some((result) => result.data?.length);
}

// A failed check/deletion leaves the durable candidate for a later save. Storage
// cleanup never participates in the acknowledgement of a catalogue commit.
export async function cleanQueuedWorkPhotos(client: SupabaseClient) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const queued = await client.from("work_photo_cleanup").select("url, queued_at")
    .lte("queued_at", cutoff).order("queued_at").limit(16);
  fail(queued.error);
  for (const candidate of queued.data ?? []) {
    const path = storagePathFromUrl(client, candidate.url);
    if (path && !await workPhotoIsUsed(client, candidate.url, path)) {
      const removed = await client.storage.from("work-photos").remove([path]);
      fail(removed.error);
    }
    const acknowledged = await client.from("work_photo_cleanup").delete()
      .eq("url", candidate.url).eq("queued_at", candidate.queued_at);
    fail(acknowledged.error);
  }
}
