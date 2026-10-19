import { test } from "node:test";
import assert from "node:assert/strict";
import { changeSizeUnit, measurementsFromDraft, parseSize, resolveMeasurements, sizeDraft, sizeSummary } from "../lib/measurements.ts";

test("commas, dots and conversion preserve physical dimensions and optional axes", () => {
  const draft = { height: "8,75", width: "2.5", depth: "", unit: "cm" as const };
  assert.deepEqual(measurementsFromDraft(draft), { heightMm: 87.5, widthMm: 25, depthMm: null, unit: "cm" });
  const mm = changeSizeUnit(draft, "mm");
  assert.deepEqual(mm, { height: "87,5", width: "25", depth: "", unit: "mm" });
  assert.deepEqual(changeSizeUnit(mm, "cm"), { ...draft, width: "2,5" });
  assert.equal(parseSize("0,0001", "cm"), 0.001);
  assert.equal(measurementsFromDraft(sizeDraft(null)), null);
});

test("invalid, nonpositive and overly precise input cannot be saved or silently converted", () => {
  for (const value of ["-1", "0", "1cm", "NaN", "Infinity", "1e3", "1,2.3", "1000001", "0.00001"]) {
    assert.throws(() => parseSize(value, "mm"), value);
  }
  assert.throws(() => changeSizeUnit({ height: "abc", width: "", depth: "", unit: "cm" }, "mm"));
});

test("variant overrides inherit each omitted axis and use the variant's display unit", () => {
  const common = { heightMm: 80, widthMm: 55, depthMm: 20, unit: "cm" as const };
  const own = { heightMm: 100, widthMm: null, depthMm: null, unit: "mm" as const };
  const resolved = resolveMeasurements(own, common);
  assert.deepEqual(resolved, { ...common, heightMm: 100, unit: "mm" });
  assert.equal(sizeSummary(resolved), "высота 100 мм · ширина 55 мм · глубина 20 мм");
  assert.deepEqual(resolveMeasurements(null, common), common);
  assert.equal(resolveMeasurements(null, null), null);
});
