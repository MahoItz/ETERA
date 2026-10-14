import type { Work } from "../lib/model";

export type TreeOrnament = {
  id: string;
  title: string;
  imageUrl: string;
  workId: string;
  position: number;
};

export function treeItems(works: Work[], ornaments: TreeOrnament[]) {
  const visible = works.filter((w) => w.status === "published" && w.availability !== "sold");
  const byId = new Map(visible.map((work) => [work.id, work]));
  return [...ornaments].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .flatMap((ornament) => {
      const work = byId.get(ornament.workId);
      return work ? [{ ...ornament, work }] : [];
    }).slice(0, 8);
}
