import { WorkOS } from "@workos-inc/node";
import { convexEnv } from "./env";
import type { WorkspaceRole } from "../../src/lib/permissions";
import { workspaceRoles } from "../../src/lib/permissions";

let client: WorkOS | undefined;

/** WorkOS client for actions. The SDK ships a build for Convex's runtime. */
export function workos(): WorkOS {
  client ??= new WorkOS(convexEnv.workosApiKey(), { clientId: convexEnv.workosClientId() });
  return client;
}

/** WorkOS role slug -> our role. Unknown slugs get the least privilege that still works. */
export function roleFromSlug(slug: string | undefined): WorkspaceRole {
  return (workspaceRoles as readonly string[]).includes(slug ?? "") ? (slug as WorkspaceRole) : "guest";
}

/** A message from a WorkOS SDK error that is safe to show (no request ids or keys). */
export function workosErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "WorkOS request failed.";
}
