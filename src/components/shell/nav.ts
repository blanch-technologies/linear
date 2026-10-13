import {
  Box,
  CircleUserRound,
  Ellipsis,
  Inbox,
  Layers,
  Target,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** Sidebar structure per D-37: personal items, then the Workspace group. */
export const personalNav: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/my-issues", label: "My issues", icon: CircleUserRound },
];

export const workspaceNav: NavItem[] = [
  { href: "/projects", label: "Projects", icon: Box },
  { href: "/views", label: "Views", icon: Layers },
  { href: "/initiatives", label: "Initiatives", icon: Target },
  { href: "/more", label: "More", icon: Ellipsis },
];

export function navLabel(pathname: string): string | undefined {
  if (pathname === "/search") return "Search";
  return [...personalNav, ...workspaceNav].find((item) => item.href === pathname)?.label;
}

/** Routes the sidebar links to before their phase builds them. */
export const placeholderSections = [...personalNav, ...workspaceNav, { href: "/search" }].map(
  (item) => item.href.slice(1),
);
