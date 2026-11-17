/**
 * Rainbow brackets on minified lines: one bundle, modes off / brackets, in headless Chromium.
 *   node perf.ts <dist> <label> <out.json>     env: PERF_WARMUP, PERF_RUNS, PERF_MODES, PERF_ONLY
 * Not part of the repository.
 */
import { writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
const W = `${process.env.PERF_ROOT}/perf`;
const { Harness } = await import(`${W}/lib/harness.ts`);
const { installInPage } = await import(`${W}/lib/inpage.ts`);
const { serveBundle } = await import(`${W}/lib/bundle.ts`);
const { SCENARIOS } = await import(`${W}/scenarios.ts`);
const { frameSummary, keySummary, median } = await import(`${W}/lib/stats.ts`);
type Metrics = Record<string, number>;

const [dist, label, out] = process.argv.slice(2);
if (!dist || !label || !out) throw new Error("usage: perf.ts <dist> <label> <out.json>");
const VIEWPORT = { width: 1400, height: 900 };
const WARMUP = Number(process.env.PERF_WARMUP ?? 1);
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const MODES = (process.env.PERF_MODES ?? "off,brackets").split(",");
const ONLY = process.env.PERF_ONLY?.split(",");

const brackets = (page: Page) => page.evaluate(() => document.querySelectorAll("[class*=cm-rainbow-bracket]").length);

/** A minified bundle: short lines around one `units`-repeat line, typed into and scrolled sideways in its middle. */
function minified(id: string, units: number) {
  return {
    id,
    title: `Type and scroll in a ${(units * 13) / 1000}k-character minified line`,
    async run(h: any): Promise<Metrics> {
      const line = "x({a:[1,2]});".repeat(units);
      const source = `function before() { return [1, {a:2}]; }\n${line}\nfunction after() { return [3]; }\n`;
      const openMs = await h.openFile(`/dev/acme-api/src/big/${id}.ts`, source);
      await h.parserIdle();
      await h.setCursor(Math.floor(source.length / 2));
      await h.parserIdle();
      const refresh = await h.refreshMs();
      const before = await h.counters();
      const keys = await h.typeMeasured("abcdefghijklmnopqrstuvwxyz", 80);
      const work = Harness.delta(before, await h.counters());
      await h.inPage((p: any) => p.startFrames());
      for (let i = 0; i < 30; i++) {
        await h.page.mouse.wheel(i % 2 ? 800 : -800, 0);
        await h.page.waitForTimeout(16);
      }
      const frames = frameSummary(await h.inPage((p: any) => p.stopFrames()), refresh);
      return {
        openMs,
        ...keySummary(keys, refresh),
        mainThreadMsPerKey: work.taskMs / keys.length,
        scrollFrameP95Ms: frames.frameP95Ms,
        scrollDroppedFramesPct: frames.droppedFramesPct,
      };
    },
  };
}

const all = [
  ...SCENARIOS.filter((s: any) => s.id === "typingLarge" || s.id === "scroll"),
  minified("minified200k", 16_000),
  minified("minified1m", 80_000),
].filter((s: any) => !ONLY || ONLY.includes(s.id));

async function runOnce(browser: Browser, url: string, scenario: any, mode: string): Promise<Metrics> {
  const context = await browser.newContext({ baseURL: url, viewport: VIEWPORT, deviceScaleFactor: 1 });
  try {
    await context.addInitScript(installInPage);
    await context.addInitScript((m) => ((globalThis as any).__RAINBOW_MODE = m), mode);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const h = new Harness(page, cdp);
    await h.load();
    let marks = -1;
    const open = h.openFile.bind(h);
    h.openFile = async (...args: unknown[]) => {
      const ms = await open(...args);
      marks = await brackets(page);
      // Every scenario file starts with a short bracketed line in view.
      if ((mode === "brackets") !== marks > 0) throw new Error(`${mode}: ${marks} rainbow marks after open`);
      return ms;
    };
    const metrics = await scenario.run(h);
    if (errors.length) throw new Error(errors.join("; "));
    return { ...metrics, rainbowMarks: marks, rainbowMarksAfter: await brackets(page) };
  } finally {
    await context.close();
  }
}

const { server, url } = await serveBundle(dist);
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"],
});
const report: any = { label, dist, browser: browser.version(), viewport: VIEWPORT, warmup: WARMUP, runs: RUNS, cases: [] };
try {
  for (const mode of MODES)
    for (const scenario of all) {
      process.stdout.write(`${label} ${mode} ${scenario.id} `);
      const samples: Metrics[] = [];
      try {
        for (let i = 0; i < WARMUP + RUNS; i++) {
          const m = await runOnce(browser, url, scenario, mode);
          if (i >= WARMUP) samples.push(m);
          process.stdout.write(i < WARMUP ? "w" : ".");
        }
        const keys = [...new Set(samples.flatMap(Object.keys))];
        const med = Object.fromEntries(keys.map((k) => [k, median(samples.map((s) => s[k]!).filter(Number.isFinite))]));
        report.cases.push({ id: scenario.id, mode, samples, median: med });
        console.log(" ok");
      } catch (error) {
        console.log(" failed");
        report.cases.push({ id: scenario.id, mode, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
      }
    }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);
if (report.cases.some((c: any) => c.error)) process.exitCode = 1;
