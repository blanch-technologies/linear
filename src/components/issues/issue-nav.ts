/*
 * Prev/next on the issue page follows the list it was opened from, as in
 * Linear. The list writes its visible order when an issue is opened; the issue
 * page reads it. Per tab (sessionStorage), and only a convenience: without it
 * the page just has no prev/next.
 */

export type IssueNav = { identifiers: string[]; from: string };

const key = "issue-nav";

export function rememberIssueNav(nav: IssueNav) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(nav));
  } catch {
    // Storage unavailable: no prev/next.
  }
}

export function readIssueNav(): IssueNav | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    const nav = raw ? (JSON.parse(raw) as IssueNav) : null;
    return nav && Array.isArray(nav.identifiers) && typeof nav.from === "string" ? nav : null;
  } catch {
    return null;
  }
}

/** Neighbors of an issue in the remembered list, with its 1-based position. */
export function neighbors(nav: IssueNav | null, identifier: string) {
  const index = nav ? nav.identifiers.indexOf(identifier) : -1;
  if (!nav || index === -1) return null;
  return {
    position: index + 1,
    total: nav.identifiers.length,
    previous: nav.identifiers[index - 1] ?? null,
    next: nav.identifiers[index + 1] ?? null,
  };
}
