"use client";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useIsMac } from "@/hooks/use-is-mac";
import { displayChords, shortcuts, type ShortcutId } from "@/lib/shortcuts";

/** Renders a shortcut's keys, e.g. ⌘ K or G then I. */
export function ShortcutKeys({ id, keys }: { id?: ShortcutId; keys?: string }) {
  const isMac = useIsMac();
  const spec = keys ?? shortcuts.find((shortcut) => shortcut.id === id)?.keys;
  if (!spec) return null;
  const chords = displayChords(spec, isMac);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-strong">
      {chords.map((chord, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 && <span>then</span>}
          <KbdGroup>
            {chord.map((part) => (
              <Kbd key={part}>{part}</Kbd>
            ))}
          </KbdGroup>
        </span>
      ))}
    </span>
  );
}
