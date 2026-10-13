# Blockers

Open items that need the owner. Newest first.

## 2026-10-13 (Phase 0)

1. **GitHub org `blanch-technologies`** (owner chose it; `blanch` is a taken user name). It does
   not exist yet. *Owner action:* create it in the GitHub web UI
   (github.com/account/organizations/new, Free plan), since `gh` can't create orgs. Then I create
   `blanch-technologies/linear` and open the Phase 0 PR.
2. ~~Convex team `charlesmeng18` is paused.~~ Resolved: the owner chose the `juice` team for now.
   Project `juice/blanch` exists, with dev deployment `cool-lobster-948`. Functions push once
   `WORKOS_CLIENT_ID` is set on it (`pnpm setup` does this).
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
