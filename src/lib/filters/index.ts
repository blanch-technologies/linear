import { z } from "zod";
import { priorityRank } from "../issues";

/*
 * The filter model (O-6, ADR 0008): a typed AST shared by lists, boards, saved
 * views, and the server. Serialized as versioned JSON in saved views and URLs.
 */

const id = z.string().min(1).max(64);
const stateCategories = z.enum(["triage", "backlog", "unstarted", "started", "completed", "canceled"]);
/** Absolute date (YYYY-MM-DD) or relative to today (-7d, -2w, -1m, 3d). */
const dateValue = z.string().regex(/^(\d{4}-\d{2}-\d{2}|-?\d{1,3}[dwm])$/);

export const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("status"), op: z.enum(["in", "nin"]), values: z.array(id).max(100) }),
  z.object({ field: z.literal("statusCategory"), op: z.enum(["in", "nin"]), values: z.array(stateCategories).max(6) }),
  z.object({ field: z.literal("priority"), op: z.enum(["in", "nin"]), values: z.array(z.number().int().min(0).max(4)).max(5) }),
  z.object({ field: z.literal("assignee"), op: z.enum(["in", "nin"]), values: z.array(z.union([id, z.literal("me"), z.literal("none")])).max(100) }),
  z.object({ field: z.literal("creator"), op: z.enum(["in", "nin"]), values: z.array(z.union([id, z.literal("me")])).max(100) }),
  z.object({ field: z.literal("labels"), op: z.enum(["any", "all", "none"]), values: z.array(id).max(100) }),
  z.object({ field: z.literal("team"), op: z.enum(["in", "nin"]), values: z.array(id).max(100) }),
  z.object({ field: z.literal("estimate"), op: z.enum(["in", "nin", "set", "unset"]), values: z.array(z.number()).max(20).default([]) }),
  z.object({ field: z.literal("dueDate"), op: z.enum(["before", "after", "set", "unset", "overdue"]), value: dateValue.optional() }),
  z.object({ field: z.literal("parent"), op: z.enum(["set", "unset", "in"]), values: z.array(id).max(100).default([]) }),
  z.object({ field: z.literal("title"), op: z.literal("contains"), value: z.string().max(200) }),
  z.object({ field: z.enum(["created", "updated", "completed"]), op: z.enum(["before", "after"]), value: dateValue }),
]);
export type Condition = z.infer<typeof conditionSchema>;

export type Filter = { op: "and" | "or"; conditions: Array<Condition | Filter> };

export const filterSchema: z.ZodType<Filter> = z.lazy(() =>
  z.object({
    op: z.enum(["and", "or"]),
    conditions: z.array(z.union([conditionSchema, filterSchema])).max(50),
  }),
);

export const emptyFilter: Filter = { op: "and", conditions: [] };

export function isGroup(node: Condition | Filter): node is Filter {
  return "conditions" in node;
}

/** The fields of an issue a filter can look at. */
export type FilterableIssue = {
  teamId: string;
  stateId: string;
  stateCategory: string;
  priority: number;
  assigneeId: string | null;
  creatorId: string;
  labelIds: string[];
  estimate: number | null;
  dueDate: string | null;
  parentId: string | null;
  title: string;
  identifier: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type FilterContext = { viewerId: string; now: number };

const dayMs = 24 * 60 * 60 * 1000;

/** Resolves an absolute or relative date to a timestamp (start of that UTC day). */
export function resolveDate(value: string, now: number): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00Z`);
  const amount = Number(value.slice(0, -1));
  const unit = value.at(-1);
  const days = unit === "d" ? amount : unit === "w" ? amount * 7 : amount * 30;
  const today = Math.floor(now / dayMs) * dayMs;
  return today + days * dayMs;
}

const asDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function matchCondition(issue: FilterableIssue, c: Condition, ctx: FilterContext): boolean {
  const me = (v: string) => (v === "me" ? ctx.viewerId : v);
  switch (c.field) {
    case "status":
      return c.values.includes(issue.stateId) === (c.op === "in");
    case "statusCategory":
      return (c.values as string[]).includes(issue.stateCategory) === (c.op === "in");
    case "priority":
      return c.values.includes(issue.priority) === (c.op === "in");
    case "assignee": {
      const hit = c.values.some((v) => (v === "none" ? issue.assigneeId === null : me(v) === issue.assigneeId));
      return hit === (c.op === "in");
    }
    case "creator":
      return c.values.map(me).includes(issue.creatorId) === (c.op === "in");
    case "labels":
      if (c.op === "any") return c.values.some((v) => issue.labelIds.includes(v));
      if (c.op === "all") return c.values.every((v) => issue.labelIds.includes(v));
      return !c.values.some((v) => issue.labelIds.includes(v));
    case "team":
      return c.values.includes(issue.teamId) === (c.op === "in");
    case "estimate":
      if (c.op === "set") return issue.estimate !== null;
      if (c.op === "unset") return issue.estimate === null;
      return (issue.estimate !== null && c.values.includes(issue.estimate)) === (c.op === "in");
    case "dueDate": {
      if (c.op === "set") return issue.dueDate !== null;
      if (c.op === "unset") return issue.dueDate === null;
      if (issue.dueDate === null) return false;
      const due = asDay(issue.dueDate);
      if (c.op === "overdue") {
        return due < resolveDate("0d", ctx.now) && issue.stateCategory !== "completed" && issue.stateCategory !== "canceled";
      }
      const bound = resolveDate(c.value ?? "0d", ctx.now);
      return c.op === "before" ? due < bound : due >= bound;
    }
    case "parent":
      if (c.op === "set") return issue.parentId !== null;
      if (c.op === "unset") return issue.parentId === null;
      return issue.parentId !== null && c.values.includes(issue.parentId);
    case "title": {
      const needle = c.value.trim().toLowerCase();
      return !needle || issue.title.toLowerCase().includes(needle) || issue.identifier.toLowerCase().includes(needle);
    }
    case "created":
    case "updated":
    case "completed": {
      const at = c.field === "created" ? issue.createdAt : c.field === "updated" ? issue.updatedAt : issue.completedAt;
      if (at === null) return false;
      const bound = resolveDate(c.value, ctx.now);
      return c.op === "before" ? at < bound : at >= bound;
    }
  }
}

/** True when the issue passes the filter. Empty groups match everything. */
export function matches(issue: FilterableIssue, filter: Filter, ctx: FilterContext): boolean {
  if (filter.conditions.length === 0) return true;
  const test = (node: Condition | Filter) => (isGroup(node) ? matches(issue, node, ctx) : matchCondition(issue, node, ctx));
  return filter.op === "and" ? filter.conditions.every(test) : filter.conditions.some(test);
}

/** Parses a stored or URL filter; anything malformed yields null (callers fall back to empty). */
export function parseFilter(json: string | null | undefined): Filter | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { v?: number; filter?: unknown };
    if (raw.v !== 1) return null;
    const parsed = filterSchema.safeParse(raw.filter);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeFilter(filter: Filter): string {
  return JSON.stringify({ v: 1, filter });
}

/** Adds or replaces a top-level condition for a field (the toolbar's quick filters). */
export function setCondition(filter: Filter, condition: Condition): Filter {
  const others = filter.conditions.filter((node) => isGroup(node) || node.field !== condition.field);
  return { ...filter, conditions: [...others, condition] };
}

export function removeCondition(filter: Filter, field: Condition["field"]): Filter {
  return { ...filter, conditions: filter.conditions.filter((node) => isGroup(node) || node.field !== field) };
}

export { priorityRank };
