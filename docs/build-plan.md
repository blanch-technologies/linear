# Build plan v2: a simple, deployable, iterable Linear alternative

Status: DRAFT for owner review. Rewritten 2026-10-13 (supersedes v1).
Audience: the owner and the build agents. Companion file: `docs/parity-matrix.md` (the feature inventory and gap tracker).

## 1. North star

Build a product that:
1. **Dogfood.** The owner runs real work in it, deployed, as customer #1.
2. **Iterate.** Closing a gap versus Linear is a small, cheap change in a simple codebase.
3. **Sell.** Enterprise buyers (SSO, SCIM, audit, billing, security posture) can be onboarded without custom engineering.
4. **Parity.** Functional and visual/interaction parity with Linear: the same information architecture, density, speed, and keyboard model. Own name, logo, icons, illustrations and copy (trademark and trade-dress safe). Layout and behavior parity is the goal; asset copying is not.

Guiding rule: **buy or reuse before building.** If WorkOS, Convex, Stripe, or a mature open-source library does it, we configure it. We only write code for the product itself: issues, planning, views, inbox, and permissions on top of them.

## 2. How we use the prototype in this repo

It is a requirements source, not a base to build on. It is not proof that anything is sellable or complete.

Mine it for: permission semantics (`lib/workspace-server.ts`), the audit of divergences from Linear (`docs/nonlinear-functionality-audit.md`, `docs/ui-ux-parity-audit-2026-10-13.md`), the MCP tool surface (`lib/mcp-server.ts`), and the Slack/GitHub event handling. Do not port code wholesale. The new repo gets this repo's docs copied into `docs/reference/` and nothing else.

## 3. Stack (kept deliberately small)

| Concern | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript strict, one repo, one app | No monorepo until we have a second deployable. Simple to run and deploy. |
| Hosting | Vercel | Preview deploy per PR, easy prod, easy rollback |
| Database, realtime, files, crons, search | **Convex** | Reactive queries and optimistic updates give Linear-style live UI; built-in file storage, scheduled jobs, full-text search; first-party components for rate limiting, workpools, aggregates, presence |
| Auth, orgs, SSO, SCIM, audit logs, domain verification | **WorkOS** | AuthKit login, Organizations, SAML/OIDC SSO, Directory Sync (SCIM), Audit Logs, Admin Portal for customer IT self-service, RBAC roles. Enterprise features arrive by configuration. |
| Billing | Stripe | Seat-based subscriptions and invoices |
| Email | Resend | Invitations, notifications, digests |
| UI | Tailwind + shadcn/ui on Radix/Base UI | Owned components, easy to match Linear's look |
| Command menu / shortcuts | cmdk + a small shortcut registry (tinykeys or react-hotkeys-hook) | Standard |
| Drag and drop / virtual lists | dnd-kit, TanStack Virtual | Board and large lists |
| Rich text | TipTap (ProseMirror) | Mentions, slash menu, markdown shortcuts, attachments |
| Tests | Vitest + `convex-test`, Playwright | |
| Errors | Sentry | |
| Package manager | pnpm | |

Repo shape (single app):
```
convex/            schema.ts, functions by domain (issues/, teams/, projects/, ...), crons, http (webhooks), lib/ (auth + permission helpers)
src/app/           routes (App Router)
src/components/    ui/ (shadcn), plus feature components
src/lib/           permissions (pure TS, shared w/ convex), shortcuts, utils
e2e/               Playwright
docs/              plan, parity matrix, ADRs, reference/ (prototype docs)
scripts/           seed, setup, deploy helpers
```
Permission rules live in one pure-TS module imported by Convex functions and by the client (for UI gating only). The server is the source of truth.

## 4. Key architecture decisions

