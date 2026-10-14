// skills/ui-evidence/src/parity-run.ts — real-browser design-parity driver.
// Excluded from unit coverage like run-script.ts; the maths it delegates to
// (parity.ts, host-guard.ts, parity-publish.ts) is unit-tested at 100%.
// Read-only by construction: frames have no submit step, form values are
// typed but never saved, and the CLI refuses write-looking clicks.
import fs from "node:fs";
import path from "node:path";

import { chromium, type Locator, type Page } from "playwright";
import { PNG } from "pngjs";

import { signIn } from "./login.js";
import { browserLaunchArgs, isOffOriginNavigation, provenanceFor, readCredentials, redact } from "./host-guard.js";
import {
  buildParityEntry,
  checkBoxes,
  compareRegion,
  cropRegion,
  implementationRegion,
  selectorKey,
  sideBySide,
  viewportShortfall,
  type ParityEntry,
  type Selector,
} from "./parity.js";
import type { DesignFrame, DesignManifest } from "./parity-schema.js";
import { describeStep } from "./script-schema.js";
import type { ParitySummary } from "./parity-publish.js";
import type { Box } from "./pixel-diff.js";
import { executeStep } from "./step-exec.js";
import { desktopChromeUserAgent } from "./user-agent.js";

export interface ParityRunOptions {
  host: string;
  hostKind: "local" | "preview";
  /** Only pass a commit you verified; it is quoted in Linear subtitles. */
  appBuild?: string;
  /** DB provenance when running against localhost (ignored for previews, which are scrubbed). */
  dbProvenance?: "seeded" | "unknown";
}

const MEASURE_TIMEOUT_MS = 5_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const locate = (page: Page, s: Selector): Locator => ("testId" in s ? page.getByTestId(s.testId) : page.getByText(s.text).locator("visible=true")).first();

async function settle(page: Page, ms: number): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

/** Everything that bit the FRN-4241 run: focus rings, scrolled containers, half-faded popovers. */
async function prepareCapture(page: Page, m: DesignManifest): Promise<void> {
  await settle(page, m.settleMs);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const click = m.neutralClick === undefined ? { x: m.viewport.w - 22, y: m.viewport.h - 22 } : m.neutralClick;
  // Never click a control: a sticky Save bar or floating action button can sit in the corner.
  if (click !== false && !(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("button, a, input, select, textarea, label, summary, [role], [onclick], [tabindex]"), click))) {
    await page.mouse.click(click.x, click.y);
  }
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll("*").forEach((e) => {
      if (e.scrollTop > 0) e.scrollTop = 0;
    });
  });
  await settle(page, m.settleMs);
}

async function measure(page: Page, selectors: Selector[], timeout: number): Promise<Map<string, Box | null>> {
  const out = new Map<string, Box | null>();
  for (const s of selectors) {
    const b = await locate(page, s).boundingBox({ timeout }).catch(() => null);
    out.set(selectorKey(s), b === null ? null : { x: round2(b.x), y: round2(b.y), w: round2(b.width), h: round2(b.height) });
  }
  return out;
}

