"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { optimisticallyUpdateValueInPaginatedQuery, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { IssueRow } from "@convex/issues";
import { StatusIcon } from "@/components/issues/status-icon";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import { stateCategories } from "@/lib/workflow";

/*
 * O-3 spike: every issue of one team loaded through Convex subscriptions
 * (paginated), then filtered, sorted, and grouped on the client and drawn in a
 * virtual list. Each interaction is timed from the input to the next paint and
 * exposed on window.__spike for e2e/perf/spike.spec.ts. Not linked from the
 * UI; Phase 2 builds the real list on whichever approach this proves.
 */

const pageSize = 1000;
const priorities = ["No priority", "Urgent", "High", "Medium", "Low"];
type Sort = "number" | "priority" | "updated" | "title";
type Group = "none" | "state" | "priority" | "assignee";
type Op = "filter" | "sort" | "group" | "scroll" | "optimistic";
type SpikeStats = { loadMs: number | null; rows: number; loaded: number; samples: Record<Op, number[]> };

declare global {
  interface Window {
    __spike?: SpikeStats;
  }
}

function stats(): SpikeStats {
  window.__spike ??= { loadMs: null, rows: 0, loaded: 0, samples: { filter: [], sort: [], group: [], scroll: [], optimistic: [] } };
  return window.__spike;
}

/** Records the time from now until the browser paints the resulting frame. */
function timeToPaint(op: Op) {
  const start = performance.now();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      stats().samples[op].push(performance.now() - start);
    }),
  );
}

type Row = { kind: "group"; key: string; label: string; count: number } | { kind: "issue"; issue: IssueRow };

export function LargeListSpike() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const { teams } = useWorkspace();
  const team = teams.find((item) => item.key === teamKey.toUpperCase());
  if (!team || !team.can.read) notFound();
  return <SpikeList teamId={team.id as Id<"teams">} />;
}

