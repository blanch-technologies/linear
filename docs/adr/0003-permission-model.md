# ADR 0003: Permission model

Status: accepted (Phase 1), 2026-10-13

## Context

D-16 to D-20 fix the roles, team visibility, guest limits, the single mutation path, and a
test matrix written before features. The prototype gave admins access to private-team content
and treated `restricted` like `private` (`docs/reference/nonlinear-functionality-audit.md`, both
findings). D-17 leaves some cases open, and this ADR records how they are decided.

## Decision

The rules live in `src/lib/permissions`. They are pure functions over plain data (an `Actor`, a
`Team`, and the workspace's `TeamGraph`), with no Convex or React imports. Convex functions and the
UI call the same functions.

**Three questions per team:**

| Question | What it covers |
|---|---|
| **See** | The team's name and key appear (sidebar, pickers, settings) |
| **Read** | Its issues, projects, documents, and attachments |
| **Write** | Create, update, delete, or move that content |

**How the answers are worked out, in order:**
1. **Other workspace** (a different `workspaceId`): nothing, even if a membership row with a colliding
   id exists. Not a member, or suspended: no `Actor`, so nothing.
2. **Explicit team member,** any role, guests included: see, read, write.
3. **Guest** who is not a member: nothing (D-18).
4. **Public team:** every non-guest sees, reads, and writes.
5. **Restricted team:** non-guest members of its (private) parent see and **read**. Writing needs
   joining, the same as the prototype's write rule. Owners and admins see it so they can find it.
6. **Private team:** owners and admins **see** it (name and key, so they can join) but read nothing
   until they join. Everyone else sees nothing.

**Moves** need write access to both the source and the destination team.

**Managing a team** means its settings, workflow states, and membership. It's open to:
- Workspace owners and admins.
- The team's owners (team role `owner`).
- Members of any ancestor team (D-17).

Only admins reparent or delete a team.

**Joining:**
- Non-guests can join public teams.
- Restricted teams can be joined via membership in the parent.
- Owners and admins can join private teams.
- Guests are added by someone who manages the team.

**Membership invariants (whoever adds the person):**
- A non-guest member of a sub-team must already belong to its parent. We reject the change rather
  than add the person to ancestors silently, because a silent add could open a private parent.
- Guests can't join restricted teams ("non-guests only", D-17).
- Removing someone from a team also removes them from its sub-teams. This is done in the Convex
  layer.

**Hierarchy:**
- At most 5 levels, counting the top level and the height of any moved subtree.
- No cycles.
- A restricted team needs a private parent. A team with restricted children must stay private.

**Workspace roles:**

| Role | What it can do |
|---|---|
| Owner | Everything, including granting or removing ownership |
| Admin | Invites, role changes, removals, and suspensions for non-owners. Can't grant `owner` |
| Member, guest | No administration. Anyone can leave a workspace |

- Nobody can suspend themselves.
- `wouldRemoveLastOwner` blocks any change that leaves no active owner (D-16). The Convex
  layer counts owners inside the same transaction.

## Consequences

- `src/lib/permissions/matrix.test.ts` is the D-20 matrix: every role in every membership state
  (none, team, parent), plus non-member and other-tenant, against public, restricted, and private,
  for read, create, update, delete, and move, plus "see".
  - The expected cells are written out by hand, not computed.
  - I checked the matrix catches the prototype's admin-reads-private bug: reintroducing it fails
    two cells.
- The cross-tenant tests at the Convex level (two workspaces, real functions) run in CI as well.
  They arrive with the data model (ADR 0004).
- Team owners are optional (the audit's "zero team owners" finding). Workspace admins can always
  manage.
