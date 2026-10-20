import type { Session } from "@supabase/supabase-js";
import type { Measurements } from "../lib/measurements";
import { defaults, type Settings, type Variant, type Work } from "../lib/model";
import { normalizeContacts } from "../lib/contacts";
import { supabase } from "./supabase";
import type { TreeOrnament } from "./tree-items";
import { WorkSaveError, type WorkSaveRequest } from "./work-save";
import { renewPhotoUpload, storagePathFromUrl as photoStoragePath, uploadProtectedPhoto } from "./work-photo-cleanup";

type WorkRow = Record<string, unknown> & {
  id: string;
  slug?: string;
  title: string;
  description: string;
  material: string;
  dimensions: string;
  measurements?: Measurements | null;
  sold_as_set?: boolean;
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
    slug?: string;
    name: string;
    image_url?: string | null;
    price: number | null;
    availability: Variant["availability"];
    position: number;
    measurements?: Measurements | null;
    description?: string;
    photos?: WorkRow["photos"];
  }>;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
function mapWork(row: WorkRow): Work {
  return {
    id: row.id, slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category?.name ?? "Без категории",
    material: row.material,
    dimensions: row.dimensions,
    measurements: row.measurements ?? null,
    soldAsSet: row.sold_as_set ?? false,
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
      .map(({ id, slug, name, image_url, price, availability, position, measurements, description, photos }) => ({
        id, slug, name, imageUrl: image_url?.startsWith("blob:") ? null : image_url ?? null, price: price === null ? null : Number(price), availability, position,
        measurements: measurements ?? null,
        description: description ?? "",
        photos: photos ? [...photos].sort((a, b) => a.position - b.position).map(({ url, alt }) => ({ url, alt }))
          : image_url ? [{ url: image_url, alt: name }] : [],
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
  const [worksResult, settingsResult, categoriesResult, categoryStateResult, ornamentsResult] = await Promise.all([
    supabase
      .from("works")
      .select("*, category:categories(name), photos(*), variants(*, photos(*))")
      .order("featured", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("site_settings")
      .select("name, contact, vk, telegram, phone, hero_mode")
      .eq("id", true)
      .maybeSingle(),
    supabase.from("categories").select("name").order("position").order("name"),
    supabase.from("category_list_state").select("revision").eq("id", true).single(),
    supabase.from("tree_ornaments").select("*").order("position").order("created_at"),
  ]);
  fail(worksResult.error);
  fail(settingsResult.error);
  fail(categoriesResult.error);
  fail(categoryStateResult.error);
  fail(ornamentsResult.error);
  return {
    works: ((worksResult.data ?? []) as WorkRow[]).map(mapWork),
    ornaments: (ornamentsResult.data ?? []).map((row) => ({ id: row.id, title: row.title, imageUrl: row.image_url, workId: row.work_id, position: row.position })),
    settings: {
      name: settingsResult.data?.name ?? defaults.name,
      contact: settingsResult.data?.contact ?? "",
      vk: settingsResult.data?.vk ?? "",
      telegram: settingsResult.data?.telegram ?? "",
      phone: settingsResult.data?.phone ?? "",
      heroMode: settingsResult.data?.hero_mode === "new-year" ? "new-year" : defaults.heroMode,
      categories: (categoriesResult.data ?? []).map((c) => c.name),
      categoryRevision: categoryStateResult.data?.revision ?? defaults.categoryRevision,
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
      soldAsSet: input.soldAsSet,
      photos: input.photos.map((photo) => ({ ...photo, storage_path: storagePathFromUrl(photo.url) })),
      variants: input.variants.map((variant) => ({ ...variant,
        photos: variant.photos?.map((photo) => ({ ...photo, storage_path: storagePathFromUrl(photo.url) })),
      })),
    },
  });
  if (result.error) {
    const code = result.error.code;
    const message = code === "PGRST202"
      ? "Для сохранения нужно применить обновление базы данных. Ваши изменения остались в редакторе."
      : code === "40001"
        ? "Эту работу уже изменили на другом устройстве. Обновите каталог."
        : code === "55000"
          ? "Фотография больше недоступна. Загрузите её заново и повторите сохранение."
        : result.error.message;
    // SQLSTATE errors acknowledge a rollback. A network failure or a broken
    // response does not tell us whether the transaction committed.
    throw new WorkSaveError(message, /^[0-9A-Z]{5}$/.test(code) || code === "PGRST202");
  }
  if (!result.data) throw new WorkSaveError("Не получен результат сохранения. Повторите попытку.", false);
  const saved = mapWork(result.data as WorkRow);
  return saved;
}

export async function deleteWork(id: string, revision: number) {
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

  // Database triggers enqueue every removed reference in this same transaction,
  // including cascaded variant photos, ornaments and the legacy tree image.
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

function storagePathFromUrl(url: string) {
  return photoStoragePath(supabase, url);
}

export async function uploadPhoto(blob: Blob): Promise<{ url: string }> {
  return uploadProtectedPhoto(supabase, blob);
}

export async function renewUploadedPhoto(url: string): Promise<boolean> {
  return renewPhotoUpload(supabase, url);
}

export type CategoryDraft = { key: string; original: string | null; name: string };

export async function saveCategories(categories: CategoryDraft[], expectedRevision: number): Promise<{ names: string[]; revision: number }> {
  const names = categories.map((category) => category.name.trim());
  if (names.some((name) => !name || name.length > 80)) throw new Error("Название категории должно содержать от 1 до 80 символов.");
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) throw new Error("Названия категорий не должны повторяться.");
  const result = await supabase.rpc("save_categories", {
    expected_revision: expectedRevision,
    category_names: names,
    original_names: categories.map((category) => category.original),
  });
  if (result.error?.code === "PGRST202") {
    throw new Error("Для сохранения категорий нужно применить обновление базы данных.");
  }
  if (result.error?.code === "40001") {
    throw new Error("Список категорий уже изменили на другом устройстве. Закройте окно и обновите каталог.");
  }
  fail(result.error);
  const saved = result.data?.[0];
  if (!saved) throw new Error("Не получен новый список категорий.");
  return { names: saved.names, revision: saved.revision };
}

export async function saveSettings(input: Settings): Promise<Settings> {
  if (input.heroMode !== "standard" && input.heroMode !== "new-year") throw new Error("Выберите режим шапки сайта");
  const contacts = normalizeContacts(input);
  const names = [
    ...new Set(input.categories.map((name) => name.trim()).filter(Boolean)),
  ];
  const result = await supabase
    .from("site_settings")
    .update({ name: input.name.trim(), ...contacts, hero_mode: input.heroMode })
    .eq("id", true)
    .select("id")
    .single();
  fail(result.error);
  for (const name of names) await categoryId(name);
  return {
    name: input.name.trim(),
    ...contacts,
    heroMode: input.heroMode,
    categories: names,
    categoryRevision: input.categoryRevision,
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
    .eq("role", "admin")
    .maybeSingle();
  fail(profile.error);
  return profile.data ? result.data.session : null;
}

export async function loadDimensionSuggestions(): Promise<number[]> {
  const result = await supabase.from("dimension_suggestions").select("value_mm").order("value_mm");
  if (result.error) throw new Error("Не удалось загрузить прошлые размеры. Размер можно ввести вручную.");
  return (result.data ?? []).map((row) => Number(row.value_mm));
}

export async function deleteDimensionSuggestion(mm: number) {
  const result = await supabase.from("dimension_suggestions").delete().eq("value_mm", mm);
  if (result.error) throw new Error("Не удалось удалить размер из подсказок. Попробуйте ещё раз.");
}

export async function restoreDimensionSuggestion(mm: number) {
  const result = await supabase.from("dimension_suggestions").insert({ value_mm: mm });
  if (result.error && result.error.code !== "23505") throw new Error("Не удалось вернуть размер в подсказки. Попробуйте ещё раз.");
}

export async function getSession(): Promise<Session | null> {
  const result = await supabase.auth.getSession();
  if (result.error) throw new Error(result.error.message);
  return result.data.session;
}

export async function signIn(email: string, password: string) {
  const result = await supabase.auth.signInWithPassword({ email, password });
  fail(result.error);
  if (!result.data.session) throw new Error("Supabase не вернул сессию.");
  return result.data.session;
}

export async function signUp(email: string, password: string, nickname: string) {
  const trimmedNickname = nickname.trim();
  if (!trimmedNickname) throw new Error("Укажите никнейм.");
  if (trimmedNickname.length > 30) throw new Error("Никнейм должен быть не длиннее 30 символов.");
  const result = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nickname: trimmedNickname } },
  });
  fail(result.error);
  return result.data;
}

export async function loadFavoriteWorkIds(): Promise<Set<string>> {
  const result = await supabase.from("favorites").select("work_id");
  fail(result.error);
  return new Set((result.data ?? []).map((favorite) => favorite.work_id));
}

export async function addFavorite(workId: string) {
  const session = await getSession();
  if (!session) throw new Error("Войдите в аккаунт, чтобы сохранить работу в избранное.");
  const result = await supabase.from("favorites").insert({
    user_id: session.user.id,
    work_id: workId,
  });
  // A saved work in another tab is already in the desired state.
  if (result.error && result.error.code !== "23505") {
    throw new Error("Не удалось добавить работу в избранное. Попробуйте ещё раз.");
  }
}

export async function removeFavorite(workId: string) {
  const session = await getSession();
  if (!session) throw new Error("Войдите в аккаунт, чтобы изменить избранное.");
  const result = await supabase.from("favorites").delete()
    .eq("user_id", session.user.id).eq("work_id", workId);
  if (result.error) {
    throw new Error("Не удалось убрать работу из избранного. Попробуйте ещё раз.");
  }
}

export async function signOut() {
  const result = await supabase.auth.signOut();
  fail(result.error);
}
