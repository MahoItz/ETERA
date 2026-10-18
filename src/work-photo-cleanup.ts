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
    return /^works\/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$/.test(path) && path.length <= 240 ? path : null;
  } catch {
    return null;
  }
}

export async function renewPhotoUpload(client: SupabaseClient, url: string): Promise<boolean> {
  const result = await client.rpc("renew_work_photo_upload", { image_url: url });
  fail(result.error);
  return result.data === true;
}

export async function uploadProtectedPhoto(client: SupabaseClient, blob: Blob): Promise<{ url: string }> {
  // Register before sending bytes. A failed upload/save or a closed editor
  // leaves a durable candidate, protected for 24 hours by the server clock.
  const registered = await client.rpc("begin_work_photo_upload", { upload_id: crypto.randomUUID() });
  fail(registered.error);
  const registration = registered.data as { url: string; path: string } | null;
  if (!registration || storagePathFromUrl(client, registration.url) !== registration.path) {
    throw new Error("Не удалось зарегистрировать загрузку фотографии.");
  }
  const upload = await client.storage.from("work-photos").upload(registration.path, blob, {
    contentType: "image/webp", upsert: false,
  });
  fail(upload.error);
  return { url: registration.url };
}
