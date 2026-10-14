import type { ExpectedState } from "./script-schema.js";

// The slice of Playwright's Page an assertion needs, so the assertion logic
// is exercised by both a fake (unit) and a real browser (integration).
export interface AssertablePage {
  waitForURL(predicate: (url: URL) => boolean, o: { timeout: number }): Promise<void>;
  getByText(text: string): { locator(selector: string): { first(): { waitFor(o: { state: "visible" | "hidden"; timeout: number }): Promise<void> } } };
  getByTestId(id: string): {
    inputValue(o: { timeout: number }): Promise<string>;
    locator(selector: string): { count(): Promise<number>; first(): { waitFor(o: { state: "visible"; timeout: number }): Promise<void> } };
  };
}

const TIMEOUT = 3000;
// Desktop/phone layouts often render the same text twice with one copy hidden,
// so text checks look only at *visible* matches, never at the first DOM match.
const VISIBLE = "visible=true";

/** Throws when the expectation does not hold; resolves when it does. */
export async function assertExpectedState(page: AssertablePage, e: ExpectedState): Promise<void> {
  switch (e.kind) {
    case "text-visible":
      await page.getByText(e.text).locator(VISIBLE).first().waitFor({ state: "visible", timeout: TIMEOUT });
      return;
    case "text-absent":
      await page.getByText(e.text).locator(VISIBLE).first().waitFor({ state: "hidden", timeout: TIMEOUT });
      return;
    case "testid-visible":
      // First visible match, like every step target: a grid repeats test ids
      // per cell, and a strict lookup throws on more than one match.
      await page.getByTestId(e.testId).locator(VISIBLE).first().waitFor({ state: "visible", timeout: TIMEOUT });
      return;
    case "testid-absent": {
      // One immediate look, no waiting for the element to go: a transient
      // leftover right after the action (a drag drop) must fail the step.
      const visible = await page.getByTestId(e.testId).locator(VISIBLE).count();
      if (visible > 0) throw new Error(`expected no visible ${e.testId}, found ${visible}`);
      return;
    }
    case "url-path":
      // Waits like every other kind: client-side routing can lag the click.
      await page.waitForURL((u) => u.pathname === e.path, { timeout: TIMEOUT });
      return;
    case "input-value": {
      const actual = await page.getByTestId(e.testId).inputValue({ timeout: TIMEOUT });
      if (actual !== e.value) throw new Error(`expected input ${e.testId} = "${e.value}", got "${actual}"`);
      return;
    }
  }
}
