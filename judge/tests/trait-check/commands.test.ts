import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TraitCheckDeps } from "../../src/trait-check/check.js";

const runTraitCheck = vi.fn();
vi.mock("../../src/trait-check/check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/trait-check/check.js")>()),
  runTraitCheck: (...args: unknown[]) => runTraitCheck(...args),
}));
const { runTraitCheckCli } = await import("../../src/trait-check/commands.js");

const deps = {} as TraitCheckDeps;
const finding = {
  trait: { name: "alpha", subject: "s", requirement: "r", purpose: "p", severity: "block", file: "/repo/.agents/traits/alpha.yaml" },
  source: { path: "a.ts", startLine: 1, endLine: 2, text: "" },
  p: 0.9,
};

beforeEach(() => runTraitCheck.mockReset());

describe("runTraitCheckCli", () => {
  it("rejects bad usage with exit 64", async () => {
    for (const args of [[], ["--edit"], ["--stop", "--file", "a"], ["--edit", "--stop"], ["--bogus"], ["--stop", "--base"], ["--stop", "--budget-ms", "0"], ["--stop", "--min-p", "2"], ["--stop", "--budget-ms", "1.5"], ["--stop", "--path", "src"], ["--edit", "--file", "a", "--trait", "x"], ["--stop", "--concurrency", "2"], ["--scan", "--concurrency", "0"], ["--scan", "--file", "a"]]) {
      expect(await runTraitCheckCli(args, deps)).toMatchObject({ exitCode: 64 });
    }
    expect(runTraitCheck).not.toHaveBeenCalled();
  });

  it("passes per-mode defaults and explicit flags through", async () => {
    runTraitCheck.mockResolvedValue({ status: "skipped", reason: "no-traits" });
    await runTraitCheckCli(["--edit", "--file", "a.ts", "--file", "b.ts"], deps);
    expect(runTraitCheck).toHaveBeenLastCalledWith(deps, { mode: "edit", files: ["a.ts", "b.ts"], base: "origin/main", paths: [], traits: [], budgetMs: 15_000, minP: 0.6, concurrency: 4 });
    await runTraitCheckCli(["--stop"], deps);
    expect(runTraitCheck).toHaveBeenLastCalledWith(deps, { mode: "stop", files: [], base: "origin/main", paths: [], traits: [], budgetMs: 40_000, minP: 0.8, concurrency: 4 });
    await runTraitCheckCli(["--stop", "--base", "origin/dev", "--budget-ms", "5000", "--min-p", "0.5"], deps);
    expect(runTraitCheck).toHaveBeenLastCalledWith(deps, { mode: "stop", files: [], base: "origin/dev", paths: [], traits: [], budgetMs: 5000, minP: 0.5, concurrency: 4 });
    await runTraitCheckCli(["--scan"], deps);
    expect(runTraitCheck).toHaveBeenLastCalledWith(deps, { mode: "scan", files: [], base: "origin/main", paths: [], traits: [], budgetMs: 3_600_000, minP: 0.8, concurrency: 12 });
    await runTraitCheckCli(["--scan", "--path", "src", "--path", "lib", "--trait", "alpha", "--concurrency", "3"], deps);
    expect(runTraitCheck).toHaveBeenLastCalledWith(deps, { mode: "scan", files: [], base: "origin/main", paths: ["src", "lib"], traits: ["alpha"], budgetMs: 3_600_000, minP: 0.8, concurrency: 3 });
  });

  it("maps results to exit codes", async () => {
    runTraitCheck.mockResolvedValueOnce({ status: "skipped", reason: "no-traits" });
    expect(await runTraitCheckCli(["--stop"], deps)).toEqual({ exitCode: 0, stdout: "" });
    runTraitCheck.mockResolvedValueOnce({ status: "unavailable", reason: "no-api-key" });
    expect(await runTraitCheckCli(["--stop"], deps)).toEqual({ exitCode: 3, stdout: "", stderr: "trait-check: jev unavailable (no-api-key)" });
    runTraitCheck.mockResolvedValueOnce({ status: "checked", root: "/repo", findings: [], requests: 1 });
    expect(await runTraitCheckCli(["--stop"], deps)).toEqual({ exitCode: 0, stdout: "" });
    runTraitCheck.mockResolvedValueOnce({ status: "checked", root: "/repo", findings: [finding], requests: 1 });
    const out = await runTraitCheckCli(["--edit", "--file", "a.ts"], deps);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("1. alpha — a.ts lines 1-2 (p=0.90)");
    runTraitCheck.mockResolvedValueOnce({ status: "checked", root: "/repo", findings: [finding], requests: 3 });
    expect(await runTraitCheckCli(["--scan"], deps)).toEqual({
      exitCode: 2,
      stdout: '{"trait":"alpha","severity":"block","path":"a.ts","lines":[1,2],"p":0.9}',
      stderr: "trait-check: 1 finding from 3 Jev requests",
    });
    runTraitCheck.mockResolvedValueOnce({ status: "checked", root: "/repo", findings: [finding, finding], requests: 3 });
    expect((await runTraitCheckCli(["--scan"], deps)).stderr).toBe("trait-check: 2 findings from 3 Jev requests");
  });
});
