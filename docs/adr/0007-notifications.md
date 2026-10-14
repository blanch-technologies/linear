# ADR 0007: Subscriptions and notification generation (O-7)

Status: accepted (Phase 2), 2026-10-14

## Context

D-31 requires persisted subscriptions and per-user notifications, with Subscribed and Activity
derived from them and not from heuristics. O-7: notifications come from issue events, stored in
`notifications`, with per-user preferences (P1). Batching and dedup are ours to choose. Email goes
through Resend.

## Decision

- **Who is subscribed** (`subscriptions`, one row per issue and person):
  - The creator, and anyone who changes the issue.
  - The assignee, re-subscribed even after an unsubscribe, because assignment is an explicit signal.
  - Anyone mentioned in the description or a comment (same rule), and commenters.
  - An unsubscribe is remembered (`subscribed: false`), so later edits don't re-add the person.
- **When notifications are written:** in the same transaction as the change, by the single issue
  write path (`convex/lib/issues.ts`) and the comment functions. There's no later job that could miss
  or duplicate events.
- **What is notified:**

  | Event | Who is notified |
  |---|---|
  | Assignment | The new assignee |
  | Status change | Subscribers |
  | Priority change | Subscribers |
  | New mention | The person mentioned |
  | Comment | Subscribers |
  | Reaction | The comment author |

  Title, label, and estimate edits only update history; notifying on those would make the inbox
  noisy.
- **Recipients:** never the actor. Only people who can still read the issue's team at that moment,
  checked with the permission module, so a private team never leaks through the inbox.
- **Dedup:** the same actor making the same kind of change to the same issue within 5 minutes updates
  the recipient's unread entry instead of adding another ("set the priority to High" replaces "…to
  Urgent").
- **Inbox:** indexed by `(workspace, user, archived, createdAt)` for newest-first pages and unread
  counts. Read, snooze, and archive are fields on the row.
- **Email (Resend):**
  - A scheduled sender will pick unread notifications older than a short delay, respecting
    preferences.
  - It's blocked on a Resend key and sending domain (docs/blockers.md). In-app notifications don't
    depend on it.

## Consequences

Notification writes add a few reads per recipient per change: one membership check and the
coalescing lookup. Issues have tens of subscribers, so this fits in a mutation. If that grows, move
fan-out to a scheduled function fed by `issueHistory`.
