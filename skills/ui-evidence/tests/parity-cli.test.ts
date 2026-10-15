import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildParityEntry } from "../src/parity.js";
import { parityMain, parseFlags, type ParityDeps } from "../src/parity-cli.js";
import type { ParitySummary } from "../src/parity-publish.js";

// Preview hosts are deployment config; these tests use a fictional one.
beforeEach(() => vi.stubEnv("UI_EVIDENCE_PREVIEW_HOST_PATTERN", "pr-[0-9]+\\.preview\\.example\\.com"));
afterEach(() => vi.unstubAllEnvs());

const manifest = (steps?: unknown[]) =>
  JSON.stringify({ route: "/x", ready: { text: "Hours" }, frames: [{ name: "A", designPng: "d.png", designRegion: { x: 0, y: 0, w: 2, h: 2 }, anchor: { testId: "card" }, steps }] });
const click = (target: string) => ({ action: "click", target, expectedState: { kind: "testid-visible", testId: target } });

const entry = (pass: boolean) =>
  buildParityEntry({
    designRegion: { x: 0, y: 0, w: 2, h: 2 }, anchorBox: { x: 0, y: 0, w: 2, h: 2 }, anchorOffset: { x: 0, y: 0 },
    comparison: { diffPixels: 0, total: 4, diffPercent: 0 }, threshold: 0.1, includeAA: false,
    boxChecks: [{ target: "testId:card", relativeTo: null, expected: { w: 2 }, actual: null, tolerance: 0, pass, ...(pass ? {} : { failure: "w 1 != 2" }) }],
    knownDifferences: [], files: { design: "d", implementation: "i", diff: "x", sideBySide: "A-side-by-side.png" },
  });
const summary = (over: Partial<ParitySummary> = {}, pass = true): ParitySummary => ({
  runId: "r", host: "http://localhost:3000", provenance: "scrubbed", appBuild: null, designNode: null, viewport: { w: 1512, h: 982 }, frames: { A: entry(pass) }, ...over,
});

function deps(over: Partial<ParityDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const d: ParityDeps = { run: async () => summary(), readFile: () => manifest(), sizeOf: () => 10, out: (l) => out.push(l), err: (l) => err.push(l), ...over };
  return { d, out, err };
}

describe("parseFlags", () => {
  it("handles switches and value flags, rejects unknown flags and missing values", () => {
    expect(parseFlags(["--allow-writes", "--host", "h"])).toEqual({ "--allow-writes": true, "--host": "h" });
    expect(parseFlags(["--nope"])).toBeNull();
    expect(parseFlags(["--host"])).toBeNull();
  });
});

