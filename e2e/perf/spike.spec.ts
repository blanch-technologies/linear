import { writeFileSync, mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/*
 * O-3 measurements (ADR 0005). Needs the seeded PERF team:
 *   pnpm seed --perf && PERF=1 pnpm exec playwright test e2e/perf
 * Signs in as the seeded admin (test auth), loads 10,000 issues, and drives
 * each interaction through the UI. Timings come from the page itself (input
 * to next paint), so Playwright's own latency isn't counted.
 */

test.skip(!process.env.PERF, "Set PERF=1 (after `pnpm seed --perf`).");
test.setTimeout(10 * 60_000);

type Samples = Record<string, number[]>;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function run(page: Page, label: string, cpuSlowdown: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
  await page.goto("/acme-demo/spike/PERF");
  await expect(page.getByTestId("spike-count")).toContainText("10000 loaded ·", { timeout: 120_000 });
  await page.waitForTimeout(500);

  const filter = page.getByLabel("Filter issues");
  for (const word of ["refactor", "sidebar", "eng-9", "polish"]) {
    await filter.pressSequentially(word, { delay: 40 });
    await filter.fill("");
  }
  for (let i = 0; i < 6; i++) {
    for (const value of ["priority", "updated", "title", "number"]) await page.getByLabel("Sort", { exact: true }).selectOption(value);
    for (const value of ["priority", "assignee", "none", "state"]) await page.getByLabel("Group", { exact: true }).selectOption(value);
  }
  for (const value of ["1", "2", "any"]) await page.getByLabel("Priority", { exact: true }).selectOption(value);
  const scroller = page.getByTestId("spike-scroll");
  for (let i = 0; i < 40; i++) {
    await scroller.evaluate((el, fraction) => (el.scrollTop = el.scrollHeight * fraction), (i * 0.618) % 1);
    await page.waitForTimeout(30);
  }
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(200);
  const buttons = page.getByTestId("spike-priority");
  for (let i = 0; i < 30; i++) {
    await buttons.nth(i % 12).click();
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => window.__spike!);
  // Chromium-only: JS heap after loading and exercising the list.
  const heapMB = await page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
  });
  const summary = Object.fromEntries(
    Object.entries(result.samples as Samples).map(([op, values]) => [
      op,
      { n: values.length, p50: Math.round(percentile(values, 50)), p95: Math.round(percentile(values, 95)), max: Math.round(Math.max(...values)) },
    ]),
  );
  return { label, cpuSlowdown, loadMs: Math.round(result.loadMs ?? NaN), rows: result.loaded, heapMB, ...summary };
}

test("large list: 10,000 issues", async ({ browser }) => {
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
  writeFileSync("test-results/perf/o3.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
});
