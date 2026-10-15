"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The shell header's content area, for pages that need more than a title (the issue page). */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

/** Renders its children into the shell header, replacing the route title. */
export function ShellHeader({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  return slot ? createPortal(children, slot) : null;
}
