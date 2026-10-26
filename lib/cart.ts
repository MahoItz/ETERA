import type { Work } from "./model";

export const MAX_CART_ITEMS = 50;
export type SelectionItem = {
  work_id: string; variant_id: string | null; work_slug: string | null; variant_slug: string | null;
  title: string; variant_name: string | null; image_url: string | null; price: number | null; sold_as_set: boolean;
};
export type CartItem = { id: string; user_id: string; created_at: string; snapshot: SelectionItem; current?: SelectionItem | null; available?: boolean };

export function cartVariantId(work: Work, variantId: string | null): string | null {
  return work.soldAsSet ? null : variantId;
}

export function cartItemState(item: CartItem, works: Work[]): { available: boolean; selection: SelectionItem } {
  if (item.available !== undefined) return { available: item.available, selection: item.current ?? item.snapshot };
  const work = works.find(work => work.id === item.snapshot.work_id);
  const variant = work?.variants.find(variant => variant.id === item.snapshot.variant_id);
  const available = Boolean(work && work.status === "published" && work.availability !== "sold" &&
    (item.snapshot.variant_id ? variant && variant.availability !== "sold" && !work.soldAsSet
      : work.soldAsSet || !work.variants.length));
  if (!available || !work) return { available: false, selection: item.snapshot };
  return { available: true, selection: {
    work_id: work.id, variant_id: variant?.id ?? null, work_slug: work.slug ?? null, variant_slug: variant?.slug ?? null,
    title: work.title, variant_name: variant?.name ?? null, sold_as_set: Boolean(work.soldAsSet),
    image_url: variant?.photos?.[0]?.url ?? variant?.imageUrl ?? work.photos[0]?.url ?? null,
    price: variant ? variant.price : work.price,
  } };
}

export function selectionPath(item: SelectionItem, base = "/"): string {
  const params = new URLSearchParams({ work: item.work_slug || item.work_id });
  if (item.variant_id) params.set("variant", item.variant_slug || item.variant_id);
  return `${base}?${params.toString()}`;
}
