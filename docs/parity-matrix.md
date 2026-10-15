# Parity matrix: our product versus Linear

Draft tiering, to be confirmed by the owner. Written 2026-10-13 from general knowledge of Linear plus the prototype's audits; verify each row against the owner's real Linear workspace before building.

Tiers: **P0** dogfood gate (needed to run real work), **P1** design-partner sellable, **P2** full parity, **P3** later or skip.
Status values: `todo`, `in progress`, `done`, `verified` (owner confirmed against Linear).
Every row needs, when picked up: acceptance criteria, owner agent, and keyboard and visual checklist items (see build plan section 7).

## Issues

| Feature | Tier | Notes / acceptance | Status |
|---|---|---|---|
| Create issue (composer, `C`, inline property pills, create-more) | P0 | Composer with rich description, status/priority/assignee/labels/estimate/due pills, create more, drafts (Phase 2); project/cycle with Phase 3 | in progress |
| Routed issue page with stable URL, breadcrumbs, prev/next, copy ID/URL/branch | P0 | `/<workspace>/issue/<ID>` with the sidebar visible; aliases redirect; breadcrumbs (team › parent › ID); prev/next follows the list it came from (J/K); ⌘. ⌘⇧, ⌘⇧. copy ID, URL, and branch; Esc goes back; `e2e/issue-page.spec.ts` (PR #13) | done |
| Properties: status, priority, assignee, labels, estimate, due date, project, cycle, milestone | P0 | Each editable from list, board, page, and keyboard | todo |
| Sub-issues and parent | P0 | Hierarchy cycle prevention; sub-issue list with done count, add sub-issue via the composer, parent picker in the rail (PR #13) | done |
| Relations: blocks, blocked by, related, duplicate | P0 | Relations section: add (type, then issue search via `issues.quickSearch`), remove, shown from both sides (PR #13) | done |
| Rich-text description (headings, lists, code, links, images, mentions, slash menu) | P0 | TipTap editor with markdown shortcuts, task lists, safe links, @mentions (ADR 0006); images, #issues, slash menu with the issue page | in progress |
| Comments: threads, edit, delete, reactions, resolve, mentions | P0 | | todo |
| Attachments and file upload | P0 | 10 MB+ limit, authorized downloads | todo |
| Issue history / activity timeline | P0 | Append-only `issueHistory`; activity timeline on the issue page with wording in `src/lib/issues/activity.ts` (PR #13); comments interleave later | in progress |
| Subscriptions and notifications on changes | P0 | ADR 0007; generated in the write path; subscribe toggle and Shift+S on the issue page (PR #13); inbox UI next | in progress |
| Soft delete, Recently deleted, restore, archive | P0 | 30-day purge cron; delete with undo and restore on the issue page (PR #13); Recently deleted page and archive later | in progress |
| Bulk select and actions | P1 | | todo |
| Issue templates | P1 | | todo |
| Estimates (points / t-shirt / exponential) | P1 | Team setting | todo |
| Priority/SLA rules | P2 | | todo |
| Customer requests / needs linked to issues | P2 | | todo |
| Issue links to GitHub PRs, branches | P1 | Phase 4 | todo |
| Sub-issue progress, roll-ups | P1 | | todo |
| Merge/duplicate handling | P1 | | todo |

## Views

| Feature | Tier | Notes | Status |
|---|---|---|---|
| List view with grouping, sub-grouping, ordering, display properties | P0 | Virtualized list, grouping, ordering, display options, keyboard, X/shift-click/⌘-click/shift+J/K selection with bulk edits (PR #12); passes the ADR 0005 gate on 10k issues; sub-grouping later | in progress |
| Board view with drag and drop between states | P0 | dnd-kit board, moves change the grouped property; empty status and priority columns always shown as drop targets; drag e2e in `e2e/lists.spec.ts` (PR #12) | in progress |
| Filters (AND/OR, all property types), quick filters | P0 | AST + evaluation + serialization (ADR 0008); UI with the list | in progress |
| Saved/custom views (personal and shared), favorites | P0 | Saved views backend with scopes (ADR 0008); UI later | in progress |
| Search page with tabs (All, Issues, Projects, Documents) | P0 | Convex full-text | todo |
| Timeline / Gantt view | P2 | | todo |
| Split / peek issue panel | P1 | | todo |
| Spreadsheet-like view | P3 | | todo |

## Personal surfaces

| Feature | Tier | Notes | Status |
|---|---|---|---|
| My Issues (assigned, created, subscribed, activity) | P0 | Tabs from assignments, authorship, subscriptions, history (PR #12) | in progress |
| Inbox (read/unread, snooze, delete, filters, keyboard triage) | P0 | | todo |
| Notification preferences (in-app, email, per type) | P1 | | todo |
| Email notifications and digests | P1 | Resend | todo |
| Desktop/mobile push | P3 | | todo |

## Planning

| Feature | Tier | Notes | Status |
|---|---|---|---|
| Cycles: recurring generation, current/upcoming, rollover, cycle page | P1 | Dates drive current cycle | todo |
| Cycle analytics (scope, burn-up) | P2 | | todo |
| Projects: lead, members, status, priority, target date, multi-team | P1 | Stable IDs, not names | todo |
| Project milestones | P1 | | todo |
| Project updates / health | P1 | | todo |
| Project documents and resources | P1 | | todo |
| Project dependencies | P2 | | todo |
| Initiatives and sub-initiatives | P1 | | todo |
| Roadmap view | P1 | | todo |
| Triage queue (accept, decline, snooze, duplicate) | P1 | Opt-in per team | todo |
| Asks (external intake from Slack/email) | P2 | Becomes a Triage issue | todo |
| Documents (standalone docs) | P1 | | todo |
| Insights / analytics | P2 | Needs warehouse or aggregates | todo |
| Releases / release pipelines | P2 | | todo |

## Workspace, teams, and settings

| Feature | Tier | Notes | Status |
|---|---|---|---|
| Workspaces, switching, creation | P0 | One WorkOS org each (ADR 0004). Onboarding, `/<workspace>` routes, switcher, rename; e2e in `e2e/workspaces.spec.ts` | done |
| Members and roles (owner, admin, member, guest) | P0 | WorkOS RBAC; last-owner rule, suspend, remove (ADR 0003/0004); Members settings page; e2e in `e2e/members.spec.ts` | done |
| Invitations (email, revoke) | P0 | WorkOS invitations: invite (bulk), copy link, resend, revoke; Resend email later (blockers #7) | done |
| Teams: hierarchy, public/restricted/private visibility, membership | P0 | ADR 0003 and the D-20 matrix; settings: list, create, sub-teams, visibility, reparent, delete, members, join/leave; e2e in `e2e/teams.spec.ts` | done |
| Workflow states per team (categories, order, default) | P0 | D-27 defaults, one default, one per required category; settings: add, edit, color, reorder, default, delete with issue reassignment | done |
| Labels (workspace and team, groups) | P0 | One label per group; delete detaches from issues (backend done) | in progress |
| Team settings: triage, cycles, estimates, templates, auto-archive | P1 | | todo |
| Workspace settings: name, URL, logo, preferences | P1 | | todo |
| Keyboard shortcuts overlay and customization | P1 | Overlay generated from the registry (Phase 1); customization later | in progress |
| Themes (light, dark, system) | P0 | Tokens and user-menu toggle shipped in Phase 0 (ADR 0002); light values provisional pending Linear references | in progress |
| Import/export (CSV, full backup) | P1 | | todo |
| Linear importer | P2 (Phase 6) | | todo |

## Integrations and API

| Feature | Tier | Notes | Status |
|---|---|---|---|
| GitHub (PR/branch linking, status automation) | P1 | | todo |
| Slack (unfurls, create issue, notifications) | P1 | | todo |
| Public API keys and REST/GraphQL API | P1 | Scoped keys | todo |
| Outbound webhooks | P1 | Signed, retried | todo |
| MCP server | P1 | Tool list in docs/reference | todo |
| GitLab, Sentry, Figma, Zendesk, Intercom, etc. | P3 | On customer demand | todo |
| Linear-compatible API/webhooks | P2 (Phase 6) | Reduces switching cost | todo |

## Enterprise

| Feature | Tier | Notes | Status |
|---|---|---|---|
| SAML SSO | P1 | WorkOS | todo |
| SCIM provisioning and group mapping | P1 | WorkOS Directory Sync | todo |
| Audit log (view, export, streaming) | P1 | WorkOS Audit Logs | todo |
| Domain verification, approved-domain join | P1 | WorkOS | todo |
| IP allowlist | P1 | | todo |
| Billing: seats, invoices, plan limits | P1 | Stripe | todo |
| Data retention and purge controls | P1 | | todo |
| SOC 2, DPA, pen test | P1 | Process work, start early | todo |
| Dedicated (single-tenant) deployment | P2 | On demand | todo |
| Admin approval for third-party apps | P3 | | todo |

## Visual and interaction parity (applies to every row)

| Area | Tier | Notes | Status |
|---|---|---|---|
| Design tokens: color ramps, type scale, spacing, radii, shadows, motion | P0 | Measured from reference. Colors, layout dimensions, modal shadow in `globals.css` (Phase 0); type scale and motion pending | in progress |
| Dark and light themes | P0 | AA contrast enforced by `src/lib/theme/contrast.test.ts` | in progress |
| Sidebar structure and behavior | P0 | D-37 structure, 246px rail, drawer under 850px; workspace menu, collapsible groups, nested team items with guide line (Phase 1) | in progress |
| Command menu (`Cmd+K`) with contextual actions | P0 | Navigation, teams, workspace actions, switch workspace, theme, help (Phase 1); issue actions arrive with issues | in progress |
| Global keyboard model (go-to sequences, list actions) | P0 | Single registry with conflict test (`src/lib/shortcuts`), help overlay (`?`), `/`, G-sequences, Esc, ⌘Enter; list/property keys in Phase 2 | in progress |
| Row density, hover/selected/focus states, icons | P0 | Own icon set | todo |
| Empty, loading, error states | P0 | | todo |
| Animations and transitions | P1 | | todo |
| Responsive/mobile web | P2 | | todo |
| Screenshot baselines per surface | P1 | | todo |
