import { describe, expect, it } from "vitest";
import { describeChange, describeEntry } from "./activity";

describe("activity phrases", () => {
  it("describes property changes", () => {
    expect(describeChange({ field: "stateId", from: "Todo", to: "In Progress" })).toBe("changed status from Todo to In Progress");
    expect(describeChange({ field: "priority", from: 0, to: 2 })).toBe("set priority to High");
    expect(describeChange({ field: "priority", from: 2, to: 0 })).toBe("removed the priority");
    expect(describeChange({ field: "assigneeId", from: null, to: "Bo" })).toBe("assigned the issue to Bo");
    expect(describeChange({ field: "assigneeId", from: "Bo", to: null })).toBe("unassigned Bo");
    expect(describeChange({ field: "dueDate", from: null, to: "2026-10-20" })).toBe("set the due date to Oct 20, 2026");
    expect(describeChange({ field: "parentId", from: null, to: "ENG-1" })).toBe("made this a sub-issue of ENG-1");
    expect(describeChange({ field: "teamId", from: "ENG", to: "DES" })).toBe("moved the issue from ENG to DES");
  });

  it("diffs labels", () => {
    expect(describeChange({ field: "labelIds", from: "Bug", to: "Bug, UI, API" })).toBe("added labels UI, API");
    expect(describeChange({ field: "labelIds", from: "Bug, UI", to: "API" })).toBe("added label API and removed labels Bug, UI");
    expect(describeChange({ field: "labelIds", from: "Bug", to: "Bug" })).toBeNull();
  });

  it("describes relations both ways and skips unknown fields", () => {
    expect(describeChange({ field: "relation:blocked_by", from: null, to: "ENG-9" })).toBe("marked this as blocked by ENG-9");
    expect(describeChange({ field: "relation:related", from: "ENG-9", to: null })).toBe("removed the relation to ENG-9");
    expect(describeChange({ field: "identifier", from: "ENG-1", to: "DES-4" })).toBeNull();
    expect(describeEntry("moved", [{ field: "teamId", from: "ENG", to: "DES" }, { field: "identifier", from: "ENG-1", to: "DES-4" }])).toEqual([
      "moved the issue from ENG to DES",
    ]);
    expect(describeEntry("created", [])).toEqual(["created the issue"]);
  });
});
