import { describe, expect, it } from "vitest";
import { selectRange, toggleOne } from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("list selection", () => {
  it("toggles one issue", () => {
    expect([...toggleOne(new Set(), "b")]).toEqual(["b"]);
    expect([...toggleOne(new Set(["b", "c"]), "b")]).toEqual(["c"]);
  });

  it("selects the range between the anchor and the target, in either direction", () => {
    expect([...selectRange(order, new Set(["b"]), "b", "d")].sort()).toEqual(["b", "c", "d"]);
    expect([...selectRange(order, new Set(["d"]), "d", "a")].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the existing selection and selects only the target without a visible anchor", () => {
    expect([...selectRange(order, new Set(["e"]), "a", "b")].sort()).toEqual(["a", "b", "e"]);
    expect([...selectRange(order, new Set(), null, "c")]).toEqual(["c"]);
    expect([...selectRange(order, new Set(), "gone", "c")]).toEqual(["c"]);
    expect([...selectRange(order, new Set(["a"]), "a", "gone")]).toEqual(["a"]);
  });
});
