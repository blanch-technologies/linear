"use client";

import { useMemo, useState } from "react";
import type { Filter } from "@/lib/filters";
import { grouped, ordered, visible, type Display, type Group } from "@/lib/filters/views";
import { priorities } from "@/lib/issues";
import { stateCategories } from "@/lib/workflow";
import type { IssueRow } from "../use-issue-data";
import type { Lookups } from "./use-issue-source";

export type ViewGroup = Group<IssueRow> & { label: string; kind: "status" | "priority" | "assignee" | "label" | "none"; sample?: IssueRow };

/**
 * Filter -> visible -> ordered -> grouped, each memoized on its own inputs so
 * a grouping change doesn't re-filter and a filter change doesn't regroup
 * from scratch (ADR 0005).
 */
export function useDerivedView(rows: IssueRow[], filter: Filter, display: Display, lookups: Lookups, viewerId: string, teamId: string | null) {
  const singleTeam = teamId !== null;
  // `now` only matters for relative dates and completion windows; fixed per mount.
  const [now] = useState(() => Date.now());
  const shown = useMemo(() => visible(rows, filter, display, { viewerId, now }), [rows, filter, display, viewerId, now]);
  const sorted = useMemo(() => ordered(shown, display.orderBy), [shown, display.orderBy]);

  const groups = useMemo<ViewGroup[]>(() => {
    const statusKey = (issue: IssueRow): string => {
      if (singleTeam) return issue.stateId;
      const state = lookups.states.get(issue.stateId);
      return state ? `${state.category}:${state.name}` : issue.stateId;
    };
    const by = display.groupBy;
    let order: string[] = [];
    if (by === "status") {
      const list = [...lookups.stateList]
        .filter((s) => !singleTeam || s.teamId === teamId)
        .sort((a, b) => stateCategories.indexOf(a.category) - stateCategories.indexOf(b.category) || a.position - b.position);
      order = [...new Set(list.map((s) => (singleTeam ? s.id : `${s.category}:${s.name}`)))];
    } else if (by === "priority") order = [1, 2, 3, 4, 0].map(String);
    else if (by === "assignee") order = ["none", ...lookups.peopleList.map((p) => p.id)];
    else if (by === "label") order = [...lookups.labelList.map((l) => l.id), "none"];
    return grouped(sorted, by, order, display.showEmptyGroups, statusKey).map((group) => {
      let label = "All issues";
      if (by === "status") {
        const sample = singleTeam ? lookups.states.get(group.key) : lookups.stateList.find((s) => `${s.category}:${s.name}` === group.key);
        label = sample?.name ?? "Unknown status";
      } else if (by === "priority") label = priorities.find((p) => String(p.value) === group.key)?.label ?? "";
      else if (by === "assignee") label = group.key === "none" ? "No assignee" : (lookups.people.get(group.key)?.name ?? "Unknown");
      else if (by === "label") label = group.key === "none" ? "No labels" : (lookups.labels.get(group.key)?.name ?? "Deleted label");
      return { ...group, label, kind: by };
    });
  }, [sorted, display.groupBy, display.showEmptyGroups, lookups, singleTeam, teamId]);

  return { groups, count: shown.length };
}
