# Blockers

Open items that need the owner. Newest first.

## 2026-10-13 (Phase 0)

0. **Vercel GitHub app is not installed on `blanch-technologies`**, so the Vercel project can't
   connect to the repo, and PRs get no previews. *Owner action:* install it (github.com/apps/vercel
   → Configure → blanch-technologies → the `linear` repo), then run `vercel git connect`.

1. ~~GitHub org.~~ Resolved: `blanch-technologies/linear`.
2. ~~Convex team paused.~~ Resolved: project `juice/blanch`.
3. ~~WorkOS staging credentials.~~ Resolved; local sign-in works. Still to do in the dashboard: the
   sign-out redirect (`http://localhost:3000`) and the initiate login URI.
4. ~~Convex preview deployments per PR.~~ Resolved: the plan includes preview deploy keys, and the key is set in Vercel.
5. **Vercel Hobby plan** is non-commercial. That's fine for dogfooding. Move to a Pro team before
   design partners (Phase 5).
6. **Signed-in e2e coverage (D-41)** needs the test-auth path. The env guard (refuses
   `BLANCH_TEST_AUTH=1` in production) is in place. The path itself, which mints a session Convex
   accepts, lands early in Phase 1 with the shell e2e, visual baseline, and axe checks. In Phase 0,
   the shell was checked manually with axe (0 violations in dark, light, and mobile).
