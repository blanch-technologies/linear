import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./safe-redirect";

describe("safeReturnPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeReturnPath("/acme/settings?tab=1#x")).toBe("/acme/settings?tab=1#x");
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of [null, "", "acme", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)"]) {
      expect(safeReturnPath(bad, "/home")).toBe("/home");
    }
  });
});
