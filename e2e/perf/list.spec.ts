import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/*
 * ADR 0005 acceptance gate: the O-3 harness on the real team list (D-36).
 * Needs the seeded PERF team (10,000 issues, double D-36's 5k):
 *   pnpm seed --perf && pnpm build && BLANCH_TEST_AUTH=1 pnpm start
 *   PERF=1 pnpm exec playwright test e2e/perf/list.spec.ts
 * Each measured action is armed first; the page records the time from that
 * action's input event to the second animation frame after it (the next paint).
 */

test.skip(!process.env.PERF, "Set PERF=1 (after `pnpm seed --perf`).");
test.setTimeout(15 * 60_000);

declare global {
  interface Window {
    __perf?: { arm: (label: string) => void; samples: Record<string, number[]> };
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function install(page: Page) {
  await page.evaluate(() => {
    const samples: Record<string, number[]> = {};
    let armed: string | null = null;
    const record = (event: Event) => {
      if (!armed) return;
      const label = armed;
      armed = null;
      const start = event.timeStamp;
      requestAnimationFrame(() => requestAnimationFrame(() => (samples[label] ??= []).push(performance.now() - start)));
    };
    for (const type of ["pointerup", "keydown", "scroll"]) window.addEventListener(type, record, { capture: true });
    window.__perf = { arm: (label) => (armed = label), samples };
  });
}

async function measured(page: Page, label: string, action: () => Promise<void>) {
  const started = Date.now();
  await page.evaluate((l) => window.__perf!.arm(l), label);
  await action();
  await page.waitForTimeout(120);
  if (process.env.PERF_VERBOSE) {
    const last = await page.evaluate((l) => window.__perf!.samples[l]?.at(-1), label);
    console.log(`${label}: ${Math.round(last ?? NaN)} ms in page, ${Date.now() - started} ms wall`);
  }
}

/** Waits until the issue count stops changing (every page has streamed in). */
async function loaded(page: Page): Promise<number> {
  const count = page.getByTestId("issue-count").filter({ visible: true });
  let last = "";
  let stableSince = Date.now();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const text = (await count.textContent({ timeout: 5000 }).catch(() => "")) ?? "";
    if (text !== last) {
      if (process.env.PERF_VERBOSE) console.log(`load: "${text}" at ${Date.now() - (deadline - 180_000)} ms`);
      last = text;
      stableSince = Date.now();
    } else if (text && Date.now() - stableSince > 3000) {
      return Number(text.replace(/\D/g, ""));
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Issue count never settled (last: ${last})`);
}

async function run(page: Page, label: string, cpuSlowdown: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
  if (process.env.PERF_PROFILE) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  const started = Date.now();
  await page.goto("/acme-demo/team/PERF/issues");
  const shown = await loaded(page);
  if (process.env.PERF_PROFILE) {
    // Self time by function while loading, to find what grows with the row count.
    const { profile } = await cdp.send("Profiler.stop");
    const total = new Map<string, number>();
    const dt = profile.timeDeltas ?? [];
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    (profile.samples ?? []).forEach((id, i) => {
      const f = byId.get(id)!.callFrame;
      const key = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber}`;
      total.set(key, (total.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    const top = [...total].sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [key, ms] of top) console.log(`self ${Math.round(ms)} ms  ${key}`);
    const dom = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>("[data-testid=issue-list]");
      return { rows: document.querySelectorAll("[data-testid=issue-row]").length, elements: document.querySelectorAll("*").length, listHeight: list?.clientHeight, scrollHeight: list?.scrollHeight };
    });
    console.log("dom", JSON.stringify(dom));
    throw new Error("Profile only (PERF_PROFILE).");
  }
  const loadMs = Date.now() - started - 3000;
  await install(page);

  await page.getByRole("button", { name: "Display" }).click();
  for (let round = 0; round < Number(process.env.PERF_ROUNDS ?? 6); round++) {
    for (const option of ["Priority", "Assignee", "No grouping", "Status"]) {
      await page.getByRole("combobox", { name: "Grouping" }).click();
      await measured(page, "group", () => page.getByRole("option", { name: option, exact: true }).click());
    }
    for (const option of ["Priority", "Last updated", "Title", "Created"]) {
      await page.getByRole("combobox", { name: "Ordering" }).click();
      await measured(page, "sort", () => page.getByRole("option", { name: option, exact: true }).click());
    }
  }
  await page.keyboard.press("Escape");

  for (let round = 0; round < 8; round++) {
    await page.getByTestId("filter-button").filter({ visible: true }).click();
    await page.getByRole("option", { name: "Priority" }).click();
    await measured(page, "filter", () => page.getByRole("option", { name: /Urgent/ }).click());
    await page.keyboard.press("Escape");
    await measured(page, "filter", () => page.getByRole("button", { name: "Remove Priority filter" }).click());
  }

  const list = page.getByTestId("issue-list").filter({ visible: true });
  for (let i = 0; i < 40; i++) {
    await measured(page, "scroll", () => list.evaluate((el, fraction) => void (el.scrollTop = el.scrollHeight * fraction), (i * 0.618) % 1));
  }
  await list.evaluate((el) => void (el.scrollTop = 0));
  await page.waitForTimeout(300);

  const rows = page.getByTestId("issue-row").filter({ visible: true });
  for (let i = 0; i < 30; i++) {
    await rows.nth(i % 12).hover();
    await page.keyboard.press("p");
    await expect(page.getByRole("dialog").or(page.getByRole("listbox")).first()).toBeVisible();
    await measured(page, "priority (optimistic)", () => page.keyboard.press(String(1 + (i % 4))));
  }
  await page.waitForTimeout(500);

  const samples = await page.evaluate(() => window.__perf!.samples);
  const heapMB = await page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
  });
  const summary = Object.fromEntries(
    Object.entries(samples).map(([op, values]) => [
      op,
      { n: values.length, p50: Math.round(percentile(values, 50)), p95: Math.round(percentile(values, 95)), max: Math.round(Math.max(...values)) },
    ]),
  );
  return { label, cpuSlowdown, loadMs, shown, heapMB, ...summary };
}

test("real team list: 10,000 issues", async ({ browser }) => {
  const results = [];
  for (const [label, slowdown] of [["desktop", 1], ["4x CPU throttle", 4]] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const auth = await page.request.post("/api/test-auth", { data: { email: "demo-ada@blanch.test", name: "Ada Admin" } });
    expect(auth.ok(), await auth.text()).toBe(true);
    results.push(await run(page, label, slowdown));
    await context.close();
  }
  console.log(JSON.stringify(results, null, 2));
  mkdirSync("test-results/perf", { recursive: true });
  writeFileSync("test-results/perf/list.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
});
