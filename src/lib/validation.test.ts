import { describe, expect, it } from "vitest";
import { suggestTeamKey, suggestUrlKey, validateEmail, validateName, validateTeamKey, validateUrlKey } from "./validation";

describe("validation", () => {
  it("normalizes and bounds names", () => {
    expect(validateName("  Acme   Labs ")).toEqual({ ok: true, value: "Acme Labs" });
    expect(validateName("   ").ok).toBe(false);
    expect(validateName("x".repeat(65)).ok).toBe(false);
  });

  it("accepts URL keys that are safe path segments and not reserved", () => {
    expect(validateUrlKey("Acme-Labs")).toEqual({ ok: true, value: "acme-labs" });
    for (const bad of ["ab", "-acme", "acme-", "ac--me", "acme_labs", "settings", "api", "x".repeat(33)]) {
      expect(validateUrlKey(bad).ok, bad).toBe(false);
    }
  });

  it("accepts team keys of 1 to 7 alphanumerics starting with a letter", () => {
    expect(validateTeamKey("eng")).toEqual({ ok: true, value: "ENG" });
    expect(validateTeamKey("A1").ok).toBe(true);
    for (const bad of ["", "1AB", "ENG-1", "ABCDEFGH"]) expect(validateTeamKey(bad).ok, bad).toBe(false);
  });

  it("validates emails", () => {
    expect(validateEmail(" A@B.co ")).toEqual({ ok: true, value: "a@b.co" });
    expect(validateEmail("nope").ok).toBe(false);
  });

  it("suggests keys", () => {
    expect(suggestUrlKey("Café Ünïcode Labs!")).toBe("cafe-unicode-labs");
    expect(suggestTeamKey("Platform Engineering")).toBe("PE");
    expect(suggestTeamKey("Design")).toBe("DES");
    expect(suggestTeamKey("42")).toBe("TEAM");
    expect(validateTeamKey(suggestTeamKey("Acme Labs")).ok).toBe(true);
  });
});
