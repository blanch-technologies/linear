"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useComposer } from "@/components/issues/composer";
import { useShortcut } from "@/components/shortcuts/shortcuts-provider";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { emptyFilter, parseFilter, serializeFilter, type Filter } from "@/lib/filters";
import { defaultDisplay, parseDisplay, type Display } from "@/lib/filters/views";
import { selectRange, toggleOne } from "@/lib/issues/selection";
import { useUpdateIssue } from "../use-update-issue";
import type { IssueRow } from "../use-issue-data";
import { IssueBoard, type BoardMove } from "./issue-board";
import { IssueList } from "./issue-list";
import type { IssuePatch, PickerKind } from "./issue-row";
import { useDerivedView, type ViewGroup } from "./use-derived-view";
import { useIssueSource, useLookups, type IssueSource } from "./use-issue-source";
import { ViewToolbar } from "./view-toolbar";

function readDisplay(key: string, fallback: Display): Display {
  try {
    const raw = window.localStorage.getItem(`display:${key}`);
    return raw ? parseDisplay(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A list or board over one issue source (D-37): filters in the URL, display
 * options remembered per view in this browser, keyboard navigation and
 * selection, and property shortcuts on the focused or selected issues (D-35).
 */
export function IssueView({
  source,
  viewKey,
  baseFilter = emptyFilter,
  initialDisplay = defaultDisplay,
  scopeTeamId = null,
  emptyTitle = "No issues",
  emptyBody = "Create an issue, or change the filters.",
  header,
}: {
  source: IssueSource;
  /** Remembers display options for this view. */
  viewKey: string;
  /** Conditions implied by the page (a tab), applied but not shown as chips. */
  baseFilter?: Filter;
  initialDisplay?: Display;
  scopeTeamId?: string | null;
  emptyTitle?: string;
  emptyBody?: string;
  header?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { href, viewer, teams } = useWorkspace();
  const composer = useComposer();
  const update = useUpdateIssue();
  const lookups = useLookups();
  const { rows, loading } = useIssueSource(source);

  const filter = useMemo(() => parseFilter(params.get("filter")) ?? emptyFilter, [params]);
  const setFilter = useCallback(
    (next: Filter) => {
      const search = new URLSearchParams(params);
      if (next.conditions.length) search.set("filter", serializeFilter(next));
      else search.delete("filter");
      router.replace(`${pathname}${search.size ? `?${search}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const [display, setDisplayState] = useState<Display>(() => (typeof window === "undefined" ? initialDisplay : readDisplay(viewKey, initialDisplay)));
  const setDisplay = useCallback(
    (next: Display) => {
      setDisplayState(next);
      try {
        window.localStorage.setItem(`display:${viewKey}`, JSON.stringify(next));
      } catch {
        // Not remembered.
      }
    },
    [viewKey],
  );

  const effective = useMemo<Filter>(
    () => (baseFilter.conditions.length ? { op: "and", conditions: [...baseFilter.conditions, filter] } : filter),
    [baseFilter, filter],
  );
  const { groups, count } = useDerivedView(rows, effective, display, lookups, viewer.id, scopeTeamId);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Where shift-click ranges start: the last issue toggled on its own.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ id: string; kind: PickerKind } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const order = useMemo(() => groups.filter((g) => !collapsed.has(g.key)).flatMap((g) => g.issues), [groups, collapsed]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id as string, r])), [rows]);
  const hrefFor = useCallback((issue: IssueRow) => href("issue", issue.identifier), [href]);
  const open = useCallback((issue: IssueRow) => router.push(hrefFor(issue)), [router, hrefFor]);

  /** Applies a change to the selection when the target is part of it, else to the one issue. */
  const applyPatch = useCallback(
    (patch: IssuePatch, issue: IssueRow) => {
      const targets = selected.has(issue.id) && selected.size > 1 ? [...selected].map((id) => byId.get(id)).filter((r) => r !== undefined) : [issue];
      for (const target of targets) {
        let next = patch;
        if (patch.labelIds && target.id !== issue.id) {
          // Bulk label edits apply the change made on the focused issue to each issue.
          const added = patch.labelIds.filter((l) => !issue.labelIds.includes(l));
          const removed = issue.labelIds.filter((l) => !patch.labelIds!.includes(l));
          next = { ...patch, labelIds: [...new Set([...target.labelIds.filter((l) => !removed.includes(l)), ...added])] as Id<"labels">[] };
        }
        if (patch.stateId && target.teamId !== issue.teamId) {
          // Same-named status in the target's own team.
          const name = lookups.states.get(patch.stateId)?.name;
          const match = lookups.stateList.find((s) => s.teamId === target.teamId && s.name === name);
          if (!match) continue;
          next = { ...next, stateId: match.id as Id<"workflowStates"> };
        }
        void update({ id: target.id as Id<"issues">, version: target.version }, next);
      }
    },
    [selected, byId, update, lookups],
  );

  const move = useCallback(({ issue, patch }: BoardMove) => void update({ id: issue.id as Id<"issues">, version: issue.version }, patch), [update]);

  const step = (delta: number) => {
    if (order.length === 0) return;
    const index = focusedId ? order.findIndex((i) => i.id === focusedId) : -1;
    const next = order[Math.max(0, Math.min(order.length - 1, index === -1 ? 0 : index + delta))]!;
    setFocusedId(next.id);
  };
  const focusedOrFirst = () => {
    const id = focusedId && byId.has(focusedId) ? focusedId : order[0]?.id;
    if (id && id !== focusedId) setFocusedId(id);
    return id ?? null;
  };
  const isList = display.layout === "list";
  useShortcut("list-down", () => step(1), isList);
  useShortcut("list-up", () => step(-1), isList);
  useShortcut("select", () => {
    const id = focusedOrFirst();
    if (!id) return;
    setSelected(toggleOne(selected, id));
    setAnchor(id);
  }, isList);
  const extend = (delta: number) => {
    const from = focusedOrFirst();
    if (!from) return;
    const index = order.findIndex((i) => i.id === from);
    const to = order[Math.max(0, Math.min(order.length - 1, index + delta))]!.id;
    setSelected(new Set(selected).add(from).add(to));
    if (!anchor) setAnchor(from);
    setFocusedId(to);
  };
  useShortcut("select-down", () => extend(1), isList);
  useShortcut("select-up", () => extend(-1), isList);
  useShortcut("open-issue", () => {
    const active = document.activeElement;
    if (active && active !== document.body && active.closest("button, a, [role=dialog]")) return;
    const id = focusedId && byId.get(focusedId);
    if (id) open(id);
  }, isList);
  for (const [shortcut, kind] of [["set-status", "status"], ["set-priority", "priority"], ["assign", "assignee"], ["set-labels", "labels"]] as const) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed list, same order every render
    useShortcut(shortcut, () => {
      const id = focusedOrFirst();
      if (id) setPicker({ id, kind });
    }, isList);
  }
  useShortcut("toggle-layout", () => setDisplay({ ...display, layout: isList ? "board" : "list" }));

  // Esc clears the selection when nothing else is open.
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) {
        setSelected(new Set());
        setAnchor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const createIn = useCallback(
    (group: ViewGroup) => {
      const preset: Parameters<typeof composer.open>[0] = scopeTeamId ? { teamId: scopeTeamId } : {};
      if (group.kind === "status" && scopeTeamId) preset.stateId = group.key;
      if (group.kind === "priority") preset.priority = Number(group.key);
      if (group.kind === "assignee" && group.key !== "none") preset.assigneeId = group.key;
      composer.open(preset);
    },
    [composer, scopeTeamId],
  );

  const orderIds = useMemo(() => order.map((i) => i.id), [order]);
  const toggleSelect = useCallback(
    (id: string, range: boolean) => {
      if (range) {
        setSelected((current) => selectRange(orderIds, current, anchor, id));
      } else {
        setSelected((current) => toggleOne(current, id));
        setAnchor(id);
      }
    },
    [orderIds, anchor],
  );

  const ready = !loading && lookups.ready;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <ViewToolbar
        filter={filter}
        onFilter={setFilter}
        display={display}
        onDisplay={setDisplay}
        lookups={lookups}
        teams={teams.filter((t) => t.can.read)}
        scopeTeamIds={scopeTeamId ? [scopeTeamId] : null}
        count={count}
      />
      {selected.size > 0 && (
        <div className="flex items-center gap-3 border-b border-border bg-brand/10 px-4 py-1.5 text-xs" role="status">
          {selected.size} selected. Press S, P, A, or L to change them all.
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}
      {!ready ? (
        <div className="space-y-2 p-4" role="status" aria-busy="true" aria-label="Loading issues">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : count === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <h2 className="text-base font-semibold">{emptyTitle}</h2>
          <p className="max-w-sm text-muted-foreground">{emptyBody}</p>
          <Button size="sm" className="mt-2" onClick={() => composer.open(scopeTeamId ? { teamId: scopeTeamId } : {})}>
            <Plus aria-hidden /> Create issue
          </Button>
        </div>
      ) : isList ? (
        <IssueList
          groups={groups}
          lookups={lookups}
          display={display}
          hrefFor={hrefFor}
          focusedId={focusedId}
          selected={selected}
          picker={picker}
          collapsed={collapsed}
          onToggleGroup={(key) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onFocus={setFocusedId}
          onToggleSelect={toggleSelect}
          onPicker={setPicker}
          onUpdate={applyPatch}
          onOpen={open}
          onCreateInGroup={createIn}
        />
      ) : (
        <IssueBoard groups={groups} lookups={lookups} display={display} hrefFor={hrefFor} onMove={move} onCreateInGroup={createIn} />
      )}
    </div>
  );
}
