# ADR 0006: Rich text storage and editor (O-4)

Status: accepted (Phase 2), 2026-10-14

## Context

TipTap is fixed (D-12). O-4 leaves open the extensions, how mentions and issue links serialize, the
storage format, and collaborative editing. Required: headings, lists, checklists, code blocks, links,
images, `@mentions`, `#issue` links, a slash menu, and markdown shortcuts. The format must support
search and future export.

## Decision

- **Storage:** ProseMirror JSON, as a string (`issues.description`, `comments.body`). Next to it, a
  plain-text copy (`descriptionText`, `bodyText`) feeds Convex full-text search (ADR 0009), inbox
  previews, and email.
  - JSON round-trips through TipTap without loss, which Markdown wouldn't (mentions, task state).
  - Export to Markdown is a pure function over the same tree when we need it.
- **One shared module, `src/lib/richtext`** (no TipTap imports, so Convex uses it too):
  - Validates every stored document: size (200 KB), depth (40), and an allow-list of nodes and
    marks.
  - Allows only `http(s)`, `mailto`, and same-origin link and image URLs, never `javascript:` or
    `data:`.
  - Extracts plain text and mentions.

  The server rejects anything else, so a client can't store markup the editor wouldn't produce.
- **Mentions:**
  - People are `mention` nodes `{ id: <users id>, label }`.
  - Issues are `issueMention` nodes `{ id: <issues id>, identifier }`.
  - Ids, not names (D-25). Labels are display copies only.
  - The server diffs mentions on save, then subscribes and notifies newly mentioned people who can
    read the issue (ADR 0007).
- **Extensions** (pinned to 3.31.3, the newest release over two weeks old):
  - StarterKit: headings, lists, blockquote, code block, rule, and markdown input rules.
  - Link, Image, TaskList and TaskItem, Placeholder.
  - Mention, twice: `@` for people, `#` for issues.
  - A slash menu built on `@tiptap/suggestion`.
  - Images upload to Convex storage as attachments first, then embed by URL.
- **No collaborative editing at launch,** since O-4 doesn't require it. Saves are debounced and carry
  `expectedVersion` (D-21). A conflicting save is refused with a refresh prompt, so nobody silently
  overwrites anyone. The Convex ProseMirror sync component is the upgrade path.

## Consequences

Search indexes plain text only (no formatting). Changing the allow-list is a code change in one
place, with tests (`src/lib/richtext/richtext.test.ts`).
