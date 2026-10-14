import { describe, expect, it } from "vitest";
import { fromPlainText, isEmptyDocument, maxDocumentBytes, mentions, parseDocument, safeUrl, toPlainText } from "./index";

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Ask " },
        { type: "mention", attrs: { id: "user_1", label: "Ada" } },
        { type: "text", text: " about " },
        { type: "issueMention", attrs: { id: "issue_9", identifier: "ENG-9" } },
        { type: "text", text: " docs", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
      ],
    },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Ship" }] }] }] },
  ],
};

describe("rich text", () => {
  it("accepts supported documents and extracts text and mentions", () => {
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(toPlainText(parsed.doc)).toBe("Plan\nAsk @Ada about ENG-9 docs\nShip");
    expect(mentions(parsed.doc)).toEqual({ userIds: ["user_1"], issueIds: ["issue_9"] });
  });

  it("rejects bad JSON, unknown nodes, unsafe links, and oversized documents", () => {
    expect(parseDocument("{").ok).toBe(false);
    expect(parseDocument(JSON.stringify({ type: "doc", content: [{ type: "iframe" }] }))).toMatchObject({ ok: false, error: "UNSUPPORTED" });
    const evil = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] };
    expect(parseDocument(JSON.stringify(evil))).toMatchObject({ ok: false, error: "UNSUPPORTED" });
    expect(parseDocument("x".repeat(maxDocumentBytes + 1))).toMatchObject({ ok: false, error: "TOO_LARGE" });
    let deep: object = { type: "paragraph" };
    for (let i = 0; i < 50; i++) deep = { type: "blockquote", content: [deep] };
    expect(parseDocument(JSON.stringify({ type: "doc", content: [deep] }))).toMatchObject({ ok: false, error: "TOO_DEEP" });
  });

  it("allows only safe URLs", () => {
    expect(safeUrl("https://a.b/c")).toBe(true);
    expect(safeUrl("/acme/issue/ENG-1")).toBe(true);
    expect(safeUrl("//evil.com")).toBe(false);
    expect(safeUrl("data:text/html,x")).toBe(false);
  });

  it("round-trips plain text and detects empty documents", () => {
    const d = fromPlainText("one\n\ntwo");
    expect(toPlainText(d)).toBe("one\ntwo");
    expect(isEmptyDocument(fromPlainText(""))).toBe(true);
  });
});