- **Tenancy.** One WorkOS organization = one workspace. Every Convex table has `organizationId`, resolved server-side from the authenticated identity, never from client input. A user can belong to several workspaces.
- **Roles.** Org-level roles (owner, admin, member, guest) come from WorkOS RBAC, so SSO/SCIM group mapping works out of the box. Team-level access (public/restricted/private teams, membership) lives in Convex.
- **Data model.** Typed first-class tables: users, workspaces, teams, teamMembers, workflowStates, issues, issueRelations, labels, comments, issueHistory (append-only), subscriptions, projects, milestones, projectUpdates, initiatives, cycles, savedViews, favorites, notifications, documents, attachments, apiKeys, webhooks, integrations. No generic JSON `records` table.
- **Mutation path.** All writes go through one wrapper: authenticate -> load membership -> check permission -> write -> append history/audit. Direct table writes elsewhere are forbidden (lint rule + review).
- **Speed.** Convex optimistic updates for every interaction; virtualized lists; indexes designed up front for the main views. A Wave 1 spike loads 10,000 issues and validates filter/sort/group latency. Fallback if it fails: a client-side normalized cache layer over Convex subscriptions. We decide on evidence, not now.
- **Audit.** Use WorkOS Audit Logs for admin/security events (customer-visible, exportable, streamable) and our `issueHistory` for work-item history.
- **Deletion.** Soft delete with Recently deleted and a 30-day purge cron (matches the lesson in the old audit).
- **Feature flags.** A tiny flags module so unfinished work ships dark.
- **Schema migrations.** Use Convex's migrations component; every schema change is additive-first.

## 5. Environments, local run, and deploy (must work from day 3)

Environments
| Env | Frontend | Convex | WorkOS | Purpose |
|---|---|---|---|---|
| local | `pnpm dev` | local/dev deployment via `npx convex dev` | staging environment | Day-to-day dev |
| preview | Vercel preview per PR | Convex preview deployment per PR | staging | Review and e2e |
| staging | Vercel (main branch) | staging deployment | staging | Pre-release checks |
| production | Vercel (release tag/promotion) | production deployment | production | The owner's real workspace (dogfood) and customers |

One-command local setup: `pnpm i && pnpm setup && pnpm dev`. `pnpm setup` copies `.env.example`, validates required variables with a typed env schema, and runs the seed. Missing or invalid variables fail loudly at boot. A test-only auth bypass for e2e is guarded by an env flag that production refuses to start with.

Deploy: merge to `main` -> CI (typecheck, lint, tests, e2e on preview) -> auto-deploy to staging -> promote to production by tag. `convex deploy` runs in the pipeline with the Vercel build. Rollback is a Vercel promotion plus a Convex function redeploy, documented in a runbook.

Customer deployment models
1. **Default: multi-tenant SaaS** (all customers on production, isolated by organization).
2. **Dedicated deployment** for enterprises that demand it: a script provisions a separate Convex project + Vercel project + WorkOS environment from the same code. Keep this possible by never hard-coding single-tenant assumptions. Build the script only when a customer asks.
3. Convex is open source and self-hostable, which is a later fallback for regulated customers.

## 6. Dogfooding loop (built in from the start)

- The owner's team runs on production from the end of Phase 2. A separate staging workspace exists for experiments.
- An in-app "Send feedback / report gap" action creates an issue in the product's own workspace tagged `parity-gap`. `docs/parity-matrix.md` is the human-readable index; the live backlog is the product itself.
- Weekly review: triage gaps, move items between tiers, ship a patch release. Small, frequent releases are the point of the simple stack.

## 7. Parity strategy (functional and visual)

Reference: the owner's real Linear workspace, used as the oracle. Agents work from screenshots and walkthroughs recorded per surface.

- **Parity matrix** (`docs/parity-matrix.md`): every Linear surface and feature with a tier (P0 dogfood gate, P1 design-partner, P2 parity-complete, P3 later or skip), status, owner agent, and acceptance criteria.
- **Visual spec first.** Phase 0 produces a design-token sheet (color ramps for light and dark, type scale, spacing, radii, shadows, motion timings, icon set, row heights/density) measured from the reference, implemented in Tailwind config. Components are built to match. Own icon set (e.g. Lucide) and own illustrations.
- **Surface checklists.** Each major surface (issue list, board, issue page, composer, sidebar, command menu, inbox, project page, cycle page, settings) has a checklist: layout, density, hover/focus states, keyboard shortcuts, empty states, loading states, animations.
- **Screenshot tests.** Playwright visual baselines of our own app, reviewed by the owner against the reference; updated deliberately.
- **Keyboard parity.** A shortcut table (create issue `C`, command menu `Cmd+K`, go-to sequences, set status/priority/assignee/label from the list, etc.) is part of the matrix and tested in e2e.

