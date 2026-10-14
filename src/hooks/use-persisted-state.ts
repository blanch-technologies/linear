"use client";

import { useCallback, useSyncExternalStore } from "react";

/*
 * Per-viewer UI preferences (collapsed sidebar groups and the like) in
 * localStorage. Storage can be missing or throw (private windows, blocked site
 * data), so every access is guarded and the default is used instead.
 */

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A remembered on/off flag, such as whether a sidebar group is collapsed. */
export function usePersistedFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = raw === null ? initial : raw === "true";
  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Not persisted; the in-memory default still applies.
      }
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [value, set];
}
