import { describe, expect, it } from "vitest";

import { ghPublishMain, type GhPublishDeps } from "../src/gh-publish-cli.js";
import type { GhRunner } from "../src/github-publish.js";
import { buildParityEntry } from "../src/parity.js";
import type { ParitySummary } from "../src/parity-publish.js";
import type { RunSummary } from "../src/publish.js";

const okGh = (): { gh: GhRunner; calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    gh: {
      run: async (args) => {
        calls.push(args);
        if (args[1]?.includes("/git/ref/heads/")) return { code: 1, stdout: "", stderr: "HTTP 404" };
        return { code: 0, stdout: JSON.stringify({ sha: "c9" }), stderr: "" };
      },
    },
  };
};

const runSummary: RunSummary = {
  steps: [
    { name: "desktop: goto /", status: "passed", screenshot: "/run/desktop-1.png" },
    { name: "desktop: click save", status: "failed", screenshot: "/run/desktop-2.png" },
  ],
  visual: "looks-right",
  visualReasons: [],
  lintFindings: [],
  runId: "r1",
  host: "http://localhost:3020",
  evidence: { traces: ["/run/desktop-trace.zip"], videos: [], diff: null },
};

const parity: ParitySummary = {
  runId: "p1", host: "http://localhost:3000", provenance: "seeded", appBuild: null, designNode: null, viewport: { w: 2, h: 2 },
  frames: {
    A: buildParityEntry({
      designRegion: { x: 0, y: 0, w: 2, h: 2 }, anchorBox: { x: 0, y: 0, w: 2, h: 2 }, anchorOffset: { x: 0, y: 0 },
      comparison: { diffPixels: 1, total: 4, diffPercent: 25 }, threshold: 0.1, includeAA: false, boxChecks: [],
      knownDifferences: [], files: { design: "d", implementation: "i", diff: "x", sideBySide: "A-side-by-side.png" },
    }),
  },
};

function deps(files: Record<string, string>, gh = okGh().gh) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const d: GhPublishDeps = {
    gh,
    exists: (f) => f in files,
    readFile: (f) => {
      if (!(f in files)) throw new Error(`ENOENT ${f}`);
      return Buffer.from(files[f] as string);
    },
    writeFile: (f, t) => (written[f] = t),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { d, out, err, written };
}

const scriptFiles = { "/run/summary.json": JSON.stringify(runSummary), "/run/desktop-1.png": "a", "/run/desktop-2.png": "b" };
const both = "/run/desktop-1.png,/run/desktop-2.png";
const args = (...extra: string[]) => ["gh-publish", "/run", "--repo", "acme/web", "--pr", "42", ...extra];

