import {
  Box,
  CircleUserRound,
  Ellipsis,
  Inbox,
  Layers,
  Search,
  SquareStack,
  Target,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { segment: string; label: string; icon: LucideIcon; hiddenForGuests?: boolean };

/** Sidebar structure per D-37: personal items, then the Workspace group, then teams. */
export const personalNav: NavItem[] = [
  { segment: "inbox", label: "Inbox", icon: Inbox },
  { segment: "my-issues", label: "My issues", icon: CircleUserRound },
];

export const workspaceNav: NavItem[] = [
  { segment: "projects", label: "Projects", icon: Box },
  { segment: "views", label: "Views", icon: Layers, hiddenForGuests: true },
  // D-18: no initiatives for guests.
  { segment: "initiatives", label: "Initiatives", icon: Target, hiddenForGuests: true },
  { segment: "more", label: "More", icon: Ellipsis, hiddenForGuests: true },
];

export const teamNav: NavItem[] = [
  { segment: "issues", label: "Issues", icon: SquareStack },
  { segment: "projects", label: "Projects", icon: Box },
  { segment: "views", label: "Views", icon: Layers },
];

/** Workspace-level pages that later phases build; they render a placeholder until then. */
export const placeholderSections: Record<string, { label: string; icon: LucideIcon }> = Object.fromEntries(
  [...personalNav, ...workspaceNav, { segment: "search", label: "Search", icon: Search }].map((item) => [
    item.segment,
    { label: item.label, icon: item.icon },
  ]),
);
