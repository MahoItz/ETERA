import { test } from "node:test";
import assert from "node:assert/strict";
import { treeItems, type TreeOrnament } from "../src/tree-items.ts";
import { seed } from "../lib/model.ts";

const ornament = (id: string, workId = seed[0].id, position = 0): TreeOrnament => ({
  id, workId, position, title: id, imageUrl: `/images/${id}.webp`,
});

test("Separate ornaments can open the same catalogue work", () => {
  const items = treeItems(seed, [ornament("snow-maiden"), ornament("father-frost")]);
  assert.equal(items.length, 2);
  assert.notEqual(items[0].id, items[1].id);
  assert.notEqual(items[0].imageUrl, items[1].imageUrl);
  assert.equal(items[0].work.id, seed[0].id);
  assert.equal(items[1].work.id, seed[0].id);
});

test("Ornaments linked to draft, sold, archived or missing works stay hidden", () => {
  const works = [seed[0], { ...seed[1], status: "draft" as const },
    { ...seed[0], id: "sold", availability: "sold" as const },
    { ...seed[0], id: "archived", status: "archived" as const }];
  assert.deepEqual(treeItems(works, [ornament("visible"), ornament("draft", seed[1].id), ornament("sold", "sold"), ornament("archived", "archived"), ornament("missing", "missing")]).map((i) => i.id), ["visible"]);
});

test("The tree shows at most eight available ornaments in configured order", () => {
  const ornaments = Array.from({ length: 12 }, (_, i) => ornament(`toy-${i}`, seed[0].id, 11 - i));
  const items = treeItems(seed, ornaments);
  assert.equal(items.length, 8);
  assert.deepEqual(items.map((i) => i.position), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(ornaments[0].position, 11);
});
