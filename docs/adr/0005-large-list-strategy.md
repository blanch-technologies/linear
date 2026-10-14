# ADR 0005: Large-list strategy (O-3 spike)

Status: accepted (Phase 1), 2026-10-13

## Context

O-3 asks whether lists can stay fast with Convex subscriptions alone, or need a client-side
normalized cache. D-36 sets the bars:
- Every action is optimistic, with p95 optimistic response under 100 ms.
- Lists over ~200 rows are virtualized.

The test case is a team with 10,000 issues, where users filter, sort, group, and scroll.

## Method

- **Data:** `pnpm seed --perf` adds team `PERF` with 10,000 deterministic issues to the demo workspace,
  spread over 7 states, 5 priorities, and 3 assignees.
- **Page:** `/<workspace>/spike/PERF` (`src/components/spike/large-list.tsx`), which isn't linked from
  the UI. It loads every issue with `usePaginatedQuery(api.issues.listForTeam)` in pages of 1,000,
  meaning 10 live Convex subscriptions.
  - Filter (text and priority), sort (4 keys), and group (state, priority, assignee) are derived
    in one `useMemo`.
  - Rows are drawn with TanStack Virtual (D-12).
  - Priority changes use `useMutation(...).withOptimisticUpdate` with
    `optimisticallyUpdateValueInPaginatedQuery`.
- **Timing:** measured in the page, from the input event to the second `requestAnimationFrame` (the
  next paint), so Playwright's own latency isn't counted.
- **Harness:** `e2e/perf/spike.spec.ts` (`PERF=1`) drives the UI, with 24 to 40 samples per operation:
  - Typing four words character by character.
  - 24 sort changes and 24 group changes.
  - 40 scroll jumps.
  - 30 priority clicks.

  It runs at normal speed and with Chromium CPU throttled 4× as a stand-in for a slow laptop.
- **Machine:** Apple M2, production build (`next build && next start`), Convex cloud dev deployment.
  Raw results for production and dev builds are in `docs/perf/o3-large-list-2026-10-13.json`.

## Results (production build, milliseconds, p50 / p95)

Shipped dependency (`@tanstack/react-virtual` 3.14.13):

| Operation | Desktop | 4× CPU throttle |
|---|---|---|
| Filter (per keystroke) | 22 / 35 | 23 / 49 |
| Sort change | 30 / 48 | 63 / 71 |
| Group change | 30 / 39 | 59 / **103** |
| Scroll (frame after a jump) | 16 / 17 | 16 / 17 |
| **Optimistic priority change** | 31 / **32** | 43 / **60** |
| Load all 10,000 issues | 2.4 s | 2.5 s |
| JS heap after the run | 45 MB | 73 MB |

I ran it three times in all; the first two used 3.14.19, before it was replaced by an older pin
because it was hours old. Grouping under 4× throttling measured a p95 of 97 to 103 ms. Everything
else stayed well inside the bar.

The development build (unminified React) is about 1.5 to 2× slower. At 4× throttling its p95 reaches
117 ms optimistic and 209 ms group, so judge performance only on production builds.

## Decision

- **No client-side normalized cache.** With plain Convex subscriptions, optimistic updates stay at
  60 ms p95 or less even with 4× throttling, under the D-36 bar. Every list interaction except
  regrouping under 4× throttling is well under 100 ms p95, and regrouping sits at the bar.
- The cost that does grow is **deriving the view**: re-sorting and regrouping 10,000 rows on each
  change. A normalized store wouldn't remove that. Phase 2's list should:
  1. Memoize filter, sort, and group as separate stages, so a group change doesn't re-sort.
  2. Patch grouped rows incrementally when one issue changes, instead of rebuilding.
  3. Push filters that have an index (state, assignee, priority) to the server, so big teams don't
     load every issue for a narrow view.
  4. Start rendering from the first page instead of waiting for all 10 (the 2 s full load).
- **Acceptance gate:** re-run this harness in Phase 2 on the real list, with the 5k-issue seed
  (D-36, Phase 2 acceptance). If any p95 exceeds 100 ms under 4× throttling, revisit this ADR.

## Consequences

- Phase 2 builds the list on Convex subscriptions and TanStack Virtual directly (O-2 stays light:
  React state plus Convex hooks).
- The spike page and the `PERF` seed stay as a regression benchmark until the real list replaces them.
