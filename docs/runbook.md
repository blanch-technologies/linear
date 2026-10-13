# Runbook

Stub created in Phase 0. Expand as environments come online. Topology: [ADR 0001](adr/0001-environments-and-deployment.md).

## Environments

| Env | Web | Backend | Auth | Deployed by |
|---|---|---|---|---|
| local | `pnpm dev` | Convex dev deployment (cloud or local) | WorkOS staging | developer |
| preview | Vercel preview per PR | Convex preview deployment | WorkOS staging | push to a PR branch |
| staging | Vercel `blanch`, production branch `main` | Convex staging project, prod deployment | WorkOS staging | merge to `main` |
| production | Vercel `blanch-production` | Convex production project | WorkOS production | `v*` tag (`release.yml`) |

### Vercel environment variables (`blanch` project)

| Variable | Production (staging) | Preview |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | staging Convex production deploy key | staging Convex preview deploy key |
| `WORKOS_CLIENT_ID`, `WORKOS_API_KEY` | WorkOS staging | WorkOS staging |
| `WORKOS_COOKIE_PASSWORD` | random, 32+ chars | random, 32+ chars |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | optional; defaults to `https://$VERCEL_PROJECT_PRODUCTION_URL/callback` | leave unset (derived from branch URL) |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Sentry | Sentry |
| `BLANCH_TEST_AUTH` | never (the app refuses to boot) | `1`: e2e signs in `@blanch.test` users (D-41) |

Convex deployment env: `WORKOS_CLIENT_ID` (token validation) and `WORKOS_API_KEY` (actions call
WorkOS). Both are set on the staging prod deployment, on the dev deployment (`pnpm setup` does it),
and as project defaults for preview deployments (`convex env default set ... --type preview`). Set
secrets from stdin so they stay out of shell history: `... | pnpm exec convex env set WORKOS_API_KEY`.

### WorkOS environment setup

Run `pnpm workos:bootstrap` once per WorkOS environment (it is idempotent, and `pnpm setup` runs it
for staging). It creates the `owner` and `guest` roles next to WorkOS's built-in `admin` and
`member` (D-16). It also creates one Audit Log schema per action in `convex/lib/auditActions.ts`.
After adding or changing an audit action, run it again for every environment. Production keys
(`sk_live_...`) need `--production`.

Invitations are WorkOS invitations, and WorkOS sends the email. The accept link returns to the
environment's **default redirect URI**, so in the shared staging environment invitees land on that
URI. For dogfooding, point it at staging. Resend-delivered invitations (D-11) replace WorkOS email
later.

### Audit log delivery

Admin events are written to the `auditEvents` outbox in the same transaction as the change.
`audit.deliver` then sends them to WorkOS with retries, and an hourly cron re-sends any lost ones.
- A row with `status: "failed"` has failed 8 times. Its `lastError` says why: usually a schema that
  doesn't match, which means rerun `pnpm workos:bootstrap`.
- To retry it, patch the row back to `pending` in the Convex dashboard. The next sweep sends it.

### Current resources

| Thing | Value |
|---|---|
| GitHub | `blanch-technologies/linear` (public: Vercel Hobby can't connect private org repos) |
| Vercel project | `charlesmeng18s-projects/blanch` (Hobby) |
| Convex project | `juice/blanch`; staging = prod deployment `next-toad-464`; dev = `cool-lobster-948` |
| WorkOS | staging environment, bootstrapped (roles, audit schemas); redirects: `http://localhost:3000/callback`, `https://blanch-git-*-charlesmeng18s-projects.vercel.app/callback` |

GitHub repo secrets: `VERCEL_AUTOMATION_BYPASS_SECRET` (E2E), and later `VERCEL_TOKEN` plus the
variables `VERCEL_ORG_ID`, `VERCEL_PRODUCTION_PROJECT_ID`, and `PRODUCTION_ENABLED` (release).

## Deploy

- Staging: merge a PR into `main`. Vercel builds, and the build runs `convex deploy` first.
- Production: `git tag vX.Y.Z && git push origin vX.Y.Z` (once `PRODUCTION_ENABLED` is set).

## Roll back

- Web: Vercel dashboard → Deployments → previous deployment → Promote (or `vercel rollback`).
- Convex functions: redeploy the previous commit (`git checkout <sha> && pnpm exec convex deploy`).
  Schema changes must stay backward compatible for one release so that this is always safe.

## Incident basics

1. Check Sentry for the error spike and the Vercel and Convex dashboards for logs. Logs carry
   `organizationId` and a request ID, never bodies or PII (D-14).
2. If a deploy caused it, roll back first and debug second.
3. Write a short note in `docs/incidents/YYYY-MM-DD-<slug>.md`: impact, timeline, cause, follow-ups.

## Health

`GET /api/health` returns `{ "ok": true }` without authentication.
