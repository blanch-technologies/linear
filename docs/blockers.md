# Blockers

Open items that need the owner. Newest first.

## 2026-10-13 (Phase 0)

1. **Convex team `charlesmeng18` is paused.** Creating the `blanch` project fails with
   `InvalidProjectCreation: Project cannot be created or modified while your team is Paused`.
   Needed for the staging deployment and for Vercel builds (`CONVEX_DEPLOY_KEY`). Local development
   works without it by using Convex's account-free local backend.
   *Owner action:* unpause the team (dashboard.convex.dev → team settings → billing/usage), or pick
   another team.
2. **GitHub org name `blanch` is taken** by an existing user account, so `github.com/blanch/linear`
   is impossible. *Owner action:* create an org with another name (for example `blanch-hq` or
   `blanchtools`) in the GitHub web UI, since `gh` can't create orgs, and tell me the name. I'll
   then create the repo `<org>/linear` and open the Phase 0 PR.
3. **WorkOS staging credentials.** Needed for sign-in locally and on Vercel: `WORKOS_CLIENT_ID` and
   `WORKOS_API_KEY`. *Owner action:* put them in `.env.local` yourself or paste them into
   `pnpm setup`; don't send them in chat. Also add the redirect URIs listed in the README and a
   wildcard preview redirect (`https://*-charlesmeng18s-projects.vercel.app/callback`).
4. **Convex preview deployments per PR (D-39).** To verify: whether the Convex plan includes
   preview deploy keys. If not, previews share the staging dev deployment (ADR 0001).
5. **Vercel Hobby plan** is non-commercial. That's fine for dogfooding. Move to a Pro team before
   design partners (Phase 5).
6. **Signed-in e2e coverage (D-41)** needs the test-auth path. The env guard (refuses
   `BLANCH_TEST_AUTH=1` in production) is in place. The path itself, which mints a session Convex
   accepts, lands early in Phase 1 with the shell e2e, visual baseline, and axe checks. In Phase 0,
   the shell was checked manually with axe (0 violations in dark, light, and mobile).
