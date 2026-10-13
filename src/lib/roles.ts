import type { WorkspaceRole } from "@/lib/permissions";

export const roleLabels: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

export const roleDescriptions: Record<WorkspaceRole, string> = {
  owner: "Full control, including other owners.",
  admin: "Manages members, teams, and workspace settings.",
  member: "Works in public teams and the teams they join.",
  guest: "Sees only the teams they're added to.",
};
