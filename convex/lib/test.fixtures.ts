/// <reference types="vite/client" />
/*
 * Test fixtures for convex-test. The double dot in the file name keeps Convex
 * from deploying it, and keeps Vitest from treating it as a test file.
 */
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { defaultWorkflowStates } from "../../src/lib/workflow";
import type { TeamRole, TeamVisibility, WorkspaceRole } from "../../src/lib/permissions";

export const modules = import.meta.glob("../**/*.ts");

export type TestConvex = ReturnType<typeof newConvex>;

export function newConvex() {
  return convexTest(schema, modules);
}

export type Person = { userId: Id<"users">; sub: string; email: string };

/** A WorkOS-like identity whose session is scoped to `organizationId`. */
export function identity(person: Pick<Person, "sub" | "email">, organizationId?: string) {
  return { subject: person.sub, email: person.email, issuer: "https://api.workos.com", ...(organizationId ? { org_id: organizationId } : {}) };
}

export async function addUser(t: TestConvex, name: string): Promise<Person> {
  const sub = `user_${name}`;
  const email = `${name}@blanch.test`;
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { workosUserId: sub, email, name, syncedAt: Date.now() }),
  );
  return { userId, sub, email };
}

export type Workspace = {
  workspaceId: Id<"workspaces">;
  organizationId: string;
  /** Run as `person` with a session scoped to this workspace. */
  as: (person: Person) => ReturnType<TestConvex["withIdentity"]>;
};

export async function addWorkspace(
  t: TestConvex,
  urlKey: string,
  members: Array<[Person, WorkspaceRole, ("active" | "suspended")?]>,
): Promise<Workspace> {
  const organizationId = `org_${urlKey}`;
  const workspaceId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("workspaces", {
      workosOrganizationId: organizationId,
      name: urlKey,
      urlKey,
      createdBy: members[0]![0].userId,
    });
    for (const [person, role, status = "active"] of members) {
      await ctx.db.insert("memberships", {
        workspaceId: id,
        userId: person.userId,
        workosMembershipId: `om_${urlKey}_${person.sub}`,
        role,
        status,
        updatedAt: 0,
      });
    }
    return id;
  });
  return {
    workspaceId,
    organizationId,
    as: (person) => t.withIdentity(identity(person, organizationId)),
  };
}

export async function addMembership(t: TestConvex, workspace: Workspace, person: Person, role: WorkspaceRole) {
  await t.run((ctx) =>
    ctx.db.insert("memberships", {
      workspaceId: workspace.workspaceId,
      userId: person.userId,
      workosMembershipId: `om_${workspace.organizationId}_${person.sub}`,
      role,
      status: "active",
      updatedAt: 0,
    }),
  );
}

/** Inserts a team with default states directly, bypassing permission checks. */
export async function addTeam(
  t: TestConvex,
  workspace: Workspace,
  key: string,
  visibility: TeamVisibility,
  members: Array<[Person, TeamRole?]> = [],
  parentId: Id<"teams"> | null = null,
) {
  return await t.run(async (ctx) => {
    const teamId = await ctx.db.insert("teams", {
      workspaceId: workspace.workspaceId,
      name: key,
      key,
      parentId,
      visibility,
      issueCounter: 0,
      createdBy: members[0]?.[0].userId ?? (await ctx.db.query("users").first())!._id,
    });
    let defaultStateId: Id<"workflowStates"> | undefined;
    for (const [index, state] of defaultWorkflowStates.entries()) {
      const id = await ctx.db.insert("workflowStates", {
        workspaceId: workspace.workspaceId,
        teamId,
        name: state.name,
        category: state.category,
        color: state.color,
        position: (index + 1) * 1000,
      });
      if (state.isDefault) defaultStateId = id;
    }
    await ctx.db.patch(teamId, { defaultStateId });
    for (const [person, role = "member"] of members) {
      await ctx.db.insert("teamMembers", { workspaceId: workspace.workspaceId, teamId, userId: person.userId, role });
    }
    return teamId;
  });
}

/** Extracts the typed error code from a rejected Convex call. */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const data = (error as { data?: { code?: string } }).data;
    if (data?.code) return data.code;
    throw error;
  }
  throw new Error("Expected the call to fail, but it succeeded.");
}
