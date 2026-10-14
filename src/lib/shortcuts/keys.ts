/*
 * Key specs and matching for the shortcut registry (D-35). Pure: no React or
 * DOM types beyond a KeyboardEvent-shaped object.
 *
 * A spec is one or more chords separated by spaces: "mod+k", "g i", "?",
 * "escape", "mod+enter". `mod` matches ⌘ or Ctrl, so a chord works whatever
 * the platform reports (browsers and test runners disagree); it is displayed
 * as ⌘ on macOS and Ctrl elsewhere. Letters are written lowercase;
 * punctuation is written as typed ("?" not "shift+/").
 */

export type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

const named: Record<string, string> = {
  Escape: "escape",
  Enter: "enter",
  " ": "space",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Backspace: "backspace",
  Delete: "delete",
  Tab: "tab",
};

const modifierOrder = ["mod", "alt", "shift"] as const;

/** A canonical chord for an event, or null for bare modifier presses. */
export function chordFromEvent(event: KeyEventLike): string | null {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock"].includes(event.key)) return null;
  const mods = new Set<string>();
  if (event.metaKey || event.ctrlKey) mods.add("mod");
  if (event.altKey) mods.add("alt");
  let key = named[event.key] ?? event.key;
  if (key.length === 1) {
    const lower = key.toLowerCase();
    // Shift is part of a letter chord ("shift+c"), but punctuation already
    // reflects it ("?" is shift+/ on US layouts), so it's dropped there.
    if (lower !== key.toUpperCase() && event.shiftKey) mods.add("shift");
    key = lower;
  } else if (event.shiftKey) {
    mods.add("shift");
  }
  return [...modifierOrder.filter((m) => mods.has(m)), key].join("+");
}

/** Splits and normalizes a spec into chords; throws on malformed specs. */
export function parseSpec(spec: string): string[] {
  const chords = spec.trim().split(/\s+/);
  return chords.map((chord) => {
    const parts = chord.split("+").map((part) => part.trim().toLowerCase());
    const key = parts.pop();
    if (!key) throw new Error(`Empty key in shortcut "${spec}"`);
    for (const mod of parts) {
      if (!(modifierOrder as readonly string[]).includes(mod)) throw new Error(`Unknown modifier "${mod}" in "${spec}"`);
    }
    return [...modifierOrder.filter((m) => parts.includes(m)), key].join("+");
  });
}

const macLabels: Record<string, string> = { mod: "⌘", alt: "⌥", shift: "⇧" };
const otherLabels: Record<string, string> = { mod: "Ctrl", alt: "Alt", shift: "Shift" };
const keyLabels: Record<string, string> = { escape: "Esc", enter: "Enter", space: "Space", up: "↑", down: "↓", left: "←", right: "→" };

/** Display tokens per chord, e.g. "mod+k" -> [["⌘", "K"]], "g i" -> [["G"], ["I"]]. */
export function displayChords(spec: string, isMac: boolean): string[][] {
  return parseSpec(spec).map((chord) =>
    chord.split("+").map((part) => {
      const labels = isMac ? macLabels : otherLabels;
      return labels[part] ?? keyLabels[part] ?? part.toUpperCase();
    }),
  );
}
