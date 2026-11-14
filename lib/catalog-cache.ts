import type { Work } from "./model";

export function mergeCatalogWorks(current: Work[], incoming: Work[]): Work[] {
  const byId = new Map(current.map(work => [work.id, work]));
  for (const work of incoming) {
    const previous = byId.get(work.id);
    // A page refresh must not discard a gallery already fetched at the same revision.
    if (work.detailsLoaded === false && previous && previous.detailsLoaded !== false && previous.revision === work.revision) continue;
    byId.set(work.id, work);
  }
  return [...byId.values()];
}
