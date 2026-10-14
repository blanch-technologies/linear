"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** The page's host, empty during server render so hydration matches. */
export function useHost(): string {
  return useSyncExternalStore(noop, () => window.location.host, () => "");
}
