# ADR 0001: Environments and deployment topology

Status: accepted (Phase 0), 2026-10-13

## Context

D-39 and D-42 require local, preview (one per PR), staging (`main`), and production (promoted by tag)
environments, with `convex deploy` in the pipeline and Playwright run against previews.

## Decision

- **Vercel Git integration** builds every push. `vercel.json` sets the build command to
  `convex deploy --cmd 'pnpm build'`, so Convex functions and the Next.js build ship together and
  `NEXT_PUBLIC_CONVEX_URL` is injected by Convex at build time.
- **Staging** is the Vercel project `blanch` with production branch `main`. Its Production
  environment holds a Convex **production** deploy key for the staging Convex project.
- **Previews** use a Convex **preview** deploy key in the Vercel Preview environment, so each branch
  gets its own Convex preview deployment. Until preview keys are available on the Convex plan,
  previews point at the staging Convex dev deployment via `NEXT_PUBLIC_CONVEX_URL` and skip
  `convex deploy` (see `docs/blockers.md`).
- **AuthKit on previews**: the callback is derived from `VERCEL_BRANCH_URL`
  (`src/lib/env/schema.ts#workosRedirectUri`), so one wildcard redirect URI in the WorkOS staging
  environment (`https://*-<scope>.vercel.app/callback`) covers every branch.
- **Production** will be a second Vercel project (Git deploys disabled) and a separate Convex
  project, deployed by `.github/workflows/release.yml` on a `v*` tag. The workflow is inert until
  the `PRODUCTION_ENABLED` repository variable is `true`. Production is also the owner's workspace.
- **CI** (`.github/workflows/ci.yml`) runs typecheck, lint, and unit and Convex tests on every PR
  and on `main`. **E2E** (`.github/workflows/e2e.yml`) runs on Vercel's `deployment_status`
  event for previews, using `VERCEL_AUTOMATION_BYPASS_SECRET` to pass deployment protection.
- **Local** uses `convex dev`, either against a cloud dev deployment or Convex's account-free local
  backend, plus the WorkOS staging environment.

## Consequences

- Two Vercel projects and two Convex projects to keep in sync; the runbook lists the environment
  variables each one needs.
- Separate staging and production Convex projects keep production data out of reach of preview
  and staging deploy keys.
