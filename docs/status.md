# Project status and hand-off notes

Last updated 2026-10-14. Read this after `CLAUDE.md` and before starting work. Keep it current:
update it in the same PR whenever the PR stack, external setup, or next steps change.

## Where things stand

- **Phase 0** (walking skeleton) and **Phase 1** (spine) are built. The owner asked to continue, so
  Phase 2 (core issues, the dogfood gate) is in progress.
- **PRs #1–#11 are merged into `main`** (2026-10-14), and merged branches are deleted automatically.
  - #12 (`agent/issues/lists`, list and board views) is an open draft against `main`.
  - Branch new work from `main`, unless it builds on #12; then branch from `agent/issues/lists`.
  - Check with `gh pr list --state all`.

## Remaining Phase 2 work (handoff Part C), in suggested order

1. **Finish #12** (list and board):
   - Board drag between columns has no e2e test yet.
   - Selection with shift-click ranges is still missing.
   - Re-run the O-3 harness (ADR 0005) on the real list against the 5k seed (`pnpm seed --perf`,
     `e2e/perf`).
2. **Routed issue page** `/<workspace>/issue/<ID>`:
   - Breadcrumbs, prev/next, copy ID/URL/branch (`branchName` in `src/lib/issues`).
   - Property rail (pickers exist), title, and description editor saving with `expectedVersion`.
   - Activity (`issues.activity`), sub-issues, relations, subscribe toggle, delete and restore.
   - Editor: `#issue` mentions (an `issueMention` node, see ADR 0006), a slash menu, and image upload
     to Convex storage.
3. **Comments:** threads, edit, delete, reactions, resolve, mentions, attachments. The tables exist;
   notifications follow ADR 0007.
4. **Inbox:** read, unread, snooze, archive, keyboard triage; generated from `notifications`.
   Favorites in the sidebar.
5. **Search page** (O-5): needs ADR 0009 (indexes exist: `search_title`, `search_description`).
   Saved views UI (the backend is in `convex/views.ts`). Recently deleted page (backend is
   `issues.recentlyDeleted`).
6. **Labels and estimates settings** in team settings (backends exist).
7. **Notification email** via Resend: blocked on credentials (docs/blockers.md #7). Ask the owner.
8. **Phase 2 acceptance:** a Playwright golden path per story, visual baselines, D-36 on the 5k seed,
   then the owner's one-week dogfood trial.

## External setup already done (don't redo)

- **WorkOS staging:** `owner` and `guest` roles plus 17 audit schemas (`pnpm workos:bootstrap`, which
  is idempotent).
- **Convex** (project `juice/blanch`):
  - Dev deployment `cool-lobster-948`; staging is the prod deployment `next-toad-464`.
  - `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` are set on both, and as preview defaults.
- **Vercel** (project `blanch`, Hobby): `BLANCH_TEST_AUTH=1` on Preview only. Previews and staging
  sit behind Vercel Authentication, and CI uses `VERCEL_AUTOMATION_BYPASS_SECRET`.
- **WorkOS demo organization "Acme (demo)"**, from `pnpm seed`, for the dev deployment.

## Owner decisions not in the handoff

- GitHub org `blanch-technologies`. Other tool clones will be sibling repos.
- The repo is public, because Vercel Hobby can't connect private org repos. Revisit before design
  partners.
- **Don't ask the owner to paste secrets in chat.** Set them with stdin-based commands, for example
  `... | pnpm exec convex env set NAME`.

## Gotchas

- **pnpm's release-age policy** rejects packages published in the last ~day. Pin an older release;
  don't add `minimumReleaseAgeExclude`.
- **The React Compiler lint** flags refs read in TipTap and TanStack callbacks. Suppress only with a
  comment explaining why (see `rich-text-editor.tsx`).
- **Schema changes that add required fields** need a backfill in `convex/migrations.ts`. Push once
  with `schemaValidation: false`, run the backfill, then restore validation.
- **Measure performance on production builds only.** Dev builds are about 2× slower.
- **The local dev server can serve stale CSS** after `globals.css` edits. Restart `pnpm dev`.
- **E2E users must be `@blanch.test`** (test auth refuses anything else). Keep the run prefix in any
  workspace you rename, so global teardown can delete it.

## Running checks without secrets

`pnpm typecheck`, `pnpm lint`, and `pnpm test` (unit plus Convex tests via convex-test) need no
credentials, because `convex/_generated` is committed. Signed-in e2e runs in CI against each PR's
preview deployment.
