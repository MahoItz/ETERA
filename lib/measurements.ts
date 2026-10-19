export type SizeUnit = "mm" | "cm";
export type Measurements = {
  heightMm: number | null;
  widthMm: number | null;
  depthMm: number | null;
  unit: SizeUnit;
};
export type SizeDraft = { height: string; width: string; depth: string; unit: SizeUnit };
export const sizeAxes = [
  { key: "height", field: "heightMm", label: "Высота" },
  { key: "width", field: "widthMm", label: "Ширина" },
  { key: "depth", field: "depthMm", label: "Глубина" },
] as const;
export const unitLabel = (unit: SizeUnit) => unit === "cm" ? "см" : "мм";
export const sizeNumber = (value: number) => new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 4, useGrouping: false,
}).format(value);
export const displaySize = (mm: number, unit: SizeUnit) => sizeNumber(mm / (unit === "cm" ? 10 : 1));

export function sizeDraft(value?: Measurements | null): SizeDraft {
  const unit = value?.unit ?? "cm";
  return { unit, ...Object.fromEntries(sizeAxes.map(({ key, field }) => [
    key, value?.[field] == null ? "" : displaySize(value[field], unit),
  ])) } as SizeDraft;
}

export function parseSize(value: string, unit: SizeUnit): number | null {
  if (!value.trim()) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new Error("Введите положительное число, например 8 или 5,5.");
  }
  const mm = Number(normalized) * (unit === "cm" ? 10 : 1);
  if (!Number.isFinite(mm) || mm <= 0 || mm > 1000000) {
    throw new Error("Размер должен быть больше нуля и не больше 1 000 000 мм.");
  }
  if (Math.abs(mm * 1000 - Math.round(mm * 1000)) > 0.00001) {
    throw new Error("Укажите размер с точностью до 0,001 мм.");
  }
  return Math.round(mm * 1000) / 1000;
}

export function measurementsFromDraft(value: SizeDraft): Measurements | null {
  const fields = Object.fromEntries(sizeAxes.map(({ key, field, label }) => {
    try { return [field, parseSize(value[key], value.unit)]; }
    catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : "проверьте размер"}`); }
  })) as Omit<Measurements, "unit">;
  return Object.values(fields).every((number) => number === null) ? null : { ...fields, unit: value.unit };
}

export function changeSizeUnit(value: SizeDraft, unit: SizeUnit): SizeDraft {
  if (unit === value.unit) return value;
  const measurements = measurementsFromDraft(value);
  return measurements ? sizeDraft({ ...measurements, unit }) : { ...value, unit };
}

export function resolveMeasurements(own?: Measurements | null, fallback?: Measurements | null): Measurements | null {
  if (!own) return fallback ?? null;
  return {
    heightMm: own.heightMm ?? fallback?.heightMm ?? null,
    widthMm: own.widthMm ?? fallback?.widthMm ?? null,
    depthMm: own.depthMm ?? fallback?.depthMm ?? null,
    unit: own.unit,
  };
}

export function sizeSummary(value?: Measurements | null): string {
  if (!value) return "";
  return sizeAxes.filter(({ field }) => value[field] !== null)
    .map(({ field, label }) => `${label.toLowerCase()} ${displaySize(value[field]!, value.unit)} ${unitLabel(value.unit)}`)
    .join(" · ");
}
