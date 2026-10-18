import type { Session } from "@supabase/supabase-js";
import { defaults, type Settings, type Variant, type Work } from "../lib/model";
import { supabase } from "./supabase";
import type { TreeOrnament } from "./tree-items";
import { WorkSaveError, type WorkSaveRequest } from "./work-save";
import { cleanQueuedWorkPhotos, storagePathFromUrl as photoStoragePath, workPhotoIsUsed } from "./work-photo-cleanup";

type WorkRow = Record<string, unknown> & {
  id: string;
  title: string;
  description: string;
  material: string;
  dimensions: string;
  price: number | null;
  availability: Work["availability"];
  status: Work["status"];
  featured: boolean;
  tree_image?: string | null;
  show_on_tree?: boolean;
  revision: number;
  updated_at: string;
  category?: { name?: string } | null;
  photos?: Array<{
    url: string;
    alt: string;
    position: number;
    storage_path?: string | null;
  }>;
  variants?: Array<{
    id: string;
    name: string;
    image_url?: string | null;
    price: number | null;
    availability: Variant["availability"];
    position: number;
  }>;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
function mapWork(row: WorkRow): Work {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category?.name ?? "Без категории",
    material: row.material,
    dimensions: row.dimensions,
    price: row.price === null ? null : Number(row.price),
    availability: row.availability,
    status: row.status,
    featured: row.featured,
    treeImage: row.tree_image ?? null,
    showOnTree: row.show_on_tree ?? false,
    photos: (row.photos ?? [])
      .sort((a, b) => a.position - b.position)
      .map(({ url, alt }) => ({ url, alt })),
    variants: (row.variants ?? [])
      .sort((a, b) => a.position - b.position)
      .map(({ id, name, image_url, price, availability, position }) => ({
        id, name, imageUrl: image_url?.startsWith("blob:") ? null : image_url ?? null, price: price === null ? null : Number(price), availability, position,
      })),
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export async function loadCatalog(): Promise<{
  works: Work[];
  ornaments: TreeOrnament[];
  settings: Settings;
  initialized: boolean;
}> {
  const [worksResult, settingsResult, categoriesResult, ornamentsResult] = await Promise.all([
    supabase
      .from("works")
      .select("*, category:categories(name), photos(*), variants(*)")
      .order("featured", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("site_settings")
      .select("name, contact")
      .eq("id", true)
      .maybeSingle(),
    supabase.from("categories").select("name").order("position").order("name"),
    supabase.from("tree_ornaments").select("*").order("position").order("created_at"),
  ]);
  fail(worksResult.error);
  fail(settingsResult.error);
  fail(categoriesResult.error);
  fail(ornamentsResult.error);
  return {
    works: ((worksResult.data ?? []) as WorkRow[]).map(mapWork),
    ornaments: (ornamentsResult.data ?? []).map((row) => ({ id: row.id, title: row.title, imageUrl: row.image_url, workId: row.work_id, position: row.position })),
    settings: {
      name: settingsResult.data?.name ?? defaults.name,
      contact: settingsResult.data?.contact ?? "",
      categories: (categoriesResult.data ?? []).map((c) => c.name),
    },
    initialized: true,
  };
}

async function categoryId(name: string) {
  const clean = name.trim();
  const existing = await supabase
    .from("categories")
    .select("id")
    .eq("name", clean)
    .maybeSingle();
  fail(existing.error);
  if (existing.data) return existing.data.id;
  const created = await supabase
    .from("categories")
    .insert({ name: clean })
    .select("id")
    .single();
  fail(created.error);
  if (!created.data) throw new Error("Не удалось создать категорию.");
  return created.data.id;
}

export async function saveWork(request: WorkSaveRequest): Promise<Work> {
  const { input } = request;
  const result = await supabase.rpc("save_work", {
    request_id: request.requestId,
    work_id: request.id,
    expected_revision: request.revision,
    payload: {
      ...input,
      photos: input.photos.map((photo) => ({ ...photo, storage_path: storagePathFromUrl(photo.url) })),
    },
  });
  if (result.error) {
    const code = result.error.code;
    const message = code === "PGRST202"
      ? "Для сохранения нужно применить обновление базы данных. Ваши изменения остались в редакторе."
      : code === "40001"
        ? "Эту работу уже изменили на другом устройстве. Обновите каталог."
        : result.error.message;
    // SQLSTATE errors acknowledge a rollback. A network failure or a broken
    // response does not tell us whether the transaction committed.
    throw new WorkSaveError(message, /^[0-9A-Z]{5}$/.test(code) || code === "PGRST202");
  }
  if (!result.data) throw new WorkSaveError("Не получен результат сохранения. Повторите попытку.", false);
  const saved = mapWork(result.data as WorkRow);
  void cleanQueuedWorkPhotos(supabase).catch((error) => console.warn("Отложенная очистка фотографий:", error));
  return saved;
}

export async function deleteWork(id: string, revision: number) {
  // Keep the storage keys before the cascading database delete removes the rows
  // that describe them.
  const [photos, ornaments] = await Promise.all([
    supabase.from("photos").select("url, storage_path").eq("work_id", id),
    supabase.from("tree_ornaments").select("image_url").eq("work_id", id),
  ]);
  fail(photos.error);
  fail(ornaments.error);

  const deleted = await supabase
    .from("works")
    .delete()
    .eq("id", id)
    .eq("revision", revision)
    .select("id")
    .maybeSingle();
  fail(deleted.error);
  if (!deleted.data) {
    throw new Error(
      "Работу уже изменили или удалили на другом устройстве. Обновите каталог.",
    );
  }

  const paths = new Set<string>();
  for (const photo of photos.data ?? []) {
    if (photo.storage_path) paths.add(photo.storage_path);
  }
  for (const ornament of ornaments.data ?? []) {
    const path = storagePathFromUrl(ornament.image_url);
    if (path) paths.add(path);
  }
  if (!paths.size) return;

  // URLs can be deliberately reused by another catalogue item, so only remove
  // files that are no longer referenced anywhere.
  const urls = [
    ...(photos.data ?? []).map((photo) => photo.url),
    ...(ornaments.data ?? []).map((ornament) => ornament.image_url),
  ];
  const [usedPhotos, usedOrnaments, usedVariants] = await Promise.all([
    supabase.from("photos").select("url").in("url", urls),
    supabase.from("tree_ornaments").select("image_url").in("image_url", urls),
    supabase.from("variants").select("image_url").in("image_url", urls),
  ]);
  if (usedPhotos.error || usedOrnaments.error || usedVariants.error) return;
  const usedUrls = new Set([
    ...(usedPhotos.data ?? []).map((photo) => photo.url),
    ...(usedOrnaments.data ?? []).map((ornament) => ornament.image_url),
    ...(usedVariants.data ?? []).flatMap((variant) => variant.image_url ? [variant.image_url] : []),
  ]);
  const unusedPaths = [...paths].filter((path) => !usedUrls.has(
    supabase.storage.from("work-photos").getPublicUrl(path).data.publicUrl,
  ));
  // The catalogue record has already been deleted successfully. A failed
  // best-effort storage cleanup must not report that deletion itself failed.
  if (unusedPaths.length) {
    const removed = await supabase.storage.from("work-photos").remove(unusedPaths);
    if (removed.error) console.warn("Не удалось очистить файлы удалённой работы:", removed.error.message);
  }
}

export async function saveTreeOrnament(input: TreeOrnament): Promise<TreeOrnament> {
  const result = await supabase.from("tree_ornaments").upsert({
    id: input.id, title: input.title.trim(), image_url: input.imageUrl,
    work_id: input.workId, position: input.position,
  }).select("id").single();
  fail(result.error);
  return { ...input, title: input.title.trim() };
}

export async function deleteTreeOrnament(id: string) {
  const result = await supabase.from("tree_ornaments").delete().eq("id", id);
  fail(result.error);
}

export async function saveTreeOrnamentOrder(previous: TreeOrnament[], ordered: TreeOrnament[]) {
  const previousIds = new Set(previous.map((item) => item.id));
  if (previous.length !== ordered.length || new Set(ordered.map((item) => item.id)).size !== previous.length
    || previousIds.size !== previous.length || ordered.some((item) => !previousIds.has(item.id))) {
    throw new Error("Не удалось изменить порядок. Обновите страницу и попробуйте снова.");
  }
  const result = await supabase.rpc("reorder_tree_ornaments", {
    ordered_ids: ordered.map((item) => item.id),
    expected_ids: previous.map((item) => item.id),
    expected_positions: previous.map((item) => item.position),
  });
  if (result.error?.code === "PGRST202") {
    throw new Error("Для сохранения порядка нужно применить обновление базы данных. Пока оставлен прежний порядок.");
  }
  if (result.error?.code === "40001") {
    throw new Error("Список украшений уже изменён на другом устройстве. Закройте окно и обновите страницу перед повторной попыткой.");
  }
  fail(result.error);
  return ordered.map((item, position) => ({ ...item, position }));
}

export async function cleanUnusedTreeImage(url: string) {
  const path = storagePathFromUrl(url);
  if (!path) return;
  if (await workPhotoIsUsed(supabase, url, path)) return;
  await supabase.storage.from("work-photos").remove([path]);
}

function storagePathFromUrl(url: string) {
  return photoStoragePath(supabase, url);
}

export async function uploadPhoto(blob: Blob): Promise<{ url: string }> {
  const path = `works/${crypto.randomUUID()}.webp`;
  const upload = await supabase.storage
    .from("work-photos")
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  fail(upload.error);
  return {
    url: supabase.storage.from("work-photos").getPublicUrl(path).data.publicUrl,
  };
}

export type CategoryDraft = { key: string; original: string | null; name: string };

export async function saveCategories(categories: CategoryDraft[]): Promise<string[]> {
  const names = categories.map((category) => category.name.trim());
  if (names.some((name) => !name || name.length > 80)) throw new Error("Название категории должно содержать от 1 до 80 символов.");
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) throw new Error("Названия категорий не должны повторяться.");
  const existing = await supabase.from("categories").select("id, name");
  fail(existing.error);
  const rows = existing.data ?? [];
  // Keep category IDs so renaming also updates the names shown on related works.
  for (const category of categories) {
    const row = rows.find((row) => row.name === category.original);
    const conflict = rows.find((other) => other.name === category.name.trim() && other.id !== row?.id);
    if (conflict) throw new Error(`Название «${conflict.name}» уже занято. Сначала переименуйте или удалите эту категорию и сохраните изменения.`);
    if (category.original && !row) throw new Error("Категории изменились. Закройте окно и обновите каталог.");
  }
  for (const [position, category] of categories.entries()) {
    const row = rows.find((row) => row.name === category.original);
    const payload = { name: names[position], position };
    const result = row
      ? await supabase.from("categories").update(payload).eq("id", row.id)
      : await supabase.from("categories").insert(payload);
    fail(result.error);
  }
  const removed = rows.filter((row) => !categories.some((category) => category.original === row.name));
  if (removed.length) {
    const result = await supabase.from("categories").delete().in("id", removed.map((row) => row.id));
    fail(result.error);
  }
  return names;
}

export async function saveSettings(input: Settings): Promise<Settings> {
  const names = [
    ...new Set(input.categories.map((name) => name.trim()).filter(Boolean)),
  ];
  const result = await supabase
    .from("site_settings")
    .update({ name: input.name.trim(), contact: input.contact.trim() })
    .eq("id", true);
  fail(result.error);
  for (const name of names) await categoryId(name);
  return {
    name: input.name.trim(),
    contact: input.contact.trim(),
    categories: names,
  };
}

export async function getAdminSession(): Promise<Session | null> {
  const result = await supabase.auth.getSession();
  if (result.error) throw new Error(result.error.message);
  if (!result.data.session) return null;
  const profile = await supabase
    .from("profiles")
    .select("id")
    .eq("id", result.data.session.user.id)
    .maybeSingle();
  fail(profile.error);
  return profile.data ? result.data.session : null;
}

export async function signIn(email: string, password: string) {
  const result = await supabase.auth.signInWithPassword({ email, password });
  fail(result.error);
  if (!result.data.session) throw new Error("Supabase не вернул сессию.");
  const profile = await supabase
    .from("profiles")
    .select("id")
    .eq("id", result.data.session.user.id)
    .maybeSingle();
  fail(profile.error);
  if (!profile.data) {
    await supabase.auth.signOut();
    throw new Error("У этой учётной записи нет прав редактора.");
  }
  return result.data.session;
}
export async function signOut() {
  const result = await supabase.auth.signOut();
  fail(result.error);
}
