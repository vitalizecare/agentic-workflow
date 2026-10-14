// skills/ui-evidence/src/step-exec.ts — per-step execution against a real
// Playwright Page. Covered by the local-fixture browser tests
// (tests/browser/), not by unit coverage.
import type { Locator, Page } from "playwright";

import { isSameOriginPath } from "./host-guard.js";
import { assertExpectedState } from "./expected-state.js";
import { candidateFits, resolveCandidate, type Candidate, type RepairProposal } from "./repair.js";
import { describeExpectedState, type DragStep, type ScriptStep } from "./script-schema.js";

const INTERACTIVE = "button, a, input, [role], [data-testid]";
const MAX_REPAIR_ATTEMPTS = 2;
// dnd-kit's PointerSensor activates after 6px of travel: the first move clears
// that, then the path to the drop point is walked in small steps.
const DRAG_ACTIVATION_PX = 10;
const DRAG_STEPS = 12;
// Lets the drop target's hover state render before the release.
const DRAG_HOVER_MS = 150;

export type StepOutcome = "passed" | "failed" | "broken";

export type RepairFn = (brokenSelector: string, step: string, candidates: Candidate[]) => Promise<RepairProposal | null>;

/** A step that acts on a single data-testid (every action except drag). */
type TargetStep = Exclude<ScriptStep, DragStep>;

/** The step's element; `index` picks the nth match, otherwise the locator stays strict. */
const locateTarget = (page: Page, step: TargetStep): Locator => (step.index === undefined ? page.getByTestId(step.target) : page.getByTestId(step.target).nth(step.index));

export async function performAction(page: Page, step: ScriptStep, host: string, timeout = 5000): Promise<void> {
  if (step.action === "goto") {
    // Defence in depth behind guardWrites: never let a target rewrite the host (`@evil.com`, `//evil.com`).
    if (!isSameOriginPath(step.target)) throw new Error(`goto target must be a path on the host: ${step.target}`);
    await page.goto(`${host}${step.target}`);
  } else if (step.action === "click") {
    await locateTarget(page, step).click({ timeout });
  } else if (step.action === "fill") {
    await locateTarget(page, step).fill(step.value ?? "", { timeout });
  } else if (step.action === "scroll") {
    await scrollContainer(page, step, timeout);
  } else if (step.action === "drag") {
    await drag(page, step, timeout);
  } else {
    await page.getByText(step.target).locator("visible=true").first().waitFor({ state: "visible", timeout });
  }
}

const SCROLL_SETTLE_MS = 300;

/** Scrolls the data-testid container (read-only), then lets lazy layout settle. A missing target throws, so the step is broken. */
async function scrollContainer(page: Page, step: TargetStep, timeout: number): Promise<void> {
  if (step.target === "") throw new Error("scroll needs a data-testid target");
  const position = step.value ?? "end";
  const el = locateTarget(page, step);
  await el.waitFor({ state: "visible", timeout });
  await el.evaluate((node, pos) => {
    if (pos === "end") node.scrollLeft = node.scrollWidth;
    else if (pos === "start") node.scrollLeft = 0;
    else if (pos === "bottom") node.scrollTop = node.scrollHeight;
    else if (pos === "top") node.scrollTop = 0;
    else node.scrollLeft = Number(pos);
  }, position);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.waitForTimeout(SCROLL_SETTLE_MS);
}

/** First visible element with this data-testid, waited for. */
async function visibleByTestId(page: Page, testId: string, timeout: number): Promise<Locator> {
  const el = page.getByTestId(testId).locator("visible=true").first();
  await el.waitFor({ state: "visible", timeout });
  return el;
}

async function pointIn(el: Locator, offset: { x: number; y: number } | undefined, timeout: number): Promise<{ x: number; y: number }> {
  const box = await el.boundingBox({ timeout });
  if (box === null) throw new Error("element has no bounding box");
  return { x: box.x + (offset?.x ?? box.width / 2), y: box.y + (offset?.y ?? box.height / 2) };
}

