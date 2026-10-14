/**
 * Admin and security events sent to WorkOS Audit Logs (D-22). Each action needs
 * a schema in the WorkOS environment; `pnpm workos:bootstrap` creates them from
 * this list. Work-item history is separate (issueHistory).
 */
type MetadataType = "string" | "number" | "boolean";

export const auditActions = {
  "workspace.created": { targets: ["workspace"] },
  "workspace.updated": { targets: ["workspace"], metadata: { name: "string", urlKey: "string" } },
  "member.joined": { targets: ["user"], metadata: { role: "string" } },
  "member.role_changed": { targets: ["user"], metadata: { from: "string", to: "string" } },
  "member.removed": { targets: ["user"] },
  "member.suspended": { targets: ["user"] },
  "member.reactivated": { targets: ["user"] },
  "invitation.sent": { targets: ["invitation"], metadata: { email: "string", role: "string" } },
  "invitation.revoked": { targets: ["invitation"], metadata: { email: "string" } },
  "team.created": { targets: ["team"], metadata: { visibility: "string" } },
  "team.updated": { targets: ["team"] },
  "team.visibility_changed": { targets: ["team"], metadata: { from: "string", to: "string" } },
  "team.reparented": { targets: ["team"], metadata: { from: "string", to: "string" } },
  "team.deleted": { targets: ["team"] },
  "team.member_added": { targets: ["team", "user"], metadata: { role: "string" } },
  "team.member_removed": { targets: ["team", "user"] },
  "team.member_role_changed": { targets: ["team", "user"], metadata: { from: "string", to: "string" } },
} as const satisfies Record<
  string,
  { targets: readonly string[]; metadata?: Record<string, MetadataType> }
>;

export type AuditAction = keyof typeof auditActions;
export type AuditTarget = { type: string; id: string; name?: string };
