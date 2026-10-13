"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";

export type CurrentWorkspace = FunctionReturnType<typeof api.workspaces.current>;
export type TeamSummary = FunctionReturnType<typeof api.teams.list>[number];
export type MyWorkspaces = FunctionReturnType<typeof api.workspaces.mine>;

type WorkspaceContextValue = CurrentWorkspace & {
  urlKey: string;
  teams: TeamSummary[];
  workspaces: MyWorkspaces["workspaces"];
  /** `/acme` + segments, for links inside the workspace. */
  href: (...segments: string[]) => string;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceContextValue; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** The current workspace, the viewer's role and capabilities, and visible teams. */
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a workspace route");
  return value;
}

export function workspaceHref(urlKey: string, ...segments: string[]): string {
  return ["", urlKey, ...segments.map(encodeURIComponent)].join("/");
}

/** Full-page navigation that rescopes the session to another organization. */
export function switchWorkspaceUrl(workosOrganizationId: string, returnTo: string): string {
  const params = new URLSearchParams({ organizationId: workosOrganizationId, returnTo });
  return `/api/workspaces/switch?${params}`;
}
