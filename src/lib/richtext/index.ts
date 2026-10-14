/*
 * Rich text is stored as ProseMirror JSON (ADR 0006). This module is the
 * server's and client's shared view of it: validation (size, depth, allowed
 * nodes and marks), plain-text extraction for search and previews, and the
 * people and issues a document mentions. No TipTap imports, so Convex can use it.
 */

export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
};

export const maxDocumentBytes = 200_000;
const maxDepth = 40;

export const allowedNodes = new Set([
  "doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem",
  "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak",
  "image", "mention", "issueMention",
]);
export const allowedMarks = new Set(["bold", "italic", "strike", "code", "link", "underline"]);

export type RichTextError = "INVALID_JSON" | "TOO_LARGE" | "TOO_DEEP" | "UNSUPPORTED";

/** Parses and checks a stored document. Returns the doc or an error code. */
export function parseDocument(json: string): { ok: true; doc: RichNode } | { ok: false; error: RichTextError; detail?: string } {
  if (json.length > maxDocumentBytes) return { ok: false, error: "TOO_LARGE" };
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
  const problem = check(doc, 0);
  if (problem) return { ok: false, ...problem };
  if ((doc as RichNode).type !== "doc") return { ok: false, error: "UNSUPPORTED", detail: "root must be doc" };
  return { ok: true, doc: doc as RichNode };
}

function check(node: unknown, depth: number): { error: RichTextError; detail?: string } | null {
  if (depth > maxDepth) return { error: "TOO_DEEP" };
  if (!node || typeof node !== "object" || Array.isArray(node)) return { error: "INVALID_JSON" };
  const n = node as RichNode;
  if (typeof n.type !== "string" || !allowedNodes.has(n.type)) return { error: "UNSUPPORTED", detail: String(n.type) };
  if (n.text !== undefined && typeof n.text !== "string") return { error: "INVALID_JSON" };
  for (const mark of n.marks ?? []) {
    if (!mark || typeof mark.type !== "string" || !allowedMarks.has(mark.type)) {
      return { error: "UNSUPPORTED", detail: String(mark?.type) };
    }
    if (mark.type === "link" && !safeUrl(mark.attrs?.href)) return { error: "UNSUPPORTED", detail: "link href" };
  }
  if (n.type === "image" && !safeUrl(n.attrs?.src)) return { error: "UNSUPPORTED", detail: "image src" };
  if (n.content !== undefined) {
    if (!Array.isArray(n.content)) return { error: "INVALID_JSON" };
    for (const child of n.content) {
      const problem = check(child, depth + 1);
      if (problem) return problem;
    }
  }
  return null;
}

/** Only http(s), mailto, and same-origin paths; never javascript: or data:. */
export function safeUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const blockNodes = new Set(["paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock"]);

/** Plain text with blocks on separate lines; mentions render as @Name / ENG-1. */
export function toPlainText(doc: RichNode): string {
  const lines: string[] = [];
  let line = "";
  const walk = (node: RichNode) => {
    if (node.type === "text") line += node.text ?? "";
    else if (node.type === "mention") line += `@${String(node.attrs?.label ?? "")}`;
    else if (node.type === "issueMention") line += String(node.attrs?.identifier ?? "");
    else if (node.type === "hardBreak") line += "\n";
    for (const child of node.content ?? []) walk(child);
    if (blockNodes.has(node.type) && line.trim()) {
      lines.push(line.trim());
      line = "";
    }
  };
  walk(doc);
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

/** User ids from `mention` nodes and issue ids from `issueMention` nodes, deduplicated. */
export function mentions(doc: RichNode): { userIds: string[]; issueIds: string[] } {
  const userIds = new Set<string>();
  const issueIds = new Set<string>();
  const walk = (node: RichNode) => {
    if (node.type === "mention" && typeof node.attrs?.id === "string") userIds.add(node.attrs.id);
    if (node.type === "issueMention" && typeof node.attrs?.id === "string") issueIds.add(node.attrs.id);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return { userIds: [...userIds], issueIds: [...issueIds] };
}

/** A document holding plain paragraphs, for text typed outside the editor (API, tests). */
export function fromPlainText(text: string): RichNode {
  const paragraphs = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.length
      ? paragraphs.map((block) => ({ type: "paragraph", content: [{ type: "text", text: block }] }))
      : [{ type: "paragraph" }],
  };
}

export function isEmptyDocument(doc: RichNode): boolean {
  return toPlainText(doc).trim() === "" && !JSON.stringify(doc).includes('"image"');
}
