# ADR 0004: Identity mirror, session sync, and the function wrapper

Status: accepted (Phase 1), 2026-10-13

## Context

- WorkOS owns users, organizations, memberships, roles, and invitations (D-9, D-16).
- Convex needs them locally for permission checks and lists, and for every query to be reactive.
- D-15 requires the workspace to come from the authenticated identity, never from client input.
- D-19 requires a single wrapper for every function.
- D-22 sends admin events to WorkOS Audit Logs.

## Decision

**Workspace resolution.** A session is scoped to one WorkOS organization. AuthKit puts it in the
access token's signed `org_id` claim, and Convex exposes custom claims on the identity.
`loadViewer` (`convex/lib/viewer.ts`) works out the caller's context on every call:

| Piece | Where it comes from |
|---|---|
| User | Token subject |
| Workspace | `org_id` |
| Active membership | Mirror lookup |
| Team graph and memberships | Workspace's teams, the viewer's team memberships |

The URL's workspace key only *selects* a workspace. Switching calls AuthKit's `refreshSession`
with the organization. That's also where WorkOS enforces per-organization SSO or MFA later.

**Mirror tables.**
- `users`, `workspaces`, `memberships`, and `invitations` mirror WorkOS.
- `teams`, `teamMembers`, and `workflowStates` live only in Convex (D-17).
- Every tenant table has `workspaceId`. `users` is the one global table.

**Writes that touch WorkOS** go through actions:

| Change | Order of operations |
|---|---|
| Role changes, removal, suspension | A mutation checks permissions and the last-owner rule *atomically* and changes the mirror. Then WorkOS is called. If WorkOS refuses, a second mutation restores the snapshot. The audit event is written only after WorkOS accepts. |
| Workspace creation, invitations | WorkOS first, because the mirror needs its ids. A failed workspace creation deletes the new WorkOS organization again. |

**Session sync, not webhooks.**
- The client calls `session.sync` once per page load. It reads the user's profile and organization
  memberships from WorkOS and reconciles them for workspaces this deployment knows.
- That covers accepted invitations and edits made in the WorkOS dashboard.
- Rows the app changed after the WorkOS listing win, so a sync never reverts a change in flight.

I recommended `@convex-dev/workos-authkit` at the end of Phase 0. I've not adopted it, because:
- It syncs through WorkOS webhooks, which need one endpoint per Convex deployment. Per-PR preview
  deployments and local dev can't receive them.
- It syncs only users, not memberships.

Phase 5 (SCIM, Admin Portal) adds webhooks for staging and production. It also adds the component
if it has grown membership sync by then.

**The wrapper (D-19).** `convex/lib/functions.ts` builds every function with `convex-helpers`
custom functions. `convex-helpers` is Convex's own helper library and saves hand-writing the
wrapper types.

| Builder | What it gives the function |
|---|---|
| `workspaceQuery`, `workspaceMutation` | `ctx.viewer`; mutations also get `ctx.audit` |
| `authed*` | Signed in, before any workspace exists |
| `system*` | Internal only: sync, crons, seed |

ESLint forbids importing the raw builders from `_generated/server` anywhere else in `convex/`.
Content checks go through `requireTeam(viewer, teamId, "see" | "read" | "write" | "manage")`,
which calls `src/lib/permissions`. A team the caller can't see is reported as `NOT_FOUND`, so its
existence doesn't leak.

**Audit outbox (D-22).**
- `ctx.audit()` inserts into `auditEvents` in the caller's transaction and schedules
  `audit.deliver`.
- Delivery uses the row id as the WorkOS idempotency key and retries 8 times with exponential
  backoff.
- An hourly sweep re-sends anything stuck.
- WorkOS schemas are created by `pnpm workos:bootstrap` from `convex/lib/auditActions.ts`. They
  require `metadata` objects on the actor and on every target; the payload test pins this.
- WorkOS requires an IP, and Convex never sees the client's, so the location is `0.0.0.0`.
- Work-item history is the separate `issueHistory` table.

**Errors.** Functions throw `ConvexError({ code, message })` with a code from a fixed set. The
client shows the message and branches on the code.

## Consequences

- Each page load costs one sync action (two WorkOS API calls). The client limits it to once per
  load.
- A role change made directly in WorkOS takes effect at the member's next page load, not instantly.
  It's acceptable until SCIM, and webhooks then close the gap.
- **One WorkOS staging environment serves local, preview, and staging deployments.**
  - Organizations created in one deployment are invisible to the others, because sync ignores
    unknown organizations.
  - The environment accumulates test organizations, which e2e cleanup removes.
