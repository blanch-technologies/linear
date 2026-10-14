"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export type WorkflowState = FunctionReturnType<typeof api.workflowStates.list>["states"][number];
export type Person = FunctionReturnType<typeof api.teams.assignable>[number];
export type Label = FunctionReturnType<typeof api.labels.list>[number];
export type IssueRow = FunctionReturnType<typeof api.issues.listForTeam>["page"][number];

/** A team's workflow states in display order; undefined while loading. */
export function useTeamStates(teamId: Id<"teams"> | null | undefined) {
  return useQuery(api.workflowStates.list, teamId ? { teamId } : "skip")?.states;
}

export function useAssignable(teamId: Id<"teams"> | null | undefined) {
  return useQuery(api.teams.assignable, teamId ? { teamId } : "skip");
}

export function useTeamLabels(teamId: Id<"teams"> | null | undefined) {
  return useQuery(api.labels.list, teamId ? { teamId } : "skip");
}
