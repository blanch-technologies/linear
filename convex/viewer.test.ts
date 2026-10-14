/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("viewer.get", () => {
  it("returns null without an identity", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.viewer.get, {})).toBeNull();
  });

  it("returns the WorkOS identity", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_01", email: "a@example.com", name: "A" });
    expect(await asUser.query(api.viewer.get, {})).toEqual({
      subject: "user_01",
      email: "a@example.com",
      name: "A",
    });
  });
});
