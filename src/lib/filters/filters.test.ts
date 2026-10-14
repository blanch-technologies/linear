import { describe, expect, it } from "vitest";
import { matches, parseFilter, removeCondition, resolveDate, serializeFilter, setCondition, type Filter, type FilterableIssue } from "./index";
import { defaultDisplay, grouped, ordered, parseDisplay, visible } from "./views";

const now = Date.parse("2026-10-14T12:00:00Z");
const ctx = { viewerId: "me_id", now };

function issue(over: Partial<FilterableIssue & { sortOrder: number; number: number }> = {}) {
  return {
    teamId: "eng",
    stateId: "todo",
    stateCategory: "unstarted",
    priority: 0,
    assigneeId: null,
    creatorId: "u1",
    labelIds: [],
    estimate: null,
    dueDate: null,
    parentId: null,
    title: "Fix the sidebar",
    identifier: "ENG-1",
    createdAt: now - 1000,
    updatedAt: now - 1000,
    completedAt: null,
    sortOrder: 0,
    number: 1,
    ...over,
  };
}

const and = (...conditions: Filter["conditions"]): Filter => ({ op: "and", conditions });
const or = (...conditions: Filter["conditions"]): Filter => ({ op: "or", conditions });

describe("filter conditions", () => {
  it("matches each field", () => {
    const a = issue({ assigneeId: "me_id", priority: 1, labelIds: ["bug", "ui"], estimate: 3, dueDate: "2026-10-10", parentId: "p" });
    const cases: Array<[Filter["conditions"][number], boolean]> = [
      [{ field: "status", op: "in", values: ["todo"] }, true],
      [{ field: "statusCategory", op: "nin", values: ["completed"] }, true],
      [{ field: "priority", op: "in", values: [2, 3] }, false],
      [{ field: "assignee", op: "in", values: ["me"] }, true],
      [{ field: "assignee", op: "in", values: ["none"] }, false],
      [{ field: "creator", op: "nin", values: ["me"] }, true],
      [{ field: "labels", op: "all", values: ["bug", "ui"] }, true],
      [{ field: "labels", op: "none", values: ["bug"] }, false],
      [{ field: "team", op: "in", values: ["eng"] }, true],
      [{ field: "estimate", op: "set", values: [] }, true],
      [{ field: "dueDate", op: "overdue" }, true],
      [{ field: "dueDate", op: "before", value: "0d" }, true],
      [{ field: "dueDate", op: "before", value: "-1w" }, false],
      [{ field: "parent", op: "unset", values: [] }, false],
      [{ field: "title", op: "contains", value: "SIDEBAR" }, true],
      [{ field: "title", op: "contains", value: "eng-1" }, true],
      [{ field: "created", op: "after", value: "-1d" }, true],
      [{ field: "completed", op: "after", value: "-1d" }, false],
    ];
    for (const [condition, expected] of cases) expect(matches(a, and(condition), ctx), JSON.stringify(condition)).toBe(expected);
  });

  it("combines with nested and/or", () => {
    const f = and({ field: "team", op: "in", values: ["eng"] }, or({ field: "priority", op: "in", values: [1] }, { field: "labels", op: "any", values: ["bug"] }));
    expect(matches(issue({ priority: 1 }), f, ctx)).toBe(true);
    expect(matches(issue({ labelIds: ["bug"] }), f, ctx)).toBe(true);
    expect(matches(issue({}), f, ctx)).toBe(false);
    expect(matches(issue({}), and(), ctx)).toBe(true);
  });

  it("resolves relative dates", () => {
    expect(new Date(resolveDate("-1w", now)).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(new Date(resolveDate("2026-01-02", now)).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("serializes with a version and rejects anything malformed", () => {
    const f = and({ field: "priority", op: "in", values: [1] });
    expect(parseFilter(serializeFilter(f))).toEqual(f);
    expect(parseFilter('{"v":2,"filter":{}}')).toBeNull();
    expect(parseFilter('{"v":1,"filter":{"op":"and","conditions":[{"field":"priority","op":"in","values":[9]}]}}')).toBeNull();
    expect(parseFilter("nope")).toBeNull();
  });

  it("sets and removes quick conditions", () => {
    let f = setCondition(and(), { field: "priority", op: "in", values: [1] });
    f = setCondition(f, { field: "priority", op: "in", values: [2] });
    expect(f.conditions).toEqual([{ field: "priority", op: "in", values: [2] }]);
    expect(removeCondition(f, "priority").conditions).toEqual([]);
  });
});

describe("view derivation", () => {
  const list = [
    issue({ identifier: "ENG-1", number: 1, priority: 0, sortOrder: 3, stateId: "todo" }),
    issue({ identifier: "ENG-2", number: 2, priority: 1, sortOrder: 2, stateId: "doing", stateCategory: "started" }),
    issue({ identifier: "ENG-3", number: 3, priority: 3, sortOrder: 1, stateId: "done", stateCategory: "completed", completedAt: now - 10 * 86400000 }),
    issue({ identifier: "ENG-4", number: 4, priority: 2, sortOrder: 0, parentId: "x", labelIds: ["a", "b"] }),
  ];

  it("hides completed issues by window and sub-issues by option", () => {
    const ids = (d: typeof defaultDisplay) => visible(list, and(), d, ctx).map((i) => i.identifier);
    expect(ids({ ...defaultDisplay, showCompleted: "week" })).toEqual(["ENG-1", "ENG-2", "ENG-4"]);
    expect(ids({ ...defaultDisplay, showCompleted: "month" })).toEqual(["ENG-1", "ENG-2", "ENG-3", "ENG-4"]);
    expect(ids({ ...defaultDisplay, showSubIssues: false })).toEqual(["ENG-1", "ENG-2", "ENG-3"]);
  });

  it("orders and groups", () => {
    expect(ordered(list, "priority").map((i) => i.identifier)).toEqual(["ENG-2", "ENG-4", "ENG-3", "ENG-1"]);
    expect(ordered(list, "manual").map((i) => i.identifier)).toEqual(["ENG-4", "ENG-3", "ENG-2", "ENG-1"]);
    const groups = grouped(list, "status", ["todo", "doing", "done", "empty"], false);
    expect(groups.map((g) => [g.key, g.issues.length])).toEqual([["todo", 2], ["doing", 1], ["done", 1]]);
    expect(grouped(list, "status", ["todo", "empty"], true).map((g) => g.key)).toEqual(["todo", "empty", "doing", "done"]);
    expect(grouped(list, "label", [], false).map((g) => [g.key, g.issues.length])).toEqual([["none", 3], ["a", 1], ["b", 1]]);
  });

  it("parses display options with defaults", () => {
    expect(parseDisplay('{"layout":"board"}')).toMatchObject({ layout: "board", groupBy: "status" });
    expect(parseDisplay("garbage")).toEqual(defaultDisplay);
  });
});
