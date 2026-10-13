"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

export function detectMac(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Whether to show ⌘ (macOS) or Ctrl. False during server render. */
export function useIsMac(): boolean {
  return useSyncExternalStore(noop, detectMac, () => false);
}