/**
 * Real mouse events, not synthetic drag events, so pointer-sensor libraries
 * (dnd-kit) see a genuine press-move-release. Both points are measured before
 * the press: a missing source or destination throws with the mouse still up.
 */
async function drag(page: Page, step: DragStep, timeout: number): Promise<void> {
  const source = await visibleByTestId(page, step.target, timeout);
  await source.scrollIntoViewIfNeeded({ timeout });
  const destination = await visibleByTestId(page, step.to, timeout);
  const from = await pointIn(source, step.grabOffset, timeout);
  const to = await pointIn(destination, step.dropOffset, timeout);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // Nudge toward the destination (or right, for a drop on the grab point).
  const nudge = length === 0 ? { x: DRAG_ACTIVATION_PX, y: 0 } : { x: (dx / length) * DRAG_ACTIVATION_PX, y: (dy / length) * DRAG_ACTIVATION_PX };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    await page.mouse.move(from.x + nudge.x, from.y + nudge.y);
    await page.mouse.move(to.x, to.y, { steps: DRAG_STEPS });
    await page.waitForTimeout(DRAG_HOVER_MS);
    if (step.holdAlt === true) await page.keyboard.down("Alt");
  } finally {
    await page.mouse.up();
    if (step.holdAlt === true) await page.keyboard.up("Alt");
  }
}

/** Currently-visible interactive elements; `index` is the DOM-order position. */
export async function enumerateVisibleCandidates(page: Page): Promise<Candidate[]> {
  return page.evaluate((selector) => {
    const out: Array<{ index: number; role: string | null; accessibleName: string | null; testId: string | null; text: string | null }> = [];
    Array.from(document.querySelectorAll<HTMLElement>(selector)).forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") return;
      out.push({
        index,
        role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
        accessibleName: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? null,
        testId: el.getAttribute("data-testid"),
        text: el.textContent?.trim() ?? null,
      });
    });
    return out;
  }, INTERACTIVE);
}

/**
 * Runs one step and checks its expected state.
 *  - action throws  -> selector is broken: ask the judge for a candidate,
 *    run the *same action* on it, then re-check the expected state.
 *  - action ok but expectation fails -> "failed" (a real behavior failure;
 *    never repaired, never masked by a model).
 *  - drag: a missing source or destination is "broken" with no repair.
 */
export async function executeStep(page: Page, step: ScriptStep, host: string, repair: RepairFn, timeout = 5000): Promise<StepOutcome> {
  try {
    await performAction(page, step, host, timeout);
  } catch {
    if (step.action !== "click" && step.action !== "fill") return "broken";
    return (await repairAndRun(page, step, step.action, repair, timeout)) ? "passed" : "broken";
  }
  try {
    await assertExpectedState(page, step.expectedState);
    return "passed";
  } catch {
    return "failed";
  }
}

async function repairAndRun(page: Page, step: TargetStep, action: "click" | "fill", repair: RepairFn, timeout: number): Promise<boolean> {
  const description = `${action} ${step.target}; expected: ${describeExpectedState(step.expectedState)}`;
  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
    const visible = await enumerateVisibleCandidates(page);
    const chosen = resolveCandidate(await repair(step.target, description, visible), visible);
    if (chosen === null || !candidateFits(action, chosen)) continue;
    try {
      const el = page.locator(INTERACTIVE).nth(chosen.index);
      // The DOM must not have shifted between enumeration and the action.
      if ((await el.getAttribute("data-testid")) !== chosen.testId) continue;
      if (action === "click") await el.click({ timeout });
      else await el.fill(step.value ?? "", { timeout });
      await assertExpectedState(page, step.expectedState);
      return true;
    } catch {
      // action or expectation failed on the proposed candidate: next attempt
    }
  }
  return false;
}
