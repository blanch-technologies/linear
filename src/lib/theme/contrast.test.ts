import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function tokens(selector: string): Record<string, string> {
  const block = css.match(new RegExp(`^${selector.replace(".", "\\.")} \\{([^}]*)\\}`, "m"));
  if (!block) throw new Error(`No ${selector} block in globals.css`);
  return Object.fromEntries(
    [...block[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, value]) => [name, value]),
  );
}

// D-34: text must meet WCAG AA (4.5:1) in both themes. --text-faint is for
// icons and decoration only, so it is not checked.
const textPairs: [fg: string, bg: string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["text", "surface-3"],
  ["text", "sidebar-bg"],
  ["text-muted", "bg"],
  ["text-muted", "surface"],
  ["text-muted", "sidebar-bg"],
  // Raised surfaces (keys, selected rows, chips) need the stronger secondary text.
  ["text-muted-strong", "surface-2"],
  ["text-muted-strong", "surface-3"],
  ["brand-fg", "brand-solid"],
  ["brand", "bg"],
];

describe.each([":root", ".dark"])("%s tokens", (selector) => {
  const t = tokens(selector);
  it.each(textPairs)("%s on %s meets AA", (fg, bg) => {
    expect(t[fg], `--${fg}`).toBeDefined();
    expect(t[bg], `--${bg}`).toBeDefined();
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

it("keeps the prototype's dark palette (D-33)", () => {
  expect(tokens(".dark")).toMatchObject({
    bg: "#0f1012",
    "sidebar-bg": "#151619",
    surface: "#191a1e",
    "surface-2": "#202126",
    "surface-3": "#28292f",
    line: "#2a2b31",
    text: "#e4e5e8",
    "text-muted": "#83858e",
    "text-faint": "#5d5f68",
    brand: "#8e7cf8",
    "brand-hover": "#7465da",
  });
});
