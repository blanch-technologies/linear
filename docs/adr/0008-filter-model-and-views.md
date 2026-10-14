# ADR 0008: Filter model, display options, and view sources (O-6)

Status: accepted (Phase 2), 2026-10-14

## Context

O-6 requires a typed filter AST shared by client and server. It must support AND/OR, all property
types, and saved-view serialization. ADR 0005 showed that client-side derivation over
subscription-fed rows meets D-36 at 10,000 issues.

## Decision

- **Filter AST** (`src/lib/filters`, validated with zod):
  - A group `{ op: "and" | "or", conditions }`, nesting groups or conditions.
  - Fields and their operators:

    | Field | Operators |
    |---|---|
    | status, status category, priority, team | in / not in |
    | assignee (`me`, `none`) | in / not in |
    | creator (`me`) | in / not in |
    | labels | any / all / none |
    | estimate | in / not in / set / unset |
    | due date | before / after / set / unset / overdue |
    | parent | set / unset / in |
    | title | contains (also matches the identifier) |
    | created, updated, completed | before / after |

  - Dates are absolute (`2026-10-31`) or relative to today (`-2w`, `3d`), so saved views stay
    meaningful.
  - Stored as `{ "v": 1, "filter": … }`. Anything malformed parses to `null`, and the server rejects
    it on save.
- **Display options** (`src/lib/filters/views.ts`):
  - Layout (list or board), group by (status, priority, assignee, label, none).
  - Order (manual, priority, updated, created, due date, title).
  - Completed issues: all, last week, last month, or none.
  - Sub-issue visibility, empty groups, and which properties show.
- **Derivation:** four pure, separately memoizable stages: visible → ordered → grouped → rows. This
  is ADR 0005's first Phase 2 requirement.
- **Sources** (`convex/views.ts`), each walking one index a page at a time and dropping unreadable
  issues:

  | Source | Index |
  |---|---|
  | Team | `issues.listForTeam` |
  | My issues: Assigned | `by_assignee_and_category` |
  | My issues: Created | `by_creator` |
  | My issues: Subscribed | `subscriptions.by_user` |
  | My issues: Activity | `issueHistory.by_actor`, deduplicated |
  | Workspace views | `by_workspace_and_deleted` |

  Filters run on the client over the loaded rows.
- **Saved views:**

  | Kind | Who sees it | Who edits it |
  |---|---|---|
  | Personal | The owner | The owner |
  | Shared team view | People who can read the team | The owner, team managers |
  | Shared workspace view | Non-guests | The owner, admins |

  Only the owner changes who sees a view. Guests can make personal team views only (D-18).

## Consequences

- Narrow views over very large scopes still load the whole scope. If that shows up while
  dogfooding, push indexed conditions (team, assignee, state category) into the source query. The AST
  already carries them, so no format change is needed.
