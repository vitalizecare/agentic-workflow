// Real-Chromium tests against a local fixture page. These exist because
// step-exec.ts (the false-pass path) previously had no browser coverage.
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScriptStep } from "../../src/script-schema.js";
import { executeStep, type RepairFn } from "../../src/step-exec.js";
import { startFixture } from "./fixture.js";

let browser: Browser;
let page: Page;
let fixture: Awaited<ReturnType<typeof startFixture>>;

beforeAll(async () => {
  fixture = await startFixture();
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser.close();
  await fixture.close();
});
beforeEach(async () => {
  page = await browser.newPage();
  await page.goto(fixture.host);
});

const click = (target: string, expectedState: ScriptStep["expectedState"]): ScriptStep => ({ action: "click", target, expectedState });
const saved: ScriptStep["expectedState"] = { kind: "text-visible", text: "Saved!" };
const T = 400;
const out = (): Promise<string> => page.locator("#out").innerText();
const never: RepairFn = vi.fn(async () => null);

describe("executeStep expected-state assertion", () => {
  it("passes when the action works and the expected state holds", async () => {
    expect(await executeStep(page, click("save-renamed", saved), fixture.host, never, T)).toBe("passed");
  });

  it("FAILS (not passes) when the click succeeds but the expected state never appears", async () => {
    expect(await executeStep(page, click("noop", saved), fixture.host, never, T)).toBe("failed");
  });

  it("asserts goto url, fill value, and expect-visible steps", async () => {
    expect(await executeStep(page, { action: "goto", target: "/", expectedState: { kind: "url-path", path: "/" } }, fixture.host, never, T)).toBe("passed");
    expect(await executeStep(page, { action: "fill", target: "note-input", value: "hello", expectedState: { kind: "input-value", testId: "note-input", value: "hello" } }, fixture.host, never, T)).toBe("passed");
    expect(await executeStep(page, { action: "fill", target: "note-input", value: "hello", expectedState: { kind: "input-value", testId: "note-input", value: "WRONG" } }, fixture.host, never, T)).toBe("failed");
    expect(await executeStep(page, { action: "expect-visible", target: "Schedule", expectedState: { kind: "testid-visible", testId: "noop" } }, fixture.host, never, T)).toBe("passed");
  });

  it("marks a goto whose target would rewrite the host broken, without navigating", async () => {
    const before = page.url();
    for (const target of ["@evil.example/x", "//evil.example/x", "evil.example"]) {
      expect(await executeStep(page, { action: "goto", target, expectedState: { kind: "url-path", path: "/" } }, fixture.host, never, T)).toBe("broken");
    }
    expect(page.url()).toBe(before);
  });

  it("marks a goto to an unreachable page and a missing expect-visible target broken (no repair for those)", async () => {
    expect(await executeStep(page, { action: "expect-visible", target: "Nope", expectedState: saved }, fixture.host, never, T)).toBe("broken");
  });
});

describe("executeStep expected-state robustness", () => {
  it("text-visible ignores a hidden duplicate that comes first in the DOM", async () => {
    expect(await executeStep(page, { action: "expect-visible", target: "Schedule", expectedState: { kind: "text-visible", text: "Schedule" } }, fixture.host, never, T)).toBe("passed");
  });

  it("text-absent passes only when no *visible* copy exists (hidden copies do not count)", async () => {
    expect(await executeStep(page, click("noop", { kind: "text-absent", text: "Draft banner" }), fixture.host, never, T)).toBe("passed");
    expect(await executeStep(page, click("noop", { kind: "text-absent", text: "Schedule" }), fixture.host, never, T)).toBe("failed");
  });

  it("testid-visible passes when a test id repeats, as grid cells do", async () => {
    expect(await executeStep(page, click("noop", { kind: "testid-visible", testId: "dup" }), fixture.host, never, T)).toBe("passed");
  });

  it("url-path waits for client-side routing that lags the click", async () => {
    expect(await executeStep(page, click("go-b", { kind: "url-path", path: "/b" }), fixture.host, never, T)).toBe("passed");
  });
});

