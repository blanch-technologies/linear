import { describe, expect, it } from "vitest";
import {
  chordFromEvent,
  displayChords,
  findConflicts,
  parseSpec,
  SequenceMatcher,
  sequenceTimeoutMs,
  shortcuts,
  type ShortcutDefinition,
} from "./index";

const key = (k: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  key: k,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe("chords", () => {
  it("maps both ⌘ and Ctrl to mod", () => {
    expect(chordFromEvent(key("k", { meta: true }))).toBe("mod+k");
    expect(chordFromEvent(key("k", { ctrl: true }))).toBe("mod+k");
  });

  it("keeps shift for letters but not for punctuation it produced", () => {
    expect(chordFromEvent(key("C", { shift: true }))).toBe("shift+c");
    expect(chordFromEvent(key("?", { shift: true }))).toBe("?");
    expect(chordFromEvent(key("Enter", { meta: true }))).toBe("mod+enter");
    expect(chordFromEvent(key("Escape"))).toBe("escape");
    expect(chordFromEvent(key("Shift", { shift: true }))).toBeNull();
  });

  it("parses and displays specs", () => {
    expect(parseSpec("shift+mod+K")).toEqual(["mod+shift+k"]);
    expect(parseSpec("g  i")).toEqual(["g", "i"]);
    expect(() => parseSpec("hyper+k")).toThrow();
    expect(displayChords("mod+k", true)).toEqual([["⌘", "K"]]);
    expect(displayChords("mod+k", false)).toEqual([["Ctrl", "K"]]);
    expect(displayChords("g i", true)).toEqual([["G"], ["I"]]);
  });
});

describe("conflicts", () => {
  const def = (id: string, keys: string, scope: ShortcutDefinition["scope"] = "global"): ShortcutDefinition => ({
    id,
    keys,
    scope,
    description: id,
    group: "General",
  });

  it("finds duplicates and prefixes in overlapping scopes", () => {
    expect(findConflicts([def("a", "mod+k"), def("b", "mod+k")])).toEqual([{ a: "a", b: "b", reason: "duplicate" }]);
    expect(findConflicts([def("a", "g"), def("b", "g i")])).toEqual([{ a: "a", b: "b", reason: "prefix" }]);
    expect(findConflicts([def("a", "escape", "settings"), def("b", "escape", "global")])).toHaveLength(1);
    expect(findConflicts([def("a", "g i"), def("b", "g m")])).toEqual([]);
  });

  it("the app's registry has no conflicts", () => {
    expect(findConflicts(shortcuts)).toEqual([]);
  });
});

describe("sequence matching", () => {
  const all = () => true;

  it("matches single chords and two-key sequences", () => {
    const matcher = new SequenceMatcher(shortcuts);
    expect(matcher.match("mod+k", 0, all)).toEqual({ id: "command-menu" });
    expect(matcher.match("g", 10, all)).toEqual({ pending: true });
    expect(matcher.match("i", 20, all)).toEqual({ id: "go-inbox" });
  });

  it("drops a sequence after the timeout", () => {
    const matcher = new SequenceMatcher(shortcuts);
    matcher.match("g", 0, all);
    expect(matcher.match("i", sequenceTimeoutMs + 1, all)).toBeNull();
  });

  it("restarts from the current key after a dead sequence", () => {
    const matcher = new SequenceMatcher(shortcuts);
    matcher.match("g", 0, all);
    expect(matcher.match("z", 10, all)).toBeNull();
    expect(matcher.match("?", 20, all)).toEqual({ id: "help" });
    matcher.match("g", 30, all);
    expect(matcher.match("/", 40, all)).toEqual({ id: "search" });
  });

  it("only considers the candidates it's given", () => {
    const matcher = new SequenceMatcher(shortcuts);
    expect(matcher.match("escape", 0, (definition) => definition.scope === "global")).toBeNull();
    expect(matcher.match("escape", 10, all)).toEqual({ id: "back" });
  });
});
