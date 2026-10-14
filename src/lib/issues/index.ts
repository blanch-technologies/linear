/** Issue properties shared by Convex and the UI (D-28, estimates, ordering, dates). */

export const priorities = [
  { value: 0, label: "No priority", key: "none" },
  { value: 1, label: "Urgent", key: "urgent" },
  { value: 2, label: "High", key: "high" },
  { value: 3, label: "Medium", key: "medium" },
  { value: 4, label: "Low", key: "low" },
] as const;
export type Priority = 0 | 1 | 2 | 3 | 4;

export function isPriority(value: number): value is Priority {
  return Number.isInteger(value) && value >= 0 && value <= 4;
}

export function priorityLabel(value: number): string {
  return priorities.find((p) => p.value === value)?.label ?? "No priority";
}

/** Sort rank: urgent first, no priority last. */
export function priorityRank(value: number): number {
  return value === 0 ? 5 : value;
}

export const estimateScales = {
  linear: { label: "Linear", values: [1, 2, 3, 4, 5], format: (v: number) => String(v) },
  exponential: { label: "Exponential", values: [1, 2, 4, 8, 16], format: (v: number) => String(v) },
  fibonacci: { label: "Fibonacci", values: [1, 2, 3, 5, 8], format: (v: number) => String(v) },
  tshirt: {
    label: "T-shirt",
    values: [1, 2, 3, 5, 8],
    format: (v: number) => ({ 1: "XS", 2: "S", 3: "M", 5: "L", 8: "XL" })[v] ?? String(v),
  },
} as const;
export type EstimateScale = keyof typeof estimateScales;

export function isValidEstimate(scale: EstimateScale | undefined, value: number): boolean {
  return scale !== undefined && (estimateScales[scale].values as readonly number[]).includes(value);
}

/** YYYY-MM-DD that is a real calendar date. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * A sort key strictly between two neighbors (fractional indexing on numbers).
 * Lists are ordered ascending; `null` means "no neighbor on that side".
 */
export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return after! - 1000;
  if (after === null) return before + 1000;
  if (!(before < after)) throw new Error("orderBetween: neighbors out of order");
  return before + (after - before) / 2;
}

export const titleMaxLength = 256;

/** Git branch name for an issue, as Linear offers ("eng-12-fix-the-sidebar"). */
export function branchName(identifier: string, title: string, username?: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const base = `${identifier.toLowerCase()}${slug ? `-${slug}` : ""}`;
  return username ? `${username}/${base}` : base;
}
