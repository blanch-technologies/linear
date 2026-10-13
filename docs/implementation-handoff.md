# Implementation handoff: Linear-parity product on Convex + WorkOS

Written 2026-10-13. This is the single brief for the implementing model(s). It supersedes `docs/build-plan.md` wherever they disagree; `docs/parity-matrix.md` remains the feature inventory and gap tracker.

## How to read this document

- **Part A (Decided)** items have IDs `D-n`. Treat them as requirements. Do not relitigate them. If one is wrong or blocks you, stop, write the problem and a proposed alternative in `docs/blockers.md`, and continue with other work.
- **Part B (Open)** items have IDs `O-n`. You decide. Each lists the goal, constraints, and what to record (an ADR in `docs/adr/`). Pick the simplest option that meets the constraints.
- **Part C** is the phased work with acceptance criteria. **Part D** says what to take from the prototype. **Part E** is the first-session checklist and the questions to ask the human.

## Goal in one paragraph

Build a new, simple, deployable, multi-tenant issue tracker that matches Linear's functionality and interaction model, with the visual language of the prototype in this repo (`legacy/`). It must be usable by the owner daily (dogfooding on a deployed instance) and be on a clear path to enterprise sale (SSO, SCIM, audit, billing). It must be easy to iterate: closing a gap against Linear is a small change. Prefer off-the-shelf services and libraries over custom code.

---

# Part A: Decided

## A1. Product and process

- **D-1 Target.** Functional and interaction parity with Linear, with the prototype's visual language (see A5). Own product name, logo, icons, illustrations, and copy; never copy Linear's assets or text. Use the codename `blanch` in code and config until the owner supplies a name.
- **D-2 Prototype status.** `legacy/` is a requirements and styling reference only. It is not feature-complete, its architecture (Cloudflare D1, vanilla-JS string rendering, ChatGPT-header auth, generic JSON `records` table) is not carried forward, and its quality is not a signal that anything is sellable. Do not port code files wholesale.
- **D-3 Priorities.** `docs/parity-matrix.md` tiers rule scope. Build P0 first (the dogfood gate), then P1 (design-partner sellable), then P2. Do not start a tier before the previous tier's exit criteria are met, except for the Part C items marked parallel.
- **D-4 Dogfood gate.** Phase 2 ends when the owner runs real work in the deployed app for a week without falling back to Linear. Phases after that are driven by gaps found while dogfooding.
- **D-5 Simplicity rule.** Buy or reuse before building. A new dependency or service needs a one-line justification in its PR. Build custom only for product domain logic: issues, views, planning, inbox, team-level permissions.
- **D-6 Working rules.** Branches named `agent/<area>/<topic>`; PRs into `main`; never push to `main`. PRs under ~600 changed lines where possible, each with a description, screenshots for UI changes, and a test plan. Update the matching `docs/parity-matrix.md` row in the same PR. Record significant decisions as ADRs. No PR merges with failing typecheck, lint, unit, or affected e2e tests.

## A2. Stack (fixed)

