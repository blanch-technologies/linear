# blanch

Linear-parity issue tracker (working name **Linear.Blanch**). Next.js + Convex + WorkOS, deployed on Vercel.

- Brief and requirements: [`docs/implementation-handoff.md`](docs/implementation-handoff.md)
- Scope and status: [`docs/parity-matrix.md`](docs/parity-matrix.md)
- Decisions: [`docs/adr/`](docs/adr) · Deploys and incidents: [`docs/runbook.md`](docs/runbook.md) · Open blockers: [`docs/blockers.md`](docs/blockers.md)
- `legacy/` is the read-only prototype (styling and requirements reference only).

## Run it locally

Prerequisites: Node 24 (`nvm use`), pnpm 12 (`npm i -g pnpm`), and a WorkOS **staging** environment
(client ID and API key from dashboard.workos.com → API keys). In the WorkOS dashboard, under
Redirects, add `http://localhost:3000/callback` as a redirect URI, `http://localhost:3000/sign-in`
as the initiate login URI, and `http://localhost:3000` as the sign-out redirect.

```sh
pnpm i
pnpm setup   # creates .env.local, asks for WorkOS keys, creates a Convex dev deployment, seeds
pnpm dev     # Next.js on :3000 and `convex dev`, together
```

Open http://localhost:3000. You are sent to AuthKit to sign in, then land on the empty app shell.
The line under the empty state should read "Connected as <your email>", which confirms that Convex
accepted your WorkOS token.

`pnpm setup` is safe to re-run. When `convex dev` asks, either log in to Convex for a cloud dev
deployment or choose to run locally without an account.

### Environment

All variables are listed in [`.env.example`](.env.example) and validated by
[`src/lib/env/schema.ts`](src/lib/env/schema.ts). A missing or malformed variable stops the app at
boot with a message naming it. Application code never reads `process.env` directly (lint-enforced);
it imports `clientEnv` or `serverEnv` from `src/lib/env`.

Convex has its own environment. `WORKOS_CLIENT_ID` must be set there too (`pnpm setup` does it), so
Convex can verify AuthKit tokens (`convex/auth.config.ts`).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server and Convex dev watcher |
| `pnpm setup` | One-time and repeatable local setup |
| `pnpm seed` | Re-run the seed mutation against the current Convex deployment |
| `pnpm typecheck` | Next route types, then `tsc` for the app and for `convex/` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest: unit tests (`src/**/*.test.ts`) and Convex function tests (`convex/**/*.test.ts`) |
| `pnpm e2e` | Playwright (starts `pnpm dev` unless `PLAYWRIGHT_BASE_URL` is set) |
| `pnpm build` | Production build |

## Layout

```
convex/              schema, functions by domain, lib/ (auth and permission glue)
src/app/             App Router routes; (app)/ is the signed-in shell
src/components/ui/   shadcn components (owned, edit freely)
src/components/      feature components (shell/ for the sidebar and header)
src/lib/             env, brand, theme helpers, pure TS (permissions arrive in Phase 1)
e2e/                 Playwright
scripts/             setup and seed
```

Theme tokens live in [`src/app/globals.css`](src/app/globals.css) (dark values from the prototype,
D-33; light values derived, D-34). `src/lib/theme/contrast.test.ts` fails if any text pairing drops
below WCAG AA. The product display name is set once in [`src/lib/brand`](src/lib/brand/index.ts).

## Deploy

Merging to `main` deploys to staging through Vercel's Git integration. The Vercel build runs
`convex deploy --cmd 'pnpm build'`, which pushes Convex functions before building Next.js. Each PR
gets a Vercel preview, and the E2E workflow runs Playwright against it. A `v*` tag promotes to
production once that environment exists. See [`docs/runbook.md`](docs/runbook.md) and
[ADR 0001](docs/adr/0001-environments-and-deployment.md).
