import { z } from "zod";
import { priorityRank } from "../issues";
import { matches, type FilterableIssue, type Filter, type FilterContext } from "./index";

/*
 * Display options and view derivation: filter, then hide by completion window
 * and sub-issues, then order, then group. Each stage is a separate pure step so
 * the UI can memoize them independently (ADR 0005).
 */

export const groupFields = ["status", "priority", "assignee", "label", "none"] as const;
export type GroupField = (typeof groupFields)[number];

export const orderFields = ["manual", "priority", "updated", "created", "dueDate", "title"] as const;
export type OrderField = (typeof orderFields)[number];

export const displaySchema = z.object({
  layout: z.enum(["list", "board"]).default("list"),
  groupBy: z.enum(groupFields).default("status"),
  orderBy: z.enum(orderFields).default("manual"),
  /** Completed and canceled issues: all, those closed in the last week/month, or none. */
  showCompleted: z.enum(["all", "week", "month", "none"]).default("all"),
  showSubIssues: z.boolean().default(true),
  showEmptyGroups: z.boolean().default(false),
  properties: z
    .array(z.enum(["priority", "identifier", "status", "labels", "dueDate", "estimate", "assignee", "created", "updated"]))
    .default(["priority", "identifier", "status", "labels", "dueDate", "estimate", "assignee", "created"]),
});
export type Display = z.infer<typeof displaySchema>;
export const defaultDisplay: Display = displaySchema.parse({});

export function parseDisplay(json: string | null | undefined): Display {
  if (!json) return defaultDisplay;
  try {
    const parsed = displaySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : defaultDisplay;
  } catch {
    return defaultDisplay;
  }
}

const dayMs = 24 * 60 * 60 * 1000;

export function visible<T extends FilterableIssue>(issues: T[], filter: Filter, display: Display, ctx: FilterContext): T[] {
  const window = display.showCompleted === "week" ? 7 * dayMs : display.showCompleted === "month" ? 30 * dayMs : null;
  return issues.filter((issue) => {
    const closed = issue.stateCategory === "completed" || issue.stateCategory === "canceled";
    if (closed && display.showCompleted === "none") return false;
    if (closed && window !== null && (issue.completedAt === null || issue.completedAt < ctx.now - window)) return false;
    if (!display.showSubIssues && issue.parentId !== null) return false;
    return matches(issue, filter, ctx);
  });
}

type Orderable = FilterableIssue & { sortOrder: number; number: number };

export function ordered<T extends Orderable>(issues: T[], orderBy: OrderField): T[] {
  const byNumber = (a: T, b: T) => b.number - a.number;
  const compare: Record<OrderField, (a: T, b: T) => number> = {
    manual: (a, b) => a.sortOrder - b.sortOrder || byNumber(a, b),
    priority: (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sortOrder - b.sortOrder,
    updated: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    dueDate: (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || byNumber(a, b),
    title: (a, b) => a.title.localeCompare(b.title) || byNumber(a, b),
  };
  return [...issues].sort(compare[orderBy]);
}

export type Group<T> = { key: string; issues: T[] };

/**
 * Buckets ordered issues. `order` lists group keys in display order (states by
 * category, priorities urgent first, ...); `showEmpty` keeps empty buckets.
 * Issues with several labels appear under each label.
 */
export function grouped<T extends FilterableIssue>(
  issues: T[],
  groupBy: GroupField,
  order: string[],
  showEmpty: boolean,
  /** Status bucket for an issue; lists spanning teams merge same-named states. */
  statusKey: (issue: T) => string = (issue) => issue.stateId,
): Group<T>[] {
  if (groupBy === "none") return [{ key: "all", issues }];
  const buckets = new Map<string, T[]>(order.map((key) => [key, []]));
  const add = (key: string, issue: T) => {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(issue);
  };
  for (const issue of issues) {
    if (groupBy === "status") add(statusKey(issue), issue);
    else if (groupBy === "priority") add(String(issue.priority), issue);
    else if (groupBy === "assignee") add(issue.assigneeId ?? "none", issue);
    else if (issue.labelIds.length === 0) add("none", issue);
    else for (const label of issue.labelIds) add(label, issue);
  }
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...buckets.entries()]
    .filter(([, list]) => showEmpty || list.length > 0)
    .sort(([a], [b]) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER))
    .map(([key, list]) => ({ key, issues: list }));
}