- **D-7 App.** Next.js (App Router), React, TypeScript in strict mode, deployed on Vercel. One repository, one app. No monorepo or workspace packages until a second deployable exists. Package manager: pnpm. Node: current LTS, pinned in `.nvmrc` and `package.json` `engines`. Use the latest stable versions of every dependency at scaffold time, and pin exact versions in the lockfile; verify APIs against installed package docs, not memory.
- **D-8 Backend, database, realtime, files, jobs, search.** Convex (owner confirmed 2026-10-13; Supabase is not under consideration). Use Convex for the database, reactive queries, optimistic updates, file storage, scheduled functions/crons, HTTP actions (webhooks), and full-text search. Use Convex's first-party components where they fit (rate limiting, workpool/queues, aggregates, migrations, presence, Resend).
- **D-9 Identity.** WorkOS: AuthKit for login, Organizations for workspaces, RBAC for org roles, Admin Portal for customer-managed SSO/SCIM setup, Directory Sync for SCIM, Audit Logs for admin/security events, domain verification. Do not build a separate login system, password handling, or SSO code.
- **D-10 Billing.** Stripe, seat-based, Phase 5. Not before.
- **D-11 Email.** Resend for invitations and notification email.
- **D-12 UI.** Tailwind CSS with shadcn/ui components (owned in-repo under `src/components/ui`), Radix UI or Base UI primitives, `cmdk` for the command menu, `dnd-kit` for drag and drop, TanStack Virtual for long lists, `lucide-react` for icons (our own icon set; do not copy Linear's SVGs). Rich text: TipTap.
- **D-13 Testing.** Vitest (plus `convex-test` for Convex functions), Playwright for e2e and visual baselines, axe for accessibility checks on new screens.
- **D-14 Errors/observability.** Sentry for web and Convex; structured logs containing `organizationId` and a request ID, never request bodies or PII.

Repository layout (fixed top level; internals are open, see O-1):
```
convex/       schema.ts, domain folders, crons.ts, http.ts, lib/ (auth, permissions glue)
src/app/      App Router routes
src/components/ui/   shadcn components; src/components/ for feature components
src/lib/      pure TS: permissions, shortcuts registry, utils (no Convex or React imports in permissions)
e2e/          Playwright
scripts/      setup, seed, deploy helpers
docs/         this file, parity-matrix, ADRs, reference/ (copy of legacy docs)
legacy/       the prototype, read-only
```

## A3. Tenancy, identity, permissions

- **D-15 Tenancy.** One WorkOS Organization = one workspace. A user may belong to several. Every Convex table carries `organizationId`. The organization is resolved server-side from the authenticated identity on every function call; client-supplied `organizationId`, `userId`, or role are never trusted.
- **D-16 Roles.** Org roles: `owner`, `admin`, `member`, `guest`, sourced from WorkOS RBAC so SSO/SCIM group mapping works. At least one owner must always remain; the last owner cannot be removed, demoted, or suspended.
- **D-17 Team model.** Teams have a `key` (e.g. `ENG`), optional parent (up to 5 levels), and visibility `public` | `restricted` | `private`. Team membership lives in Convex.
  - `public`: any non-guest member can read and write.
  - `private`: only explicit members can read or write content. Owners and admins can see the team's name and key (so they can join) but not its issues, projects, or attachments without membership.
  - `restricted`: visible to members of the parent team and the team's own members; non-guests only. A restricted team requires a private parent.
  - Reparenting is admin-only. Membership in a parent grants management of children.
- **D-18 Guests.** Guests see only issues and projects in teams they are explicitly added to, plus their own inbox. No initiatives, no workspace member directory (only themselves), no workspace-wide search results outside their teams.
- **D-19 Single mutation path.** Every mutation and every query that returns tenant data goes through one wrapper in `convex/lib/` that: authenticates, resolves the organization and membership, calls the pure permission module (`src/lib/permissions`), and (for mutations) appends history/audit entries. Direct `ctx.db` access outside the wrapper's callbacks is forbidden and enforced by a lint rule or review checklist.
- **D-20 Permission tests first.** Before any feature depends on permissions, ship a role x team-visibility x action test matrix (owner, admin, member, guest, non-member, other-tenant; each against public/restricted/private; read, create, update, delete, move). Cross-tenant isolation tests run in CI forever.
- **D-21 Optimistic concurrency.** Issues, projects, documents, and initiatives carry a `version`; update mutations accept an optional `expectedVersion` and reject stale writes with a typed conflict error.
- **D-22 Audit.** Admin/security events (member join/remove/role change, team visibility change, export, API key creation, SSO config changes) go to WorkOS Audit Logs. Work-item history (field changes, comments, state transitions) goes to an append-only `issueHistory` table in Convex. These are different things; do not merge them.

## A4. Data model rules

- **D-23** Core entities are typed, first-class Convex tables: users, workspaces (mirrors the WorkOS org), memberships, invitations (mirror WorkOS), teams, teamMembers, workflowStates, issues, issueRelations, labels, issueLabels, comments, issueHistory, subscriptions, projects, projectTeams, milestones, projectUpdates, initiatives, cycles, savedViews, favorites, notifications, documents, attachments, issueTemplates, apiKeys, webhooks, integrationConnections, integrationLinks, exportJobs. Customers/customerRequests and releases are P2. No generic `records`/JSON-blob table for core entities.
- **D-24 Identifiers.** Each team has an atomic counter; issues get `ENG-123` identifiers that never change. Moving an issue to another team assigns a new identifier and keeps the old one as an alias that still resolves. URLs use the identifier.
- **D-25 Relations use IDs, never names.** Issue->project, issue->cycle, issue->milestone, project->teams. (The prototype linked projects by name; that is a known defect.)
- **D-26 Deletion.** Issues, projects, documents are soft-deleted (`deletedAt`), listed under "Recently deleted," restorable, and purged by a cron after 30 days. Attachments are retained until purge. Archiving (auto and manual) is separate from deletion.
- **D-27 Workflow states.** Per-team states with a category: `backlog`, `unstarted`, `started`, `completed`, `canceled`, plus `triage` when the team enables Triage. Each team has exactly one default state. Defaults on team creation: Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate.
- **D-28 Priority.** Fixed set: No priority, Urgent, High, Medium, Low (stored as 0-4).
- **D-29 Cycles.** Generated from the team's duration and start date (recurring), the current cycle derived from dates, unfinished issues roll over by team setting. Not manually flagged "current."
- **D-30 Triage.** Opt-in per team. External intake ("Asks") creates a normal issue in the Triage state. Triage actions: accept (to a chosen state), decline (to Canceled), snooze, mark duplicate. Triage issues are excluded from ordinary issue views.
- **D-31 Subscriptions and activity.** Persisted subscriber relation plus per-user notification records. "Subscribed" and "Activity" tabs derive from these, never from heuristics.
- **D-32 Pagination and indexes.** Every list query uses a purpose-built index and bounded pagination or virtual windows. A query that scans a whole table is a bug. Document each index's intended view in `convex/schema.ts` comments.

## A5. Visual and interaction spec (taken from the prototype)

The prototype's styling is the visual target. The source of truth is `legacy/app/linear.css` (tokens in its first line). Rebuild these as Tailwind theme tokens / CSS variables.

- **D-33 Dark theme tokens (default):**

  | Token | Value |
  |---|---|
  | bg | `#0f1012` |
  | sidebar | `#151619` |
  | surface | `#191a1e` |
  | surface2 | `#202126` |
  | surface3 | `#28292f` |
  | border | `#2a2b31` |
  | text | `#e4e5e8` |
  | muted | `#83858e` |
  | faint | `#5d5f68` |
  | accent | `#8e7cf8` (hover/pressed `#7465da`) |
  | green | `#5cb788` |
  | yellow | `#e4b560` |
  | red | `#df726f` |
  | blue | `#66a8e9` |
  | modal shadow | `0 22px 80px rgba(0,0,0,.55)` |

  Typography: Inter, 13px base. Status glyph is a 14px circle: dashed outline for backlog, empty outline for unstarted, filled `#ebaa69` for started, filled `#83bd9d` for completed, filled `#777985` for canceled/duplicate. Sidebar rail is 246px wide; sidebar items ~29px tall, nested team items ~27px with a left guide line. Issue page: sticky 47px header, main column plus a 260px property rail, max content width 1320px. Issue composer is a 760px modal. Mobile breakpoint 850px (sidebar becomes a drawer).
- **D-34 Light theme and system theme.** Ship `dark`, `light`, and `system` from the first release. Light tokens are derived to match the same hierarchy and contrast (the owner's real Linear workspace uses light by system preference). Both themes must pass WCAG AA contrast for text.
- **D-35 Keyboard model, minimum at launch.** `C` create issue, `Cmd/Ctrl+K` command menu, `/` search, `Esc` close/back out one layer, `Cmd/Ctrl+B` toggle list/board, `Cmd/Ctrl+Enter` submit forms, go-to sequences (`G` then `I` inbox, `M` my issues, `T` triage, etc.), and in lists/pages the property shortcuts (`S` status, `P` priority, `A` assign, `L` labels) acting on the focused or selected issue(s). Every shortcut registers in one registry that provides conflict detection and the help overlay.
- **D-36 Interaction bars.** Every user action is optimistic (UI updates before the server responds, rolls back on error with a toast). p95 optimistic response < 100 ms. Lists with more than ~200 rows are virtualized. All interactive elements are keyboard reachable with visible focus.
- **D-37 Structure fixes versus the prototype.** The prototype's own UX audit (`legacy/docs/ui-ux-parity-audit-2026-10-13.md`) lists structural gaps; the new app must have: routed issue pages with stable URLs and the sidebar visible; a writing-first composer with inline property pills and a "create more" toggle; a rich-text block editor for issue and project descriptions (not plain textareas); a sidebar organized as Inbox, My issues, then Workspace group (Projects, Views, Initiatives, More) and per-team nested items (Issues, Projects, Views); a routed Search page with All/Issues/Projects/Documents tabs, filters, recent searches, and a durable URL, with the command menu kept separate for actions and quick jump.
- **D-38 Pages in scope (from the prototype's navigation).** My issues (Assigned, Created, Subscribed, Activity), Inbox, Issues (per team: list/board, filters, display options), Projects, Project detail, Cycles, Cycle detail, Views (custom saved views), Initiatives, Initiative detail, Triage, Documents, Templates, Workflow statuses, Recently deleted, Search, Settings (members, teams, security, integrations, API, billing). Customers, Releases, and Dashboards/Insights are P2 and may be stubbed behind feature flags.

## A6. Environments, local run, deployment

- **D-39 Environments.** local (`pnpm dev` + `npx convex dev`, WorkOS staging environment), preview (Vercel preview + Convex preview deployment per PR), staging (`main`), production (promotion by tag). Production is also the owner's own workspace.
- **D-40 One-command start.** `pnpm i && pnpm setup && pnpm dev` must produce a running app. `pnpm setup` copies `.env.example`, validates variables through a typed env schema, and seeds demo data. Missing or malformed variables fail at boot with a clear message. `process.env` is read only in the env module.
- **D-41 Test auth.** E2E tests use a test-only auth path behind an env flag; the app refuses to boot with that flag in production.
- **D-42 CI/CD.** GitHub Actions: typecheck, lint, unit tests, Convex function tests, Playwright against the preview deployment. Merge to `main` auto-deploys to staging; a version tag promotes to production. `convex deploy` runs in the pipeline. Provide `docs/runbook.md` with deploy, rollback, and incident basics.
- **D-43 Customer deployment.** Default is multi-tenant SaaS. Keep dedicated per-customer deployment possible (no single-tenant hardcoding, no global mutable state), but do not build the provisioning script until requested.
- **D-44 Secrets.** Never in code, logs, or client bundles. Integration tokens are encrypted at rest. Webhooks are signed with replay protection. Public endpoints are rate-limited.

## A7. Non-goals for now

Native mobile apps, AI features, Linear-compatible API/importer (Phase 6), single-tenant provisioning, GitLab/Jira/Figma/etc. integrations, spreadsheet view, desktop push notifications.

---

# Part B: Open (you decide, within constraints)

| ID | Decision | Constraints and guidance | Record in |
|---|---|---|---|
| O-1 | Folder internals under `convex/` and `src/` | Group by domain (issues, teams, projects, ...), not by technical layer. Keep files small. | ADR if surprising |
| O-2 | Client state management (UI state, selection, drafts) | Convex hooks own server state. Use the lightest tool for UI-only state (React state/context, or Zustand if needed). No Redux. | ADR |
| O-3 | Large-list strategy | Run the Phase 1 spike (10,000 issues in one team: filter, sort, group, scroll). If p95 interaction exceeds the D-36 bars, add a client-side normalized cache fed by Convex subscriptions. Prove with numbers. | ADR with measurements |
| O-4 | Editor details | TipTap is fixed. You choose extensions, how mentions and issue links serialize, document storage format (ProseMirror JSON vs Markdown), and collaborative editing (not required at launch). Must support headings, lists, checklists, code blocks, links, images, `@mentions`, `#issue` links, slash menu, and markdown shortcuts. Store in a format that supports search and future export. | ADR |
| O-5 | Search implementation | Convex full-text search over issue title/description, projects, documents. Choose how to index rich text. Must return permission-filtered results only. | ADR |
| O-6 | Filter model | Must support AND/OR, all property types, and saved views serialization. Design a typed filter AST shared by client and server. | ADR |
| O-7 | Notification generation | Event-driven from `issueHistory`, written to `notifications` with per-user preferences. You choose batching/dedup. Email via Resend; digests are P1. | ADR |
| O-8 | Public API shape | REST with API keys first; GraphQL later if Linear-compat is pursued. Scopes and key hashing are yours to design; keys are hashed at rest. | ADR |
| O-9 | Timeline/roadmap rendering | P1/P2. Choose a library or custom canvas/SVG with virtualization. | ADR |
| O-10 | Component API details | Follow shadcn conventions. Variants, props, and composition are yours. | none |
| O-11 | Seed data content | Realistic, multi-team, multi-role, includes private/restricted teams, guests, 5k+ issues for perf. | scripts/seed |
| O-12 | Branch and release cadence details | Trunk-based by default. Change only with a reason. | runbook |
| O-13 | Telemetry/analytics product | Optional; privacy-respecting only. Ask the human before adding. | ADR |

---

# Part C: Phased work and acceptance criteria

Each phase ends in a deployed, demoable state. "Done" means merged, deployed to staging, tests passing, parity-matrix rows updated.

### Phase 0: Walking skeleton (target: days)
Scaffold; CI; Vercel + Convex + WorkOS wired; typed env schema; `.env.example`; `pnpm setup`; seed script; README with local-run and deploy steps; Sentry; design tokens (D-33/D-34) in Tailwind; base shadcn components; empty app shell; `docs/reference/` populated from the prototype's `docs/`; `docs/runbook.md` stub.
Acceptance: a new developer can run it locally from the README alone; the deployed URL shows the sign-in flow and, after login, an empty shell; a PR produces a preview deployment; CI is green.

### Phase 1: Spine (target: ~2 weeks)
Workspace creation and switching; invitations; roles; member management; teams (hierarchy, visibility, membership); workflow states; the permission module with the full D-20 test matrix and cross-tenant tests; mutation wrapper and history/audit plumbing; app shell (sidebar per D-37, top bar, command menu, shortcut registry and help overlay, theming); perf spike (O-3).
Acceptance: two users in two orgs cannot see each other's data (tested); private-team content is invisible to admins who are not members (tested); last-owner protection works; shell matches D-33 tokens and D-37 structure on desktop and mobile widths; spike results recorded.

### Phase 2: Core issues, the dogfood gate (target: ~4-5 weeks)
All P0 rows in `docs/parity-matrix.md`: issue CRUD and identifiers, routed issue page, composer, list and board, grouping/ordering/display options, filters and saved views, sub-issues, relations, labels, estimates, due dates, rich-text description, comments (threads, edit, delete, react, resolve, mentions), attachments, issue history, subscriptions, My issues, Inbox, Search page, favorites, soft delete/restore, notification email, keyboard coverage per D-35, optimistic updates throughout.
Acceptance: Playwright golden-path suite for each user story; visual baselines for list, board, issue page, composer, inbox, search; D-36 bars met on the 5k-issue seed; the owner migrates real work and runs a one-week trial; blockers become Phase 2 fixes before moving on.

### Phase 3: Planning and polish
Cycles, projects (multi-team, milestones, updates/health, documents), initiatives, roadmap/timeline, Triage, Documents, templates, bulk actions, team/project overview pages, settings parity, a visual polish pass.
Acceptance: the owner plans a full quarter in the tool; P1 planning rows verified against the owner's Linear.

### Phase 4: Integrations and API
GitHub app (PR/branch linking, status automation), Slack (unfurls, create-from-message, notifications), API keys and REST API, outbound webhooks (signed, retried, delivery log), MCP server rebuilt on the new model (the prototype's ~40-tool surface in `legacy/lib/mcp-server.ts` is the starting list), email digests.
Acceptance: merging a linked PR moves its issue; a Slack link unfurls; an API key can read and write only within its scope and is revocable; webhook deliveries are visible and replay-protected.

### Phase 5: Enterprise readiness (start compliance tooling during Phase 1)
SAML SSO and SCIM through WorkOS with role and team mapping; Audit Logs UI, export, and streaming; IP allowlist; domain verification and approved-domain join; data export (CSV and full backup); retention controls and purge; Stripe seat billing and invoices; status page; backup/restore drill; load test; external penetration test; SOC 2 readiness with an automation tool; draft DPA/terms.
Acceptance: a design partner onboards through the Admin Portal and billing with no engineering involvement.

### Phase 6: Switching and growth
Linear importer, Linear-compatible API/webhooks, mobile/PWA, AI triage, help center, dedicated-deployment script.

---

# Part D: Mining the prototype (`legacy/`)

| Take this | From | How |
|---|---|---|
| Visual tokens, spacing, status colors, layout dimensions | `app/linear.css` | Re-express as Tailwind theme (A5). Do not copy the CSS wholesale. |
| Screen list and what each contains | `public/linear.js`, `public/linear-workflows.js` (look at `render*`, `pageName`, `filterMenu`, `openIssue`, board/list code) | Reimplement as React routes/components. |
| Existing shortcuts | `public/linear.js` keydown handler (`Cmd+K`, `Cmd+B`, `C`, `/`, `Esc`) | Extend per D-35. |
| Permission semantics | `lib/workspace-server.ts` (`canReadTeam`, `canWriteTeam`, invitation join, IP allowlist), `app/api/admin/route.ts` | Re-derive into `src/lib/permissions` with the D-17/D-18 corrections and tests. Admin-sees-private-content in the original is a known bug. |
| Known divergences and pitfalls | `docs/nonlinear-functionality-audit.md` and `docs/ui-ux-parity-audit-2026-10-13.md` | Treat as a checklist of mistakes not to repeat; copy both into `docs/reference/`. |
| Triage, cycles, project-team rules | `app/api/records/route.ts` | Reimplement against typed tables (D-23, D-29, D-30). |
| Integration behavior | `lib/integrations/*`, `integrations/gateway/worker.ts`, `docs/integrations-setup.md` | Phase 4 reference for Slack/GitHub flows and webhook signature checks. |
| MCP tool list | `lib/mcp-server.ts`, `docs/mcp.md` | Phase 4 starting scope. |
| Export job and soft-delete behavior | `app/api/export/route.ts`, `lib/deleted-records.ts` | Concepts only. |

Do not reuse: the Cloudflare/D1/R2 layer, ChatGPT header auth, `build/` Sites tooling, `scripts/` installers, hash routing, the HTML-string renderers, or the `records` table design.

---

# Part E: First session

Do these in order.
1. Create the new repo (or branch `v2` if the owner says to keep one repo; ask, see below). Move the prototype into `legacy/` unchanged.
2. Copy the prototype's `docs/` into `docs/reference/`; keep this file, `build-plan.md`, and `parity-matrix.md` at `docs/`.
3. Read `legacy/app/linear.css` line 1 and the layout rules referenced in A5 so the Tailwind tokens match.
4. Scaffold per Part C Phase 0. Commit small, open a PR per milestone.
5. When Phase 0 acceptance is met, stop and request owner review before starting Phase 1.

Questions to ask the human (batch them; do not block unrelated work while waiting):
- Product name, domain, and logo direction (placeholder acceptable until Phase 4).
- New repo vs. restructuring this repo; GitHub org/repo to push to.
- Credentials/accounts to be created: Vercel team, Convex project(s), WorkOS staging and production environments, Resend, Sentry, Stripe (test mode, Phase 5).
- Confirmation of the parity-matrix tiers, especially anything the owner considers P0 that is listed as P1+.
- Reference material from the owner's real Linear workspace (screen recordings or screenshots per surface) to settle visual details the prototype lacks (light theme, animation timing, empty states).
- Design-partner candidates and their must-have integrations.

## Escalate rather than guess

Stop and ask the human before: changing anything in Part A; adding a paid service not listed; choosing a product name; sending real email or touching a production environment; weakening or skipping a permission test; any decision that would make tenant data cross organizations even in a test fixture.

---

# Part F: Owner decisions log

Recorded 2026-10-13. These resolve the Part E questions and are Decided (same force as Part A).

- **F-1 Product name.** The owner approved "Linear.Blanch" as the working name/domain. Use `blanch` as the code and package name. Flag for later: a name containing "Linear" may invite trademark objection; keep the display name, marketing copy, and logo in one config location so it can change in one edit.
- **F-2 Accounts.** The owner will provide Vercel, Convex, WorkOS (staging and production), Resend, Sentry, GitHub, and Stripe (test mode). Ask for credentials only when the phase needs them; Phase 0 needs GitHub, Vercel, Convex, WorkOS staging.
- **F-3 Tiers.** The P0-P3 tiering in `docs/parity-matrix.md` is confirmed as written.
- **F-4 Repository.** This is the new repo. The prototype lives in `legacy/` (read-only). Its original repo is `blanch-linear` and is not modified.
- **F-5 Convex** is confirmed (see D-8).
- **Still open for the owner:** Linear reference recordings for light theme, animation timing, and empty states; design-partner candidates.
