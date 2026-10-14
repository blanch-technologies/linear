"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { CommandMenu } from "./command-menu";
import { HelpOverlay } from "./help-overlay";
import { useShortcut } from "./shortcuts-provider";

type CommandUI = { openCommandMenu: () => void; openHelp: () => void };

const CommandUIContext = createContext<CommandUI>({ openCommandMenu: () => {}, openHelp: () => {} });

/** Opens the command menu or the shortcut reference from buttons and menus. */
export function useCommandUI(): CommandUI {
  return useContext(CommandUIContext);
}

/** Workspace-wide shortcuts, the command menu, and the help overlay. */
export function GlobalShortcuts({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { href, viewer } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useShortcut("command-menu", () => setMenuOpen((open) => !open));
  useShortcut("help", () => setHelpOpen(true));
  useShortcut("search", () => router.push(href("search")));
  useShortcut("back", () => router.push(href()));
  useShortcut("go-inbox", () => router.push(href("inbox")));
  useShortcut("go-my-issues", () => router.push(href("my-issues")));
  useShortcut("go-projects", () => router.push(href("projects")));
  useShortcut("go-views", () => router.push(href("views")), viewer.role !== "guest");
  useShortcut("go-settings", () => router.push(href("settings")));
  useShortcut("go-teams", () => router.push(href("settings", "teams")));

  const ui = useMemo<CommandUI>(
    () => ({ openCommandMenu: () => setMenuOpen(true), openHelp: () => setHelpOpen(true) }),
    [],
  );

  return (
    <CommandUIContext.Provider value={ui}>
      {children}
      <CommandMenu open={menuOpen} onOpenChange={setMenuOpen} onShowShortcuts={() => setHelpOpen(true)} />
      <HelpOverlay open={helpOpen} onOpenChange={setHelpOpen} />
    </CommandUIContext.Provider>
  );
}
