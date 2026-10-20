import type { Work } from "../lib/model";

export function heroItems(works: Work[]) {
  return works.filter((work) => work.status === "published" && work.availability !== "sold" && work.photos[0]?.url)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
}

export function carouselOffset(index: number, active: number, count: number) {
  if (count < 2) return 0;
  const offset = ((index - active) % count + count) % count;
  return offset > count / 2 ? offset - count : offset;
}