## 8. Phases

Each phase ends with a deployable, demoable state. Time estimates assume a team of agents with one human reviewer; they are rough.

### Phase 0: Walking skeleton (about 3-5 days)
- New repo, scaffold, CI, Vercel + Convex + WorkOS wired. A signed-in user lands on an empty app shell on a real URL. Preview deploys per PR. `.env.example`, `pnpm setup`, seed script, README, runbook stub.
- Design tokens and base components (button, input, menu, dialog, tooltip, kbd, avatar, badge).
- Parity matrix reviewed and tiered by the owner.
Exit: owner can run it locally and open the deployed URL, sign in with WorkOS, create a workspace.

### Phase 1: Spine (about 2 weeks)
- Workspaces/orgs, invitations (WorkOS), roles, guest handling, last-owner protection, member management UI.
- Teams (hierarchy, visibility), team membership, workflow states per team.
- Permission module with a full role x visibility x action test matrix, and cross-tenant isolation tests.
- App shell: sidebar matching Linear's structure, top bar, workspace switcher, command menu with action registry, shortcut registry and help overlay, routing conventions, loading/empty/error states, dark and light themes.
- Perf spike: 10,000-issue dataset.
Exit: two users in two orgs see only what they should; shell feels like Linear; perf spike result recorded in an ADR.

### Phase 2: Core issues, the dogfood gate (about 4-5 weeks)
All P0 items in the matrix: issue CRUD with atomic identifiers (`ENG-123`), routed issue page, composer, list view with grouping/ordering/display options, board with drag and drop, filters and saved views, comments and threads, labels, assignee, priority, estimate, due date, sub-issues, relations, rich-text description, attachments, issue history, subscriptions, My Issues, Inbox, search, favorites, soft delete/restore, full keyboard coverage, notification emails.
Exit: **the owner moves their real work in and uses it for a full week with no fallback to Linear.** Production deploy is live. This is the gate to continue.

### Phase 3: Planning and polish (about 4 weeks)
Cycles, projects (multi-team, milestones, updates, health), initiatives, roadmap/timeline, Triage, documents, templates, bulk actions, team/project overview pages, settings parity, visual polish pass against the reference. Gaps found while dogfooding are fixed here first.

### Phase 4: Integrations and API (about 3 weeks)
GitHub app (PR/branch linking, status automation), Slack (unfurls, issue creation, notifications), public API keys, outbound webhooks (signed, retried, delivery log), MCP server (rebuilt against the new model), email digests.

### Phase 5: Enterprise readiness (about 4-6 weeks, overlaps; start compliance tooling in Phase 1)
SAML SSO + SCIM via WorkOS Admin Portal with role/team mapping, WorkOS Audit Logs in UI + export/streaming, IP allowlist, approved-domain join, data export (CSV + full backup), retention controls, Stripe billing (seats, invoices, upgrade/downgrade), status page, backup and restore drill, load test, external penetration test, SOC 2 readiness with an automation tool, terms/DPA drafts.
Exit: a design partner onboards end to end with no engineering help.

### Phase 6: Switching and growth
Linear importer (API/CSV), compatibility webhooks/API, mobile/PWA, AI triage, help center, the dedicated-deployment script.

## 9. Agent team (lean)

