import { parseSpec } from "./keys";

/*
 * The single shortcut registry (D-35). Every shortcut is defined once with an
 * id, its keys, and where it applies; the help overlay and the command menu
 * read the same list, and `findConflicts` keeps it unambiguous.
 */

export type ShortcutScope = "global" | "settings";

export type ShortcutDefinition = {
  id: string;
  keys: string;
  description: string;
  group: "General" | "Navigation" | "Lists" | "Issue" | "Forms";
  /** Where the shortcut is live. Global shortcuts apply everywhere. */
  scope: ShortcutScope;
  /** Fires even while typing in a field (for ⌘K, Esc, ⌘Enter). */
  allowInInputs?: boolean;
};

export type Conflict = { a: string; b: string; reason: "duplicate" | "prefix" };

function overlaps(a: ShortcutScope, b: ShortcutScope) {
  return a === b || a === "global" || b === "global";
}

/**
 * Two shortcuts conflict when they are live in the same place and either have
 * identical keys or one is a prefix of the other ("g" would swallow "g i").
 */
export function findConflicts(definitions: readonly ShortcutDefinition[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const parsed = definitions.map((definition) => ({ definition, chords: parseSpec(definition.keys) }));
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const x = parsed[i]!;
      const y = parsed[j]!;
      if (!overlaps(x.definition.scope, y.definition.scope)) continue;
      const shorter = x.chords.length <= y.chords.length ? x.chords : y.chords;
      const longer = shorter === x.chords ? y.chords : x.chords;
      if (!shorter.every((chord, index) => longer[index] === chord)) continue;
      conflicts.push({
        a: x.definition.id,
        b: y.definition.id,
        reason: shorter.length === longer.length ? "duplicate" : "prefix",
      });
    }
  }
  return conflicts;
}

/** How long the next key of a sequence ("g" then "i") may take. */
export const sequenceTimeoutMs = 1200;

type MatchResult = { id: string } | { pending: true } | null;

/**
 * Feeds chords and reports a completed shortcut, a sequence in progress, or
 * nothing. Only the shortcuts passed to `match` are candidates, so scope and
 * focus filtering happen before matching.
 */
export class SequenceMatcher {
  private buffer: string[] = [];
  private lastAt = 0;

  constructor(private readonly definitions: readonly ShortcutDefinition[]) {}

  match(chord: string, now: number, candidates: (definition: ShortcutDefinition) => boolean): MatchResult {
    if (now - this.lastAt > sequenceTimeoutMs) this.buffer = [];
    this.lastAt = now;
    const attempt = (buffer: string[]): MatchResult => {
      let pending = false;
      for (const definition of this.definitions) {
        if (!candidates(definition)) continue;
        const chords = parseSpec(definition.keys);
        if (chords.length < buffer.length || !buffer.every((c, index) => chords[index] === c)) continue;
        if (chords.length === buffer.length) return { id: definition.id };
        pending = true;
      }
      return pending ? { pending: true } : null;
    };
    this.buffer.push(chord);
    let result = attempt(this.buffer);
    // A dead sequence restarts from this key, so "g x i" doesn't swallow "i".
    if (!result && this.buffer.length > 1) {
      this.buffer = [chord];
      result = attempt(this.buffer);
    }
    if (!result || "id" in result) this.buffer = [];
    return result;
  }

  reset() {
    this.buffer = [];
  }
}