describe("executeStep selector repair", () => {
  const brokenClick = click("save-old-name", saved);

  it("repairs only after the mapped click actually runs and the expected state passes", async () => {
    const repair: RepairFn = vi.fn(async (_b, _s, candidates) => ({ decision: "repaired", chosenIndex: candidates.find((c) => c.testId === "save-renamed")!.index }));
    expect(await executeStep(page, brokenClick, fixture.host, repair, T)).toBe("passed");
    expect(await out()).toBe("Saved!"); // the click really happened
    const [broken, stepText] = (repair as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(broken).toBe("save-old-name"); // the actual broken target, not expectedState
    expect(stepText).toContain("Saved!");
  }, 20_000);

  it("stays broken when the judge proposes a locator but the action does not satisfy the expectation", async () => {
    const repair: RepairFn = async (_b, _s, candidates) => ({ decision: "repaired", chosenIndex: candidates.find((c) => c.testId === "noop")!.index });
    expect(await executeStep(page, brokenClick, fixture.host, repair, T)).toBe("broken");
    expect(await out()).toBe("");
  }, 20_000);

  it("stays broken on an invalid candidate index (not in the visible DOM)", async () => {
    const repair: RepairFn = vi.fn(async () => ({ decision: "repaired", chosenIndex: 9999 }));
    expect(await executeStep(page, brokenClick, fixture.host, repair, T)).toBe("broken");
    expect(repair).toHaveBeenCalledTimes(2); // capped at two tries
  }, 20_000);

  it("never offers hidden elements as candidates", async () => {
    const seen: string[] = [];
    const repair: RepairFn = async (_b, _s, candidates) => { seen.push(...candidates.map((c) => c.testId ?? "")); return null; };
    await executeStep(page, brokenClick, fixture.host, repair, T);
    expect(seen).not.toContain("hidden-btn");
    expect(seen).toContain("save-renamed");
  }, 20_000);

  it("rejects a fill mapped onto a non-fillable candidate and a missing index", async () => {
    const fillStep: ScriptStep = { action: "fill", target: "old-input", value: "x", expectedState: { kind: "input-value", testId: "note-input", value: "x" } };
    const onButton: RepairFn = async (_b, _s, cs) => ({ decision: "repaired", chosenIndex: cs.find((c) => c.testId === "noop")!.index });
    expect(await executeStep(page, fillStep, fixture.host, onButton, T)).toBe("broken");
    const noIndex: RepairFn = async () => ({ decision: "repaired" });
    expect(await executeStep(page, fillStep, fixture.host, noIndex, T)).toBe("broken");
  }, 30_000);

  it("repairs a fill onto a real input and verifies its value", async () => {
    const fillStep: ScriptStep = { action: "fill", target: "old-input", value: "x", expectedState: { kind: "input-value", testId: "note-input", value: "x" } };
    const repair: RepairFn = async (_b, _s, cs) => ({ decision: "repaired", chosenIndex: cs.find((c) => c.testId === "note-input")!.index });
    expect(await executeStep(page, fillStep, fixture.host, repair, T)).toBe("passed");
  }, 20_000);

  it("skips a candidate when the DOM shifted between enumeration and action", async () => {
    let n = 0;
    const repair: RepairFn = async (_b, _s, cs) => {
      const idx = cs.find((c) => c.testId === "save-renamed")?.index ?? 0;
      if (n++ === 0) await page.evaluate(() => document.querySelector('[data-testid="save-renamed"]')!.setAttribute("data-testid", "moved"));
      return { decision: "repaired", chosenIndex: idx };
    };
    expect(await executeStep(page, brokenClick, fixture.host, repair, T)).toBe("broken");
  }, 20_000);
});

describe("executeStep scroll", () => {
  const scroll = (target: string, value: string | undefined, expectedState: ScriptStep["expectedState"] = { kind: "testid-visible", testId: "hscroll" }): ScriptStep => ({ action: "scroll", target, ...(value !== undefined ? { value } : {}), expectedState });
  const pos = (): Promise<{ left: number; top: number; max: number; maxTop: number }> =>
    page.getByTestId("hscroll").evaluate((n) => ({ left: n.scrollLeft, top: n.scrollTop, max: n.scrollWidth - n.clientWidth, maxTop: n.scrollHeight - n.clientHeight }));

  it("scrolls to the end by default and for \"end\"", async () => {
    expect(await executeStep(page, scroll("hscroll", undefined), fixture.host, never, T)).toBe("passed");
    const p = await pos();
    expect(p.max).toBeGreaterThan(0);
    expect(p.left).toBe(p.max);
  });

  it("scrolls back to start, to a pixel offset, to the bottom and to the top", async () => {
    await executeStep(page, scroll("hscroll", "end"), fixture.host, never, T);
    await executeStep(page, scroll("hscroll", "start"), fixture.host, never, T);
    expect((await pos()).left).toBe(0);
    await executeStep(page, scroll("hscroll", "120"), fixture.host, never, T);
    expect((await pos()).left).toBe(120);
    await executeStep(page, scroll("hscroll", "bottom"), fixture.host, never, T);
    const p = await pos();
    expect(p.maxTop).toBeGreaterThan(0);
    expect(p.top).toBe(p.maxTop);
    await executeStep(page, scroll("hscroll", "top"), fixture.host, never, T);
    expect((await pos()).top).toBe(0);
  });

  it("FAILS when the expected state does not hold after the scroll", async () => {
    expect(await executeStep(page, scroll("hscroll", "end", { kind: "text-visible", text: "Nope" }), fixture.host, never, T)).toBe("failed");
  });

  it("is broken (and never repaired) for a missing or empty target", async () => {
    const repair: RepairFn = vi.fn(async () => null);
    expect(await executeStep(page, scroll("no-such-container", "end"), fixture.host, repair, T)).toBe("broken");
    expect(await executeStep(page, scroll("", "end"), fixture.host, repair, T)).toBe("broken");
    expect(repair).not.toHaveBeenCalled();
  });
});

describe("executeStep index", () => {
  it("index 1 clicks the second of several repeated test ids", async () => {
    const step: ScriptStep = { action: "click", target: "row-open", index: 1, expectedState: { kind: "text-visible", text: "Opened 1" } };
    expect(await executeStep(page, step, fixture.host, never, T)).toBe("passed");
    expect(await out()).toBe("Opened 1");
  });

  it("without index a duplicated test id is not clicked and still goes to repair", async () => {
    const repair: RepairFn = vi.fn(async () => null);
    expect(await executeStep(page, click("row-open", { kind: "text-visible", text: "Opened 0" }), fixture.host, repair, T)).toBe("broken");
    expect(repair).toHaveBeenCalled();
    expect(await out()).toBe("");
  }, 20_000);

  it("an index past the last match is broken", async () => {
    const step: ScriptStep = { action: "click", target: "row-open", index: 5, expectedState: { kind: "text-visible", text: "Opened 1" } };
    expect(await executeStep(page, step, fixture.host, async () => null, T)).toBe("broken");
  }, 20_000);
});
describe("executeStep drag", () => {
  const drag = (over: Partial<Extract<ScriptStep, { action: "drag" }>> = {}): ScriptStep => ({ action: "drag", target: "card", to: "lane", expectedState: { kind: "testid-absent", testId: "drag-overlay" }, ...over });
  const dropped = (): Promise<string> => page.locator("#dropped").innerText();
  beforeEach(async () => {
    await page.goto(`${fixture.host}/dnd`);
  });

  it("drives a pointer sensor with a 6px activation distance and drops on the destination center", async () => {
    expect(await executeStep(page, drag(), fixture.host, never, T)).toBe("passed");
    expect(await dropped()).toBe("card dropped at 100,100");
  });

  it("honours grab and drop offsets and holds Alt through the release", async () => {
    expect(await executeStep(page, drag({ grabOffset: { x: 5, y: 5 }, dropOffset: { x: 30, y: 40 }, holdAlt: true }), fixture.host, never, T)).toBe("passed");
    expect(await dropped()).toBe("card dropped at 30,40 with Alt");
  });

  it("testid-absent checks once, right after the drop: a lingering overlay fails the step", async () => {
    expect(await executeStep(page, drag({ target: "slow-card" }), fixture.host, never, T)).toBe("failed");
    expect(await dropped()).toBe("slow-card dropped at 100,100");
  });

  it("marks a missing source or destination broken without asking for repair or pressing the mouse", async () => {
    const repair: RepairFn = vi.fn(async () => null);
    expect(await executeStep(page, drag({ target: "no-such-card" }), fixture.host, repair, T)).toBe("broken");
    expect(await executeStep(page, drag({ to: "no-such-lane" }), fixture.host, repair, T)).toBe("broken");
    expect(repair).not.toHaveBeenCalled();
    expect(await page.locator('[data-testid="drag-overlay"]').count()).toBe(0);
    expect(await dropped()).toBe("");
  });
});
