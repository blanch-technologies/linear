"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { chordFromEvent, SequenceMatcher, shortcuts, type ShortcutId } from "@/lib/shortcuts";

type Handler = () => void;

type Registry = { register: (id: ShortcutId, handler: Handler) => () => void };

const ShortcutContext = createContext<Registry | null>(null);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** A dialog, menu, or popover is open: page-level shortcuts stand down. */
function overlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]');
}

/**
 * One keydown listener for the app (D-35). It turns key presses into chords,
 * matches them against the registry, and calls the most recently registered
 * handler for the matched id. ⌘Enter submits the focused form.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Map<ShortcutId, Handler[]>());
  const matcher = useMemo(() => new SequenceMatcher(shortcuts), []);
  const pathname = usePathname();
  const inSettings = /\/settings(\/|$)/.test(pathname);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const chord = chordFromEvent(event);
      if (!chord) return;
      const typing = isEditable(event.target);
      const overlay = overlayOpen();
      const result = matcher.match(chord, event.timeStamp, (definition) => {
        if (definition.scope === "settings" && !inSettings) return false;
        if ("allowInInputs" in definition && definition.allowInInputs) return true;
        return !typing && !overlay;
      });
      if (!result) return;
      if ("pending" in result) {
        event.preventDefault();
        return;
      }
      const id = result.id as ShortcutId;
      if (id === "submit") {
        const form = event.target instanceof HTMLElement ? event.target.closest("form") : null;
        if (!form) return;
        event.preventDefault();
        form.requestSubmit();
        return;
      }
      const handler = handlers.current.get(id)?.at(-1);
      if (!handler) return;
      event.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [matcher, inSettings]);

  const registry = useMemo<Registry>(
    () => ({
      register(id, handler) {
        const list = handlers.current.get(id) ?? [];
        list.push(handler);
        handlers.current.set(id, list);
        return () => {
          const current = handlers.current.get(id) ?? [];
          handlers.current.set(
            id,
            current.filter((entry) => entry !== handler),
          );
        };
      },
    }),
    [],
  );

  return <ShortcutContext.Provider value={registry}>{children}</ShortcutContext.Provider>;
}

/** Attaches `handler` to a registered shortcut while the component is mounted. */
export function useShortcut(id: ShortcutId, handler: Handler, enabled = true) {
  const registry = useContext(ShortcutContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!registry || !enabled) return;
    return registry.register(id, () => latest.current());
  }, [registry, id, enabled]);
}