describe("parity", () => {
  it("runs on localhost by default, prints the summary, exits 0 when geometry passes", async () => {
    const run = vi.fn().mockResolvedValue(summary());
    const { d, out } = deps({ run });
    expect(await parityMain(["parity", "m.json", "/runs/r"], d)).toBe(0);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ route: "/x" }), "/runs/r", { host: "http://localhost:3000", hostKind: "local" });
    expect(JSON.parse(out[0] as string).runId).toBe("r");
  });

  it("passes a preview host, build and DB provenance through", async () => {
    const run = vi.fn().mockResolvedValue(summary());
    const { d } = deps({ run });
    await parityMain(["parity", "m.json", "r", "--host", "https://pr-9.preview.example.com", "--allow-preview-host", "--app-build", "abc", "--db-provenance", "seeded"], d);
    expect(run).toHaveBeenCalledWith(expect.anything(), "r", { host: "https://pr-9.preview.example.com", hostKind: "preview", appBuild: "abc", dbProvenance: "seeded" });
  });

  it("exits 2 and reports each failed geometry check", async () => {
    const { d, err } = deps({ run: async () => summary({}, false) });
    expect(await parityMain(["parity", "m.json", "r"], d)).toBe(2);
    expect(err).toEqual(["geometry: A testId:card: w 1 != 2"]);
  });

  it("exits 4 (distinct from a geometry failure) with the message when the run throws", async () => {
    const { d, err } = deps({ run: async () => { throw new Error("anchor not found"); } });
    expect(await parityMain(["parity", "m.json", "r"], d)).toBe(4);
    expect(err[0]).toBe("parity run failed: anchor not found");
  });

  it.each([
    [["parity"]],
    [["parity", "m.json"]],
    [["parity", "m.json", "r", "--bogus"]],
    [["parity", "m.json", "r", "--db-provenance", "maybe"]],
    [["other", "m.json", "r"]],
  ])("exits 1 with usage for %j", async (argv) => {
    const { d, err } = deps();
    expect(await parityMain(argv, d)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  it("exits 1 for an unreadable or invalid manifest without running", async () => {
    const run = vi.fn();
    const unreadable = deps({ run, readFile: () => { throw new Error("ENOENT"); } });
    expect(await parityMain(["parity", "m.json", "r"], unreadable.d)).toBe(1);
    expect(unreadable.err[0]).toContain("ENOENT");
    const invalid = deps({ run, readFile: () => "{}" });
    expect(await parityMain(["parity", "m.json", "r"], invalid.d)).toBe(1);
    expect(invalid.err[0]).toContain("invalid manifest");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a non-preview host, a host without the opt-in, and write-looking steps — before running", async () => {
    const run = vi.fn();
    for (const [argv, why] of [
      [["parity", "m.json", "r", "--host", "https://app.preview.example.com", "--allow-preview-host"], "preview host"],
      [["parity", "m.json", "r", "--host", "https://pr-1.preview.example.com"], "--allow-preview-host"],
    ] as const) {
      const { d, err } = deps({ run });
      expect(await parityMain([...argv], d)).toBe(1);
      expect(err[0]).toContain(why);
    }
    const writes = deps({ run, readFile: () => manifest([click("update-hospital-button")]) });
    expect(await parityMain(["parity", "m.json", "r"], writes.d)).toBe(1);
    expect(writes.err[0]).toContain("--allow-writes");
    expect(run).not.toHaveBeenCalled();
    const escape = deps({ run, readFile: () => manifest([{ action: "goto", target: "@app.preview.example.com/admin", expectedState: { kind: "url-path", path: "/" } }]) });
    expect(await parityMain(["parity", "m.json", "r", "--allow-writes"], escape.d)).toBe(1);
    expect(escape.err[0]).toContain("goto targets must be paths");
    const allowed = deps({ readFile: () => manifest([click("update-hospital-button")]) });
    expect(await parityMain(["parity", "m.json", "r", "--allow-writes"], allowed.d)).toBe(0);
  });
});

describe("parity-plan", () => {
  it("prints the plan and exits 3 until every image is reviewed", async () => {
    const { d, out } = deps({ readFile: () => JSON.stringify(summary()) });
    expect(await parityMain(["parity-plan", "/runs/r"], d)).toBe(3);
    const blocked = JSON.parse(out[0] as string);
    expect(blocked).toMatchObject({ askFirst: true, reviewBlocked: true, unreviewed: ["/runs/r/A-side-by-side.png"] });
    expect(blocked.plan[0].title).toBe("Pixel diff: A (Figma | implementation | diff)");
  });
  it("exits 0 once the agent lists every file as reviewed", async () => {
    const { d, out } = deps({ readFile: () => JSON.stringify(summary()) });
    expect(await parityMain(["parity-plan", "/runs/r", "--reviewed", "/runs/r/A-side-by-side.png"], d)).toBe(0);
    expect(JSON.parse(out[0] as string).reviewBlocked).toBe(false);
  });
  it("refuses to plan an upload for unknown provenance", async () => {
    const { d, err } = deps({ readFile: () => JSON.stringify(summary({ provenance: "unknown" })) });
    expect(await parityMain(["parity-plan", "/runs/r"], d)).toBe(1);
    expect(err[0]).toContain("stays local");
  });
  it("fails on missing args, bad flags, or an unreadable parity.json", async () => {
    expect(await parityMain(["parity-plan"], deps().d)).toBe(1);
    expect(await parityMain(["parity-plan", "r", "--bogus"], deps().d)).toBe(1);
    const { d, err } = deps({ readFile: () => { throw new Error("ENOENT"); } });
    expect(await parityMain(["parity-plan", "r"], d)).toBe(1);
    expect(err[0]).toContain("ENOENT");
  });
});
