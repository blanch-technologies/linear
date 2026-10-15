const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["week", 7 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
];

const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago". */
export function timeAgo(at: number, now = Date.now()): string {
  const elapsed = now - at;
  if (elapsed < 45_000) return "just now";
  for (const [unit, ms] of units) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return format.format(-1, "minute");
}

/** Full date and time, for tooltips. */
export function fullDate(at: number): string {
  return new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
