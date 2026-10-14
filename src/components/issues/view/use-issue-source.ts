"use client";

import { useEffect, useMemo } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { IssueRow } from "../use-issue-data";

export type IssueSource =
  | { kind: "team"; teamId: Id<"teams"> }
  | { kind: "my"; tab: "assigned" | "created" | "subscribed" | "activity" }
  | { kind: "workspace" };

const firstPage = 250;
const nextPage = 1000;

/**
 * Loads every issue of a source through paginated subscriptions (ADR 0005):
 * the first page renders at once, the rest streams in.
 */
export function useIssueSource(source: IssueSource) {
  const team = usePaginatedQuery(api.issues.listForTeam, source.kind === "team" ? { teamId: source.teamId } : "skip", { initialNumItems: firstPage });
  const my = usePaginatedQuery(api.views.myIssues, source.kind === "my" ? { tab: source.tab } : "skip", { initialNumItems: firstPage });
  const all = usePaginatedQuery(api.views.workspaceIssues, source.kind === "workspace" ? {} : "skip", { initialNumItems: firstPage });
  const active = source.kind === "team" ? team : source.kind === "my" ? my : all;
  const { status, loadMore, results } = active;

  useEffect(() => {
    if (status === "CanLoadMore") loadMore(nextPage);
  }, [status, loadMore]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (results as IssueRow[]).filter((row) => !seen.has(row.id) && seen.add(row.id));
  }, [results]);

  return { rows, loading: status === "LoadingFirstPage", complete: status === "Exhausted" };
}

/** Names and colors for ids found in issue rows. */
export function useLookups() {
  const states = useQuery(api.workflowStates.forWorkspace);
  const people = useQuery(api.members.directory);
  const labels = useQuery(api.labels.all);
  return useMemo(
    () => ({
      ready: states !== undefined && people !== undefined && labels !== undefined,
      states: new Map((states ?? []).map((s) => [s.id as string, s])),
      stateList: states ?? [],
      people: new Map((people ?? []).map((p) => [p.id as string, p])),
      peopleList: people ?? [],
      labels: new Map((labels ?? []).map((l) => [l.id as string, l])),
      labelList: (labels ?? []).filter((l) => !l.archived),
    }),
    [states, people, labels],
  );
}
export type Lookups = ReturnType<typeof useLookups>;
