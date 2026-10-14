import type { ShortcutDefinition } from "./registry";

/**
 * Every shortcut in the app. Add new ones here (the conflict test guards the
 * list); components attach handlers by id with `useShortcut`.
 */
export const shortcuts = [
  { id: "command-menu", keys: "mod+k", description: "Open command menu", group: "General", scope: "global", allowInInputs: true },
  { id: "help", keys: "?", description: "Show keyboard shortcuts", group: "General", scope: "global" },
  { id: "search", keys: "/", description: "Search", group: "General", scope: "global" },
  { id: "back", keys: "escape", description: "Back out of settings", group: "General", scope: "settings" },
  { id: "go-inbox", keys: "g i", description: "Go to Inbox", group: "Navigation", scope: "global" },
  { id: "go-my-issues", keys: "g m", description: "Go to My issues", group: "Navigation", scope: "global" },
  { id: "go-projects", keys: "g p", description: "Go to Projects", group: "Navigation", scope: "global" },
  { id: "go-views", keys: "g v", description: "Go to Views", group: "Navigation", scope: "global" },
  { id: "go-settings", keys: "g s", description: "Go to Settings", group: "Navigation", scope: "global" },
  { id: "go-teams", keys: "g t", description: "Go to Teams", group: "Navigation", scope: "global" },
  { id: "submit", keys: "mod+enter", description: "Submit the form", group: "Forms", scope: "global", allowInInputs: true },
] as const satisfies readonly ShortcutDefinition[];

export type ShortcutId = (typeof shortcuts)[number]["id"];
