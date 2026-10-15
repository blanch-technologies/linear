import type { ShortcutDefinition } from "./registry";

/**
 * Every shortcut in the app. Add new ones here (the conflict test guards the
 * list); components attach handlers by id with `useShortcut`.
 */
export const shortcuts = [
  { id: "create-issue", keys: "c", description: "Create issue", group: "General", scope: "global" },
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
  { id: "list-down", keys: "j", description: "Next issue", group: "Lists", scope: "global" },
  { id: "list-up", keys: "k", description: "Previous issue", group: "Lists", scope: "global" },
  { id: "open-issue", keys: "enter", description: "Open the focused issue", group: "Lists", scope: "global" },
  { id: "select", keys: "x", description: "Select the focused issue", group: "Lists", scope: "global" },
  { id: "select-down", keys: "shift+j", description: "Extend selection down", group: "Lists", scope: "global" },
  { id: "select-up", keys: "shift+k", description: "Extend selection up", group: "Lists", scope: "global" },
  { id: "set-status", keys: "s", description: "Change status", group: "Lists", scope: "global" },
  { id: "set-priority", keys: "p", description: "Set priority", group: "Lists", scope: "global" },
  { id: "assign", keys: "a", description: "Assign", group: "Lists", scope: "global" },
  { id: "set-labels", keys: "l", description: "Change labels", group: "Lists", scope: "global" },
  { id: "toggle-layout", keys: "mod+b", description: "Switch between list and board", group: "Lists", scope: "global" },
  { id: "submit", keys: "mod+enter", description: "Submit the form", group: "Forms", scope: "global", allowInInputs: true },
] as const satisfies readonly ShortcutDefinition[];

export type ShortcutId = (typeof shortcuts)[number]["id"];