function SpikeList({ teamId }: { teamId: Id<"teams"> }) {
  const mountedAt = useRef(performance.now());
  const { results, status, loadMore } = usePaginatedQuery(api.issues.listForTeam, { teamId }, { initialNumItems: pageSize });
  const workflow = useQuery(api.workflowStates.list, { teamId });
  const setPriority = useMutation(api.issues.setPriority).withOptimisticUpdate((store, args) => {
    optimisticallyUpdateValueInPaginatedQuery(store, api.issues.listForTeam, { teamId }, (row) =>
      row.id === args.issueId ? { ...row, priority: args.priority, version: row.version + 1 } : row,
    );
  });

  const [text, setText] = useState("");
  const [priority, setPriorityFilter] = useState("any");
  const [sort, setSort] = useState<Sort>("number");
  const [group, setGroup] = useState<Group>("state");

  useEffect(() => {
    if (status === "CanLoadMore") loadMore(pageSize);
    if (status === "Exhausted" && stats().loadMs === null) stats().loadMs = performance.now() - mountedAt.current;
  }, [status, loadMore]);

  const states = useMemo(() => new Map((workflow?.states ?? []).map((state) => [state.id as string, state])), [workflow]);

  const rows = useMemo<Row[]>(() => {
    const needle = text.trim().toLowerCase();
    let list = results.filter(
      (issue) =>
        (priority === "any" || issue.priority === Number(priority)) &&
        (!needle || issue.title.toLowerCase().includes(needle) || issue.identifier.toLowerCase().includes(needle)),
    );
    const byPriority = (p: number) => (p === 0 ? 5 : p);
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "priority":
          return byPriority(a.priority) - byPriority(b.priority) || b.number - a.number;
        case "updated":
          return b.updatedAt - a.updatedAt;
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return b.number - a.number;
      }
    });
    if (group === "none") return list.map((issue) => ({ kind: "issue" as const, issue }));
    const keyOf = (issue: IssueRow) =>
      group === "state" ? issue.stateId : group === "priority" ? String(issue.priority) : (issue.assigneeId ?? "none");
    const buckets = new Map<string, IssueRow[]>();
    for (const issue of list) {
      const key = keyOf(issue);
      buckets.set(key, [...(buckets.get(key) ?? []), issue]);
    }
    const order = [...buckets.keys()].sort((a, b) => {
      if (group === "state") {
        const sa = states.get(a);
        const sb = states.get(b);
        return stateCategories.indexOf(sa?.category ?? "backlog") - stateCategories.indexOf(sb?.category ?? "backlog") || (sa?.position ?? 0) - (sb?.position ?? 0);
      }
      return a.localeCompare(b);
    });
    return order.flatMap((key) => {
      const items = buckets.get(key)!;
      const label = group === "state" ? (states.get(key)?.name ?? "Unknown") : group === "priority" ? priorities[Number(key)]! : key === "none" ? "Unassigned" : `Assignee ${key.slice(-4)}`;
      return [{ kind: "group" as const, key, label, count: items.length }, ...items.map((issue) => ({ kind: "issue" as const, issue }))];
    });
  }, [results, text, priority, sort, group, states]);

  useEffect(() => {
    const s = stats();
    s.rows = rows.length;
    s.loaded = results.length;
  }, [rows, results]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns functions the React Compiler can't memoize safely.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === "group" ? 36 : 38),
    overscan: 12,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="spike">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Input
          aria-label="Filter issues"
          placeholder="Filter by title or ID"
          className="h-8 w-56"
          value={text}
          onChange={(event) => {
            timeToPaint("filter");
            setText(event.target.value);
          }}
        />
        <Picker label="Priority" value={priority} onChange={(value) => (timeToPaint("filter"), setPriorityFilter(value))}
          options={[["any", "Any priority"], ...priorities.map((label, index) => [String(index), label] as [string, string])]} />
        <Picker label="Sort" value={sort} onChange={(value) => (timeToPaint("sort"), setSort(value as Sort))}
          options={[["number", "Newest"], ["priority", "Priority"], ["updated", "Updated"], ["title", "Title"]]} />
        <Picker label="Group" value={group} onChange={(value) => (timeToPaint("group"), setGroup(value as Group))}
          options={[["none", "No grouping"], ["state", "Status"], ["priority", "Priority"], ["assignee", "Assignee"]]} />
        <span className="ml-auto text-xs text-muted-foreground" data-testid="spike-count">
          {results.length} loaded{status !== "Exhausted" ? "…" : ""} · {rows.length} rows
        </span>
      </div>
      <div
        ref={scrollRef}
        className="h-[calc(100dvh-var(--spacing-header)-49px)] overflow-auto"
        data-testid="spike-scroll"
        onScroll={() => timeToPaint("scroll")}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return (
              <div
                key={row.kind === "group" ? `g-${row.key}` : row.issue.id}
                className={cn(
                  "absolute inset-x-0 flex items-center gap-3 border-b border-border px-4",
                  row.kind === "group" ? "bg-surface-2 font-medium" : "hover:bg-surface",
                )}
                style={{ top: item.start, height: item.size }}
              >
                {row.kind === "group" ? (
                  <>
                    {group === "state" && states.get(row.key) && (
                      <StatusIcon category={states.get(row.key)!.category} color={states.get(row.key)!.color} />
                    )}
                    <span>{row.label}</span>
                    <span className="text-muted-strong">{row.count}</span>
                  </>
                ) : (
                  <IssueLine
                    issue={row.issue}
                    state={states.get(row.issue.stateId)}
                    onCyclePriority={() => {
                      timeToPaint("optimistic");
                      void setPriority({ issueId: row.issue.id, priority: (row.issue.priority + 1) % 5, expectedVersion: row.issue.version });
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IssueLine({
  issue,
  state,
  onCyclePriority,
}: {
  issue: IssueRow;
  state: { category: (typeof stateCategories)[number]; color: string; name: string } | undefined;
  onCyclePriority: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="w-24 shrink-0 text-left text-xs text-muted-foreground"
        onClick={onCyclePriority}
        aria-label={`Priority of ${issue.identifier}: ${priorities[issue.priority]}`}
        data-testid="spike-priority"
      >
        {priorities[issue.priority]}
      </button>
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{issue.identifier}</span>
      {state && <StatusIcon category={state.category} color={state.color} label={state.name} />}
      <span className="truncate">{issue.title}</span>
    </>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
