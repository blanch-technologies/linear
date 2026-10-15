/*
 * List selection rules (Linear parity): a click or X toggles one issue and
 * moves the anchor to it; shift-click adds every issue between the anchor and
 * the target in the visible order; shift+J/K extends from the focused issue.
 */

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Adds the anchor-to-target range. Without a visible anchor, selects just the target. */
export function selectRange(order: readonly string[], selected: ReadonlySet<string>, anchor: string | null, target: string): Set<string> {
  const next = new Set(selected);
  const to = order.indexOf(target);
  if (to === -1) return next;
  const from = anchor ? order.indexOf(anchor) : -1;
  if (from === -1) return next.add(target);
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(order[i]!);
  return next;
}
