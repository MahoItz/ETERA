import type { Work } from "../lib/model";

export function isHeroEligible(work: Work) {
  return work.status === "published" && work.availability !== "sold" && Boolean(work.photos[0]?.url);
}

export function heroItems(works: Work[], selectedIds?: string[] | null) {
  if (selectedIds != null) {
    const available = new Map(works.filter(isHeroEligible).map((work) => [work.id, work]));
    return [...new Set(selectedIds)].flatMap((id) => {
      const work = available.get(id);
      return work ? [work] : [];
    }).slice(0, 10);
  }
  return works.filter(isHeroEligible)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
}

export function carouselOffset(index: number, active: number, count: number) {
  if (count < 2) return 0;
  const offset = ((index - active) % count + count) % count;
  return offset > count / 2 ? offset - count : offset;
}
