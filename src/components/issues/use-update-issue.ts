"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";

/*
 * Optimistic issue updates (D-36). The change is applied at once to every
 * loaded copy of the issue: team lists, My issues, workspace views, and the
 * issue page. Convex drops the optimistic copy when the server answers; on an
 * error it rolls back and we show the server's message.
 */

export type IssueFieldsPatch = {
  title?: string;
  description?: string | null;
  stateId?: Id<"workflowStates">;
  priority?: number;
  assigneeId?: Id<"users"> | null;
  labelIds?: Id<"labels">[];
  estimate?: number | null;
  dueDate?: string | null;
  parentId?: Id<"issues"> | null;
  sortOrder?: number;
};

type RowLike = { id: string; teamId: string; version: number; [key: string]: unknown };

function derived(store: OptimisticLocalStore, row: RowLike, patch: IssueFieldsPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch, version: row.version + 1 };
  if (patch.stateId) {
    const states = store.getQuery(api.workflowStates.list, { teamId: row.teamId as Id<"teams"> });
    const state = states?.states.find((s) => s.id === patch.stateId);
    if (state) {
      out.stateCategory = state.category;
      if (state.category === "completed" || state.category === "canceled") out.completedAt = Date.now();
    }
  }
  if ("assigneeId" in patch && "assignee" in row) {
    const people = store.getQuery(api.teams.assignable, { teamId: row.teamId as Id<"teams"> });
    out.assignee = patch.assigneeId ? (people?.find((p) => p.id === patch.assigneeId) ?? row.assignee) : null;
  }
  if (patch.labelIds && "labels" in row) {
    const labels = store.getQuery(api.labels.list, { teamId: row.teamId as Id<"teams"> });
    if (labels) out.labels = labels.filter((l) => patch.labelIds!.includes(l.id)).map((l) => ({ id: l.id, name: l.name, color: l.color }));
  }
  if (patch.title !== undefined) out.title = patch.title.trim();
  if (patch.sortOrder === undefined && Object.keys(patch).some((key) => key !== "sortOrder")) out.updatedAt = Date.now();
  return out;
}

export function patchIssueEverywhere(store: OptimisticLocalStore, issueId: Id<"issues">, patch: IssueFieldsPatch) {
  const pageQueries = [api.issues.listForTeam, api.views.myIssues, api.views.workspaceIssues] as const;
  for (const query of pageQueries) {
    for (const { args, value } of store.getAllQueries(query)) {
      if (!value || !value.page.some((row) => row.id === issueId)) continue;
      store.setQuery(query, args as never, {
        ...value,
        page: value.page.map((row) => (row.id === issueId ? { ...row, ...derived(store, row, patch) } : row)),
      } as never);
    }
  }
  for (const { args, value } of store.getAllQueries(api.issues.get)) {
    if (!value || value.deleted || value.id !== issueId) continue;
    store.setQuery(api.issues.get, args, { ...value, ...derived(store, value, patch) } as typeof value);
  }
}

/** Updates an issue optimistically; resolves false (after a toast) when the server refuses. */
export function useUpdateIssue() {
  const mutate = useMutation(api.issues.update).withOptimisticUpdate((store, args) => {
    const { issueId, ...rest } = args;
    delete rest.expectedVersion;
    patchIssueEverywhere(store, issueId, rest as IssueFieldsPatch);
  });
  return useCallback(
    async (issue: { id: Id<"issues">; version: number }, patch: IssueFieldsPatch): Promise<boolean> => {
      try {
        await mutate({ issueId: issue.id, expectedVersion: issue.version, ...patch });
        return true;
      } catch (error) {
        toast.error(errorMessage(error));
        return false;
      }
    },
    [mutate],
  );
}
