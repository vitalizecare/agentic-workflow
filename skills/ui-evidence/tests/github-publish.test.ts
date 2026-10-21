import { describe, expect, it } from "vitest";

import { evidenceBranch, imageUrl, pushImages, type GhRunner } from "../src/github-publish.js";

interface Call { args: string[]; body: Record<string, unknown> | null }

/** A fake gh: answers the git data API calls pushImages makes and records each one with its JSON body. */
function fakeGh(opts: { head?: string | null; fail?: string } = {}): { gh: GhRunner; calls: Call[] } {
  const calls: Call[] = [];
  let blobs = 0;
  const gh: GhRunner = {
    run: async (args, stdin) => {
      calls.push({ args, body: stdin === undefined ? null : (JSON.parse(stdin) as Record<string, unknown>) });
      const route = args.find((a) => a.startsWith("repos/")) ?? "";
      if (opts.fail !== undefined && route.endsWith(opts.fail)) return { code: 1, stdout: "", stderr: "gh: Resource not accessible by integration (HTTP 403)" };
      const ok = (o: unknown) => ({ code: 0, stdout: JSON.stringify(o), stderr: "" });
      if (route.includes("/git/ref/heads/")) return opts.head == null ? { code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" } : ok({ object: { sha: opts.head } });
      if (route.includes("/git/commits/")) return ok({ tree: { sha: "parent-tree" } });
      if (route.endsWith("/git/blobs")) return ok({ sha: `blob-${++blobs}` });
      if (route.endsWith("/git/trees")) return ok({ sha: "tree-1" });
      if (route.endsWith("/git/commits")) return ok({ sha: "commit-1" });
      return ok({ ref: "refs/heads/x" });
    },
  };
  return { gh, calls };
}

const req = { repo: "acme/web", pr: 42, runId: "run 7", files: ["/w/desktop-1.png", "/w/visual-diff.png"], readFile: (f: string) => Buffer.from(`bytes of ${f}`) };
const route = (c: Call): string => c.args.find((a) => a.startsWith("repos/")) ?? "";

describe("pushImages", () => {
  it("creates the PR's evidence branch as an orphan commit holding every image, and returns commit-pinned URLs", async () => {
    const { gh, calls } = fakeGh();
    const r = await pushImages(gh, req);
    expect(r).toEqual({
      branch: "ui-evidence/pr-42",
      commit: "commit-1",
      urls: {
        "/w/desktop-1.png": "https://github.com/acme/web/blob/commit-1/pr-42/run_7/desktop-1.png?raw=true",
        "/w/visual-diff.png": "https://github.com/acme/web/blob/commit-1/pr-42/run_7/visual-diff.png?raw=true",
      },
    });
    const blob = calls.find((c) => route(c).endsWith("/git/blobs"));
    expect(blob?.body).toEqual({ content: Buffer.from("bytes of /w/desktop-1.png").toString("base64"), encoding: "base64" });
    const tree = calls.find((c) => route(c).endsWith("/git/trees"));
    expect(tree?.body).toEqual({ tree: [
      { path: "pr-42/run_7/desktop-1.png", mode: "100644", type: "blob", sha: "blob-1" },
      { path: "pr-42/run_7/visual-diff.png", mode: "100644", type: "blob", sha: "blob-2" },
    ] });
    expect(calls.find((c) => route(c).endsWith("/git/commits"))?.body).toMatchObject({ tree: "tree-1", parents: [] });
    const ref = calls.at(-1) as Call;
    expect(ref.args).toEqual(["api", "--method", "POST", "repos/acme/web/git/refs", "--input", "-"]);
    expect(ref.body).toEqual({ ref: "refs/heads/ui-evidence/pr-42", sha: "commit-1" });
  });

  it("adds to an existing branch on top of its tree and fast-forwards it, never forcing", async () => {
    const { gh, calls } = fakeGh({ head: "old-head" });
    await pushImages(gh, req);
    expect(calls.find((c) => route(c).endsWith("/git/trees"))?.body).toMatchObject({ base_tree: "parent-tree" });
    expect(calls.find((c) => route(c).endsWith("/git/commits"))?.body).toMatchObject({ parents: ["old-head"] });
    const ref = calls.at(-1) as Call;
    expect(ref.args.slice(0, 4)).toEqual(["api", "--method", "PATCH", "repos/acme/web/git/refs/heads/ui-evidence/pr-42"]);
    expect(ref.body).toEqual({ sha: "commit-1", force: false });
  });

  it("surfaces a gh failure with its first stderr line and stops", async () => {
    const { gh, calls } = fakeGh({ fail: "/git/trees" });
    await expect(pushImages(gh, req)).rejects.toThrow(/git\/trees failed: gh: Resource not accessible by integration \(HTTP 403\)/);
    expect(calls.some((c) => route(c).endsWith("/git/refs"))).toBe(false);
  });

  it("refuses a bad repo, PR number, no files and clashing file names before calling gh", async () => {
    const { gh, calls } = fakeGh();
    await expect(pushImages(gh, { ...req, repo: "acme" })).rejects.toThrow(/owner\/name/);
    await expect(pushImages(gh, { ...req, repo: "acme/web/../x" })).rejects.toThrow(/owner\/name/);
    await expect(pushImages(gh, { ...req, pr: 0 })).rejects.toThrow(/PR number/);
    await expect(pushImages(gh, { ...req, files: [] })).rejects.toThrow(/no images/);
    await expect(pushImages(gh, { ...req, files: ["/a/x.png", "/b/x.png"] })).rejects.toThrow(/share a file name/);
    expect(calls).toEqual([]);
  });

  it("treats any non-404 branch lookup failure as an error, not a missing branch", async () => {
    const gh: GhRunner = { run: async () => ({ code: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)" }) };
    await expect(pushImages(gh, req)).rejects.toThrow(/HTTP 401/);
  });
});

describe("evidenceBranch and imageUrl", () => {
  it("names the branch per PR and encodes each path segment", () => {
    expect(evidenceBranch(7)).toBe("ui-evidence/pr-7");
    expect(imageUrl("a/b", "c1", "pr-7/r/a b.png")).toBe("https://github.com/a/b/blob/c1/pr-7/r/a%20b.png?raw=true");
  });
});
