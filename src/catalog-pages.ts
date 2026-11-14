import type { Work } from "../lib/model";
import { supabase } from "./supabase";

export const CATALOG_PAGE_SIZE = 24;
export type CatalogFilters = { query?: string; category?: string; sort?: string; scope?: string };
export type CatalogPage = { works: Work[]; total: number };
const fields = "id,slug,title,material,dimensions,measurements,sold_as_set,price,availability,status,featured,revision,updated_at,category_name,cover_url,cover_alt,photo_count,variant_count,catalog_price";

function mapCard(row: Record<string, unknown>): Work {
  return {
    id: row.id as string, slug: row.slug as string, title: row.title as string,
    description: "", material: row.material as string, dimensions: row.dimensions as string,
    measurements: row.measurements as Work["measurements"], category: row.category_name as string,
    soldAsSet: Boolean(row.sold_as_set), price: row.price == null ? null : Number(row.price),
    availability: row.availability as Work["availability"], status: row.status as Work["status"],
    featured: Boolean(row.featured), revision: Number(row.revision), updatedAt: row.updated_at as string,
    photos: row.cover_url ? [{ url: row.cover_url as string, alt: (row.cover_alt as string) || "" }] : [],
    variants: [], detailsLoaded: false, variantCount: Number(row.variant_count), photoCount: Number(row.photo_count),
    catalogPrice: row.catalog_price == null ? null : Number(row.catalog_price),
  };
}

function cardQuery(filters: CatalogFilters, count = false) {
  let request = supabase.from("catalog_cards").select(fields, count ? { count: "exact" } : {});
  const scope = filters.scope ?? "published";
  if (scope === "published") request = request.eq("status", "published").neq("availability", "sold");
  else if (scope === "draft") request = request.eq("status", "draft");
  else if (scope === "archived") request = request.or("status.eq.archived,availability.eq.sold");
  else if (scope !== "all") throw new Error("Неизвестный фильтр каталога.");
  if (filters.category) request = request.eq("category_name", filters.category);
  const search = filters.query?.trim();
  if (search) request = request.ilike("search_text", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  if (filters.sort === "name") request = request.order("title");
  else if (filters.sort === "price") request = request.order("catalog_price", { ascending: true, nullsFirst: false });
  else if (filters.sort === "popular") request = request.order("favorite_count", { ascending: false });
  return request.order("featured", { ascending: false }).order("updated_at", { ascending: false }).order("id");
}

export async function loadCatalogPage(filters: CatalogFilters = {}, offset = 0, size = CATALOG_PAGE_SIZE, signal?: AbortSignal): Promise<CatalogPage> {
  let request = cardQuery(filters, true).range(offset, offset + Math.min(100, size) - 1);
  if (signal) request = request.abortSignal(signal);
  const result = await request;
  if (result.error) throw new Error("Не удалось загрузить работы. Проверьте соединение и попробуйте снова.");
  return { works: (result.data ?? []).map(mapCard), total: result.count ?? 0 };
}

export async function loadCatalogCardsByIds(ids: string[], admin = false, signal?: AbortSignal): Promise<Work[]> {
  const unique = [...new Set(ids)];
  const works: Work[] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    let request = cardQuery({ scope: admin ? "all" : "published" }).in("id", unique.slice(offset, offset + 100)).range(0, 99);
    if (signal) request = request.abortSignal(signal);
    const result = await request;
    if (result.error) throw new Error("Не удалось загрузить работы. Попробуйте снова.");
    works.push(...(result.data ?? []).map(mapCard));
  }
  return works;
}

export async function loadHeroCards(ids: string[] | null, signal?: AbortSignal): Promise<Work[]> {
  if (ids !== null) return loadCatalogCardsByIds(ids.slice(0, 10), false, signal);
  let request = cardQuery({}).not("cover_url", "is", null).range(0, 9);
  if (signal) request = request.abortSignal(signal);
  const result = await request;
  if (result.error) throw new Error("Не удалось загрузить работы для шапки.");
  return (result.data ?? []).map(mapCard);
}

// Called only when an administrator opens a catalogue-wide selector.
export async function loadEditorCards(signal: AbortSignal): Promise<Work[]> {
  const works: Work[] = [];
  let page: CatalogPage;
  do {
    page = await loadCatalogPage({ scope: "all" }, works.length, 100, signal);
    works.push(...page.works);
  } while (page.works.length && works.length < page.total);
  return works;
}
