# blanch (working name: Linear.Blanch)

A multi-tenant, Linear-parity issue tracker on Next.js + Convex + WorkOS, deployed on Vercel.

## Read first
1. `docs/implementation-handoff.md` is the authoritative brief. Part A (Decided) and Part F (owner decisions) are requirements; Part B (Open) is yours to decide with an ADR in `docs/adr/`.
2. `docs/parity-matrix.md` is the scope and status tracker. Update the relevant row in the same PR as each feature.
3. `docs/build-plan.md` is background; the handoff wins on any conflict.
4. `legacy/` is a read-only prototype used as a requirements and styling reference. Never edit it or port code wholesale. `docs/reference/` holds its audits.

## Working rules
- Work on branches `agent/<area>/<topic>`; open PRs into `main`; do not push to `main`.
- Small PRs with description, screenshots for UI, and a test plan.
- Do not start the next phase until the current phase's acceptance criteria are met; at the end of Phase 0 and Phase 1, stop and ask the owner to review.
- Escalate (ask the owner) per the "Escalate rather than guess" section of the handoff. Log blockers in `docs/blockers.md`.
- Never put secrets in code, logs, or commits. Ask for credentials only when needed.

## Current phase
Phase 1: spine (see handoff Part C), built as stacked PRs #2–#8 on top of Phase 0 (#1). Waiting
for owner review before Phase 2.
