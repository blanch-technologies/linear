# ADR 0002: Theme tokens and contrast

Status: accepted (Phase 0), 2026-10-13

## Context

D-33 fixes the dark palette from the prototype, and D-34 requires light and system themes with text
at WCAG AA in both. The prototype puts white labels on the accent `#8e7cf8`, which is about 3.5:1
and fails AA.

## Decision

- Product tokens (`--bg`, `--surface`, `--surface-2`, `--surface-3`, `--line`, `--text`,
  `--text-muted`, `--text-faint`, `--brand`, status colors) are defined per theme in
  `src/app/globals.css`. shadcn's semantic variables (`--background`, `--primary`, `--muted`, ...)
  are mapped onto them, so owned components need no edits.
- A new token, `--brand-solid`, sets the fill for primary buttons and other filled brand surfaces.
  In dark it is the prototype's pressed shade `#7465da` (white text about 4.6:1). `--brand`
  (`#8e7cf8`) is still used for focus rings, links, and accents.
- `--text-faint` is for icons and decoration only; it is never used for readable text.
- `--text-muted` (D-33 `#83858e`) passes AA on `bg`, `surface`, and the sidebar, but not on the raised
  surfaces `surface-2` and `surface-3` (4.36:1 and 3.94:1 in dark). Secondary text on those surfaces,
  such as key caps, highlighted command items, and chips, uses `--text-muted-strong` (Phase 1).
- Light values are derived to keep the same hierarchy. They are provisional until the owner supplies
  Linear light-theme references (handoff Part F, still open).
- `next-themes` toggles a `.dark` class. The default is dark (D-33). Users pick Light, Dark, or
  System from the user menu.
- `src/lib/theme/contrast.test.ts` parses `globals.css`, asserts AA for every text pairing in both
  themes, and pins the D-33 dark values.

## Consequences

Primary buttons are one shade darker than in the prototype. Any token change that breaks contrast
fails CI.