describe("gh-publish", () => {
  it("pushes a seeded script run's screenshots and writes a comment that embeds them, with the gh command to post it", async () => {
    const { gh, calls } = okGh();
    const { d, out, written } = deps(scriptFiles, gh);
    expect(await ghPublishMain(args("--db-provenance", "seeded", "--reviewed", both), d)).toBe(0);
    const result = JSON.parse(out[0] as string) as { branch: string; commit: string; post: string[] };
    expect(result.branch).toBe("ui-evidence/pr-42");
    expect(result.post).toEqual(["gh", "pr", "comment", "42", "--repo", "acme/web", "--body-file", "/run/pr-comment.md"]);
    const comment = written["/run/pr-comment.md"] as string;
    expect(comment).toContain("| desktop: click save | failed | ![desktop: click save](https://github.com/acme/web/blob/c9/pr-42/r1/desktop-2.png?raw=true) |");
    expect(comment).toContain("- /run/desktop-trace.zip");
    expect(calls.filter((c) => c[3]?.endsWith("/git/blobs"))).toHaveLength(2);
  });

  it("blocks with exit 3 and pushes nothing until every image is listed as reviewed", async () => {
    const { gh, calls } = okGh();
    const { d, out } = deps(scriptFiles, gh);
    expect(await ghPublishMain(args("--db-provenance", "seeded", "--reviewed", "/run/desktop-1.png"), d)).toBe(3);
    expect(JSON.parse(out[0] as string)).toEqual({ provenance: "seeded", askFirst: true, reviewBlocked: true, unreviewed: ["/run/desktop-2.png"] });
    expect(calls).toEqual([]);
  });

  it("keeps unknown provenance, a preview host and scrubbed parity data off GitHub", async () => {
    const { d, err } = deps(scriptFiles);
    expect(await ghPublishMain(args("--reviewed", both), d)).toBe(1);
    expect(err[0]).toMatch(/provenance unknown: images stay off GitHub/);
    const preview = deps({ ...scriptFiles, "/run/summary.json": JSON.stringify({ ...runSummary, host: "https://pr-1.preview.example.com" }) });
    expect(await ghPublishMain(args("--db-provenance", "seeded", "--reviewed", both), preview.d)).toBe(1);
    const scrubbed = deps({ "/run/parity.json": JSON.stringify({ ...parity, provenance: "scrubbed" }) });
    expect(await ghPublishMain(args("--reviewed", "/run/A-side-by-side.png"), scrubbed.d)).toBe(1);
    expect(scrubbed.err[0]).toMatch(/provenance scrubbed/);
  });

  it("publishes a seeded parity run's side-by-side images into the parity comment", async () => {
    const { d, written } = deps({ "/run/parity.json": JSON.stringify(parity), "/run/A-side-by-side.png": "png" });
    expect(await ghPublishMain(args("--reviewed", "/run/A-side-by-side.png"), d)).toBe(0);
    const comment = written["/run/pr-comment.md"] as string;
    expect(comment).toContain("## Design parity (seeded data, images below)");
    expect(comment).toContain("| A | 25% | — | ![A: Figma, implementation, diff](https://github.com/acme/web/blob/c9/pr-42/p1/A-side-by-side.png?raw=true) |");
  });

  it("exits 4 with the gh error when the push fails, and writes no comment", async () => {
    const failing: GhRunner = { run: async () => ({ code: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)" }) };
    const { d, err, written } = deps(scriptFiles, failing);
    expect(await ghPublishMain(args("--db-provenance", "seeded", "--reviewed", both), d)).toBe(4);
    expect(err[0]).toMatch(/gh-publish failed: .*HTTP 401/);
    expect(written).toEqual({});
  });

  it("rejects bad usage and an unreadable run", async () => {
    for (const a of [["gh-publish"], ["gh-publish", "/run", "--pr", "42"], ["gh-publish", "/run", "--repo", "a/b", "--pr", "x"], args("--db-provenance", "maybe"), args("--allow-writes")]) {
      const { d, err } = deps(scriptFiles);
      expect(await ghPublishMain(a, d)).toBe(1);
      expect(err[0]).toMatch(/^usage:/);
    }
    const { d, err } = deps({});
    expect(await ghPublishMain(args("--db-provenance", "seeded"), d)).toBe(1);
    expect(err[0]).toMatch(/cannot read the run in \/run/);
  });

  it("adds the diff overlay, names the run after its directory when it has no runId, and blocks with no --reviewed at all", async () => {
    const { runId: _drop, ...noId } = runSummary;
    const files = { ...scriptFiles, "/run/summary.json": JSON.stringify({ ...noId, evidence: { traces: [], videos: [], diff: "/run/visual-diff.png" } }), "/run/visual-diff.png": "d" };
    const blocked = deps(files);
    expect(await ghPublishMain(args("--db-provenance", "seeded"), blocked.d)).toBe(3);
    expect((JSON.parse(blocked.out[0] as string) as { unreviewed: string[] }).unreviewed).toEqual(["/run/desktop-1.png", "/run/desktop-2.png", "/run/visual-diff.png"]);
    const { d, written } = deps(files);
    expect(await ghPublishMain(args("--db-provenance", "seeded", "--reviewed", `${both},/run/visual-diff.png`), d)).toBe(0);
    expect(written["/run/pr-comment.md"]).toContain("- ![visual-diff.png](https://github.com/acme/web/blob/c9/pr-42/run/visual-diff.png?raw=true)");
  });

  it("fails clearly when a run has no images on disk", async () => {
    const { d, err } = deps({ "/run/summary.json": JSON.stringify(runSummary) });
    expect(await ghPublishMain(args("--db-provenance", "seeded"), d)).toBe(1);
    expect(err[0]).toBe("no images in /run");
  });
});
