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
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | `https://<staging domain>/callback` | leave unset (derived from branch URL) |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Sentry | Sentry |

Convex deployment env (each deployment): `WORKOS_CLIENT_ID`.

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
