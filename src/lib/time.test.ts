import { describe, expect, it } from "vitest";
import { timeAgo } from "./time";

describe("timeAgo", () => {
  const now = Date.UTC(2026, 9, 15, 12);
  it("rounds down to the largest unit", () => {
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 50_000, now)).toBe("1 minute ago");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(timeAgo(now - 3 * 3600_000, now)).toBe("3 hours ago");
    expect(timeAgo(now - 30 * 3600_000, now)).toBe("yesterday");
    expect(timeAgo(now - 15 * 24 * 3600_000, now)).toBe("2 weeks ago");
  });
});