async function runFrame(page: Page, m: DesignManifest, f: DesignFrame, host: string, runDir: string): Promise<ParityEntry> {
  if (f.waitFor !== undefined) await locate(page, f.waitFor).waitFor({ state: "visible", timeout: m.timeoutMs });
  for (const [i, step] of (f.steps ?? []).entries()) {
    const status = await executeStep(page, step, host, async () => null, Math.min(m.timeoutMs, 10_000));
    if (status !== "passed") throw new Error(`frame ${f.name}: step ${i + 1} (${describeStep(step)}) ${status}`);
  }
  for (const v of f.formValues ?? []) await ("testId" in v ? page.getByTestId(v.testId) : page.locator(v.css)).fill(v.value);
  await prepareCapture(page, m);

  const expectSelectors = (f.expectBoxes ?? []).flatMap((e) => (e.relativeTo === undefined ? [e.target] : [e.target, e.relativeTo]));
  const measured = await measure(page, [f.anchor, ...expectSelectors], Math.min(m.timeoutMs, MEASURE_TIMEOUT_MS));
  const anchorBox = measured.get(selectorKey(f.anchor)) ?? null;
  if (anchorBox === null) throw new Error(`frame ${f.name}: anchor ${selectorKey(f.anchor)} not found`);

  const offset = f.anchorOffset ?? { x: 0, y: 0 };
  // The screenshot is the viewport; a region that runs past it can't be cropped, so say how big the viewport must be.
  const need = viewportShortfall(implementationRegion(anchorBox, f.designRegion, offset), m.viewport);
  if (need !== null) throw new Error(`frame ${f.name}: the region needs a viewport of at least ${need.w}x${need.h}, manifest viewport is ${m.viewport.w}x${m.viewport.h}`);
  const fullPath = path.join(runDir, `${f.name}-full.png`);
  await page.screenshot({ path: fullPath });
  const design = cropRegion(PNG.sync.read(fs.readFileSync(f.designPng)), f.designRegion);
  const implementation = cropRegion(PNG.sync.read(fs.readFileSync(fullPath)), implementationRegion(anchorBox, f.designRegion, offset));
  const comparison = compareRegion(design, implementation, { threshold: m.threshold, includeAA: m.includeAA });

  const files = { design: `${f.name}-design.png`, implementation: `${f.name}-implementation.png`, diff: `${f.name}-diff.png`, sideBySide: `${f.name}-side-by-side.png` };
  const write = (name: string, png: PNG): void => fs.writeFileSync(path.join(runDir, name), PNG.sync.write(png));
  write(files.design, design);
  write(files.implementation, implementation);
  write(files.diff, comparison.diff);
  write(files.sideBySide, sideBySide(design, implementation, comparison.diff));

  return buildParityEntry({
    designRegion: f.designRegion,
    anchorBox,
    anchorOffset: offset,
    comparison,
    threshold: m.threshold,
    includeAA: m.includeAA,
    boxChecks: checkBoxes(f.expectBoxes ?? [], (s) => measured.get(selectorKey(s)) ?? null),
    knownDifferences: f.knownDifferences ?? [],
    files,
    ...(f.designNode !== undefined ? { designNode: f.designNode } : {}),
  });
}

export async function runParity(m: DesignManifest, runDir: string, opts: ParityRunOptions): Promise<ParitySummary> {
  fs.mkdirSync(runDir, { recursive: true });
  // A failed run must not leave an earlier run's summary for parity-plan to publish.
  fs.rmSync(path.join(runDir, "parity.json"), { force: true });
  let creds: { email: string; password: string } | null = null;
  if (m.login !== undefined) {
    const c = readCredentials(process.env, m.login.emailEnv, m.login.passwordEnv);
    if ("error" in c) throw new Error(c.error);
    creds = c;
  }
  const secrets = creds === null ? [] : [creds.email, creds.password];

  const browser = await chromium.launch({
    headless: true,
    args: browserLaunchArgs(opts.hostKind),
  });
  try {
    const context = await browser.newContext({ viewport: { width: m.viewport.w, height: m.viewport.h }, deviceScaleFactor: 1, userAgent: desktopChromeUserAgent(browser.version()) });
    // The session is signed in: never let a redirect or injected link navigate it off the vetted host.
    await context.route("**/*", (route) => (isOffOriginNavigation(opts.host, route.request().url(), route.request().isNavigationRequest()) ? route.abort() : route.continue()));
    const page = await context.newPage();
    const frames: Record<string, ParityEntry> = {};
    try {
      if (creds !== null) await signIn(page, m.login!, opts.host, creds);
      await page.goto(`${opts.host}${m.route}`, { waitUntil: "load", timeout: 120_000 });
      // A text-absent check straight after goto would pass on the loading spinner; wait for a known-present element first.
      await locate(page, m.ready).waitFor({ state: "visible", timeout: m.timeoutMs });
      for (const f of m.frames) frames[f.name] = await runFrame(page, m, f, opts.host, runDir);
    } catch (e) {
      throw new Error(redact(e instanceof Error ? e.message : String(e), secrets));
    }
    const summary: ParitySummary = {
      runId: path.basename(runDir),
      host: opts.host,
      provenance: provenanceFor(opts.hostKind, opts.dbProvenance),
      appBuild: opts.appBuild ?? null,
      designNode: m.designNode ?? null,
      viewport: m.viewport,
      frames,
    };
    fs.writeFileSync(path.join(runDir, "parity.json"), JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    await browser.close();
  }
}