| Agent | Scope |
|---|---|
| Foundation | Scaffold, CI/CD, environments, auth wiring, env schema, seed, runbooks, Sentry |
| Design system | Tokens, components, shell, command menu, shortcut registry, visual-parity checklists and screenshot tests |
| Core (backend) | Schema, permission module, mutation wrapper, history/audit, performance and indexes |
| Issues | Everything in P0 issues surfaces (list, board, composer, issue page, filters, views) |
| Editor and comments | TipTap, mentions, attachments, comments |
| Planning | Cycles, projects, initiatives, roadmap, triage, documents |
| Inbox and search | Notifications, inbox, search, favorites, email |
| Integrations and API | GitHub, Slack, API keys, webhooks, MCP |
| Enterprise | WorkOS SSO/SCIM/audit, billing, export/retention, compliance evidence |
| QA | Playwright, seed data, perf budgets, accessibility, parity verification |
| Reviewer / Security (gates) | Review every PR; security review for auth, permissions, uploads, integrations, secrets |

Early phases run with Foundation, Design system, and Core only. Add feature agents once the permission module and shell are merged, so they build on stable contracts.

## 10. Working rules for agents

- Branch `agent/<area>/<topic>`, PR into `main`, never push to `main`. Small PRs (aim under ~600 lines) with description, screenshots for UI, and a test plan.
- Only Core edits `convex/schema.ts`; others request changes via PR comment or `docs/schema-requests.md`. Shared contracts (`src/lib/permissions`, shared types) change by PRs labeled `contract` that list consumers.
- All mutations use the mutation wrapper; never trust client-supplied `organizationId`, `userId`, or role. Negative tests (forbidden actor rejected) required for permission-sensitive code.
- No PR merges without typecheck, lint, unit, and affected e2e green, plus reviewer approval (security approval where listed).
- UI primitives come from `src/components/ui`; shortcuts register through the registry; env vars come from the typed env schema; no secrets in code or logs.
- Use off-the-shelf first. New dependencies need a one-line justification in the PR.
- Every interaction is optimistic and keyboard-accessible; accessibility (axe) checks on new screens.
- Update `docs/parity-matrix.md` status in the same PR as the feature. Record significant decisions as ADRs in `docs/adr/`.
- Blocked? Write it to `docs/blockers.md` and take the next task.

## 11. Quality bars

- Interaction: optimistic UI response p95 < 100 ms; issue page first load < 1.5 s; 60 fps scroll on 2,000+ rows.
- Security: tenancy and permission tests in CI; dependency audit in CI; rate limits on public endpoints (Convex rate-limiter component); signed, replay-protected webhooks; secrets encrypted at rest.
- Reliability: idempotent crons and webhooks; backups documented and drilled; error budget tracked in Sentry.
- Product: every Phase 2+ user story has a Playwright test.

## 12. What the owner provides

- Product name, domain, and logo direction (a placeholder is fine until Phase 4).
- Accounts: GitHub org/repo, Vercel, Convex, WorkOS (staging and production environments), Stripe (test mode), Resend, Sentry.
- Reference access: recorded walkthroughs or screenshots of the owner's Linear workspace for each surface, plus the tiering decisions in the parity matrix.
- 2-3 design-partner candidates with their must-have integrations (reorders Phases 3-5).
- Final calls: confirm Convex over Supabase; accept the perf-spike fallback plan.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Large lists feel slower than Linear | Early perf spike (Phase 1), indexes designed up front, virtualization, fallback client cache |
| Convex lock-in | Permission and domain logic in pure TS; thin data-access layer; Convex is open source |
| Chasing full parity delays selling | Tiered matrix; P0/P1 define sellable; P2/P3 are backlog |
| Agent merge conflicts | Single repo with feature-folder ownership, schema ownership, small PRs, daily main health check |
| Permission regressions | Matrix tests, cross-tenant tests, security gate |
| SOC 2 delays enterprise sales | Compliance tooling from Phase 1; WorkOS and Convex vendor attestations reused |
| Trademark / trade dress | Own brand and assets; parity is layout and behavior |

## 14. Kickoff checklist

1. Owner confirms Section 12 items and the stack in Section 3.
2. Create the new repo; copy `docs/` from this repo into `docs/reference/`.
3. Owner tiers the parity matrix (P0-P3).
4. Start Phase 0 with Foundation and Design system agents; Core joins once the scaffold is merged.
5. Gate: Phase 0 exit (deployed URL + local run), then Phase 1 exit, then the Phase 2 dogfood gate before investing in Phases 3-5.
