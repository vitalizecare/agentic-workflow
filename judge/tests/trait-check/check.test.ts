import { describe, expect, it, vi } from "vitest";

import { formatFindings, formatScanFindings, question, runTraitCheck, type Finding, type TraitCheckDeps, type TraitCheckOptions } from "../../src/trait-check/check.js";
import type { Trait } from "../../src/trait-check/trait.js";

const ROOT = "/repo";
const STATE = "/state";
const REPO_TRAITS = `${ROOT}/.agents/traits`;
const LOCAL_TRAITS = `${STATE}/traits/web-app`;

const traitDoc = (name: string, extra = "") =>
  `---\nname: ${name}\nsubject: S ${name}.\nrequirement: R ${name}.\npurpose: P.\n${extra}---\n`;

const diffFor = (file: string, line = "+x") => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${line}\n`;

type Answers = Record<string, unknown>;

function setup(opts: {
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
  git?: (args: readonly string[]) => { code: number; stdout: string } | undefined;
  answer?: (questionKeys: string[], call: number) => { status: number; body?: unknown } | "throw";
  now?: () => number;
}) {
  const files = opts.files ?? {};
  const log: Record<string, unknown>[] = [];
  const calls: { keys: string[]; budget: number; state: unknown }[] = [];
  let call = 0;
  const fetch = vi.fn(async (_url: string, init: { body: string; signal: AbortSignal }) => {
    const body = JSON.parse(init.body) as { questions: Record<string, unknown>; state: unknown };
    const keys = Object.keys(body.questions);
    calls.push({ keys, budget: 0, state: body.state });
    const r = opts.answer?.(keys, call++) ?? { status: 200, body: { answers: {} } };
    if (r === "throw") throw new Error("down");
    return { status: r.status, json: async () => r.body };
  });
  const deps: TraitCheckDeps = {
    cwd: `${ROOT}/sub`,
    stateDir: STATE,
    git: async (args) => {
      const custom = opts.git?.(args);
      if (custom !== undefined) return custom;
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: `${ROOT}\n` };
      if (args[0] === "rev-parse") return { code: 0, stdout: "/repos/web-app/.git\n" };
      return { code: 0, stdout: "" };
    },
    listDir: (dir) => opts.dirs?.[dir] ?? [],
    readFile: (file) => files[file] ?? null,
    jev: { fetch, apiKey: async () => "k" },
    appendLog: (entry) => log.push(entry),
    now: opts.now ?? (() => 0),
  };
  return { deps, log, calls, fetch };
}

const EDIT: TraitCheckOptions = { mode: "edit", files: ["../src/a.ts"], base: "origin/main", budgetMs: 1000, minP: 0.6 };
const STOP: TraitCheckOptions = { mode: "stop", files: [], base: "origin/main", budgetMs: 1000, minP: 0.8 };

const choice = (c: string, probabilities: Record<string, number> = {}, confidence = 1) => ({ type: "choice", choice: c, probabilities, confidence });

describe("runTraitCheck", () => {
  it("skips outside a git repo", async () => {
    const { deps } = setup({ git: (args) => (args[0] === "rev-parse" ? { code: 128, stdout: "" } : undefined) });
    expect(await runTraitCheck(deps, EDIT)).toEqual({ status: "skipped", reason: "not-a-repo" });
  });

  it("skips when the repo and overlay have no readable traits, logging parse errors", async () => {
    const { deps, log } = setup({ dirs: { [REPO_TRAITS]: ["broken.md", "notes.txt"] } });
    expect(await runTraitCheck(deps, EDIT)).toEqual({ status: "skipped", reason: "no-traits" });
    expect(log).toEqual([{ event: "trait-parse-error", file: `${REPO_TRAITS}/broken.md`, error: "missing or unterminated --- frontmatter" }]);
  });

  it("skips edits outside the repo or outside every trait's paths without calling git diff", async () => {
    const git = vi.fn(() => undefined);
    const { deps, fetch } = setup({
      dirs: { [REPO_TRAITS]: ["ts-only.md"] },
      files: { [`${REPO_TRAITS}/ts-only.md`]: traitDoc("ts-only", 'paths: ["**/*.ts"]\n') },
      git,
    });
    expect(await runTraitCheck(deps, { ...EDIT, files: ["/elsewhere/a.ts", "../README.md", ".."] })).toEqual({ status: "skipped", reason: "nothing-in-scope" });
    expect(git.mock.calls.some((c) => (c as unknown as [readonly string[]])[0][0] === "diff")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks an edited file (tracked + untracked) and reports violations at or above minP", async () => {
    const { deps, log, calls } = setup({
      dirs: { [REPO_TRAITS]: ["alpha.md", "beta.md"], [LOCAL_TRAITS]: ["beta.md", "gamma.md"] },
      files: {
        [`${REPO_TRAITS}/alpha.md`]: traitDoc("alpha", "severity: warn\n"),
        [`${REPO_TRAITS}/beta.md`]: traitDoc("beta"),
        [`${LOCAL_TRAITS}/beta.md`]: traitDoc("beta", "guidance: Overlay wins.\n"),
        [`${LOCAL_TRAITS}/gamma.md`]: traitDoc("gamma"),
      },
      git: (args) => {
        if (args[0] === "diff" && args[1] === "--no-index") return { code: 1, stdout: diffFor("src/new.ts", "+new") };
        if (args[0] === "diff") return { code: 0, stdout: diffFor("src/a.ts") };
        if (args[0] === "ls-files") return { code: 0, stdout: "src/new.ts\0" };
        return undefined;
      },
      answer: (keys) => ({
        status: 200,
        body: {
          answers: Object.fromEntries(keys.map((k) => [k, k === "alpha" ? choice("violation", { violation: 0.7 }) : k === "beta" ? choice("violation", {}, 0.9) : choice("compliant")])),
        },
      }),
    });
    const out = await runTraitCheck(deps, EDIT);
    expect(out.status).toBe("checked");
    if (out.status !== "checked") return;
    expect(out.root).toBe(ROOT);
    expect(out.requests).toBe(2);
    expect(out.findings.map((f) => [f.trait.name, f.source.path, f.p])).toEqual([
      ["beta", "src/a.ts", 0.9],
      ["beta", "src/new.ts", 0.9],
      ["alpha", "src/a.ts", 0.7],
      ["alpha", "src/new.ts", 0.7],
    ]);
    expect(out.findings[0]?.trait.guidance).toBe("Overlay wins.");
    expect(calls[0]?.keys).toEqual(["alpha", "beta", "gamma"]);
    expect(calls[0]?.state).toEqual({ source: { path: "src/a.ts", startLine: 1, endLine: 1, text: "@@ -1 +1 @@\n+x" } });
    expect(log.filter((e) => e.event === "assessment")).toHaveLength(6);
    expect(log).toContainEqual({ event: "assessment", mode: "edit", trait: "gamma", path: "src/a.ts", lines: [1, 1], choice: "compliant", p: 0, reported: false });
  });

  it("stop mode diffs from the merge base and only reports severity: block", async () => {
    const seen: string[][] = [];
    const { deps } = setup({
      dirs: { [REPO_TRAITS]: ["warned.md", "blocked.md"] },
      files: { [`${REPO_TRAITS}/warned.md`]: traitDoc("warned", "severity: warn\n"), [`${REPO_TRAITS}/blocked.md`]: traitDoc("blocked") },
      git: (args) => {
        seen.push([...args]);
        if (args[0] === "merge-base") return { code: 0, stdout: "abc123\n" };
        if (args[0] === "diff") return { code: 0, stdout: diffFor("x.ts") };
        return undefined;
      },
      answer: (keys) => ({ status: 200, body: { answers: Object.fromEntries(keys.map((k) => [k, choice("violation", { violation: 0.95 })])) } }),
    });
    const out = await runTraitCheck(deps, STOP);
    expect(out.status === "checked" && out.findings.map((f) => f.trait.name)).toEqual(["blocked"]);
    expect(seen.find((a) => a[0] === "diff")).toContain("abc123");
    expect(seen.find((a) => a[0] === "ls-files")?.at(-1)).toBe("--");
  });

  it("stop mode falls back to HEAD when there is no merge base", async () => {
    const seen: string[][] = [];
    const { deps } = setup({
      dirs: { [REPO_TRAITS]: ["blocked.md"] },
      files: { [`${REPO_TRAITS}/blocked.md`]: traitDoc("blocked") },
      git: (args) => {
        seen.push([...args]);
        return args[0] === "merge-base" ? { code: 1, stdout: "" } : undefined;
      },
    });
    expect(await runTraitCheck(deps, STOP)).toEqual({ status: "skipped", reason: "nothing-in-scope" });
    expect(seen.find((a) => a[0] === "diff")).toContain("HEAD");
  });

  it("honours trait-ignore-file directives in the edited file", async () => {
    const { deps, fetch } = setup({
      dirs: { [REPO_TRAITS]: ["alpha.md"] },
      files: { [`${REPO_TRAITS}/alpha.md`]: traitDoc("alpha"), [`${ROOT}/src/a.ts`]: "// trait-ignore-file alpha: generated\nexport {}" },
      git: (args) => (args[0] === "diff" ? { code: 0, stdout: diffFor("src/a.ts") } : undefined),
    });
    expect(await runTraitCheck(deps, EDIT)).toEqual({ status: "skipped", reason: "nothing-in-scope" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("splits questions into batches of 16 and by instruction size", async () => {
    const names = Array.from({ length: 17 }, (_, i) => `t${i}`);
    const huge = `\n${"x".repeat(31_000)}`;
    const { deps, calls } = setup({
      dirs: { [REPO_TRAITS]: [...names, "big-a", "big-b"].map((n) => `${n}.md`) },
      files: {
        ...Object.fromEntries(names.map((n) => [`${REPO_TRAITS}/${n}.md`, traitDoc(n)])),
        [`${REPO_TRAITS}/big-a.md`]: traitDoc("big-a") + huge,
        [`${REPO_TRAITS}/big-b.md`]: traitDoc("big-b") + huge,
      },
      git: (args) => (args[0] === "diff" ? { code: 0, stdout: diffFor("src/a.ts") } : undefined),
    });
    await runTraitCheck(deps, EDIT);
    expect(calls.map((c) => c.keys.length).sort((a, b) => a - b)).toEqual([1, 1, 1, 16]);
  });

  it("ignores missing or unparseable answers and gives each call at least 1s", async () => {
    let t = 0;
    const { deps } = setup({
      dirs: { [REPO_TRAITS]: ["alpha.md", "beta.md"] },
      files: { [`${REPO_TRAITS}/alpha.md`]: traitDoc("alpha"), [`${REPO_TRAITS}/beta.md`]: traitDoc("beta") },
      git: (args) => (args[0] === "diff" ? { code: 0, stdout: diffFor("src/a.ts") } : undefined),
      answer: () => ({ status: 200, body: { answers: { alpha: { type: "noul", noul: 1 } } } }),
      now: () => (t += 5_000),
    });
    expect(await runTraitCheck(deps, EDIT)).toMatchObject({ status: "checked", findings: [] });
  });

  it("is unavailable when every Jev call fails, and checked when only some do", async () => {
    const dirs = { [REPO_TRAITS]: ["alpha.md"] };
    const files = { [`${REPO_TRAITS}/alpha.md`]: traitDoc("alpha") };
    const twoFiles = (args: readonly string[]) => (args[0] === "diff" ? { code: 0, stdout: diffFor("src/a.ts") + diffFor("src/b.ts") } : undefined);

    const down = setup({ dirs, files, git: twoFiles, answer: () => ({ status: 503 }) });
    expect(await runTraitCheck(down.deps, { ...EDIT, files: ["../src/a.ts", "../src/b.ts"] })).toEqual({ status: "unavailable", reason: "http-503" });
    expect(down.log).toContainEqual({ event: "jev-unavailable", mode: "edit", reason: "http-503" });

    const partial = setup({ dirs, files, git: twoFiles, answer: (_k, call) => (call === 0 ? "throw" : { status: 200, body: { answers: { alpha: choice("violation", { violation: 0.99 }) } } }) });
    const out = await runTraitCheck(partial.deps, { ...EDIT, files: ["../src/a.ts", "../src/b.ts"] });
    expect(out.status === "checked" && out.findings).toHaveLength(1);
  });

  it("scan mode judges whole tracked files as added lines, keeps both severities and logs no assessments", async () => {
    const { deps, calls, log } = setup({
      dirs: { [REPO_TRAITS]: ["alpha.md", "beta.md", "gamma.md"] },
      files: {
        [`${REPO_TRAITS}/alpha.md`]: traitDoc("alpha", 'paths: ["src/**"]\n'),
        [`${REPO_TRAITS}/beta.md`]: traitDoc("beta", "severity: warn\n"),
        [`${REPO_TRAITS}/gamma.md`]: traitDoc("gamma"),
        [`${ROOT}/src/a.ts`]: "one\ntwo\n",
        [`${ROOT}/src/bin.png`]: "x\0y",
      },
      git: (args) => (args[0] === "ls-files" ? { code: 0, stdout: ["src/a.ts", "src/gone.ts", "src/bin.png", ""].join("\0") } : undefined),
      answer: () => ({ status: 200, body: { answers: { alpha: choice("violation", { violation: 0.9 }), beta: choice("violation", { violation: 0.85 }) } } }),
    });
    const out = await runTraitCheck(deps, { mode: "scan", files: [], base: "origin/main", paths: ["src"], traits: ["alpha", "beta"], budgetMs: 1000, minP: 0.8, concurrency: 2 });
    expect(out.status === "checked" && out.findings.map((f) => [f.trait.name, f.source.path, f.source.startLine, f.source.endLine])).toEqual([
      ["alpha", "src/a.ts", 1, 2],
      ["beta", "src/a.ts", 1, 2],
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.keys).toEqual(["alpha", "beta"]);
    expect(calls[0]?.state).toMatchObject({ source: { path: "src/a.ts", text: "@@ -0,0 +1,2 @@\n+one\n+two" } });
    expect(log.filter((e) => e.event === "assessment")).toEqual([]);
  });

  it("scan mode skips files no selected trait covers without reading them", async () => {
    const readFile = vi.fn();
    const { deps } = setup({
      dirs: { [REPO_TRAITS]: ["alpha.md"] },
      files: { [`${REPO_TRAITS}/alpha.md`]: traitDoc("alpha", 'paths: ["src/**"]\n') },
      git: (args) => (args[0] === "ls-files" ? { code: 0, stdout: "docs/a.md\0" } : undefined),
    });
    const wrapped = { ...deps, readFile: (f: string) => (f.startsWith(REPO_TRAITS) ? deps.readFile(f) : readFile(f)) };
    expect(await runTraitCheck(wrapped, { mode: "scan", files: [], base: "origin/main", budgetMs: 1000, minP: 0.8 })).toEqual({ status: "skipped", reason: "nothing-in-scope" });
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("question", () => {
  const trait: Trait = { name: "n", subject: "s", requirement: "r", purpose: "p", severity: "block", file: "/f.md" };

  it("asks a four-way choice about the + lines, embedding only the rule fields", () => {
    const q = question({ ...trait, applicability: "a", guidance: "g", context: "c", paths: ["**"] });
    expect(q.type === "choice" && Object.keys(q.criteria)).toEqual(["compliant", "violation", "not-applicable", "inconclusive"]);
    expect(q.instructions).toContain('{"name":"n","subject":"s","requirement":"r","purpose":"p","applicability":"a","guidance":"g","context":"c"}');
    expect(q.instructions).toContain("Judge only the + lines.");
  });

  it("omits absent optional fields", () => {
    expect(question(trait).instructions).toContain('{"name":"n","subject":"s","requirement":"r","purpose":"p"}');
  });
});

describe("formatScanFindings", () => {
  it("prints one JSON line per finding with p rounded to 3 places", () => {
    const trait: Trait = { name: "alpha", subject: "s", requirement: "r", purpose: "p", severity: "warn", file: "/f.md" };
    expect(formatScanFindings([{ trait, source: { path: "a.ts", startLine: 1, endLine: 9, text: "" }, p: 0.87654 }])).toBe(
      '{"trait":"alpha","severity":"warn","path":"a.ts","lines":[1,9],"p":0.877}',
    );
  });
});

describe("formatFindings", () => {
  const finding = (name: string, file: string, guidance?: string): Finding => ({
    trait: { name, subject: "s", requirement: ` Rule ${name}. `, purpose: "p", severity: "block", file, ...(guidance === undefined ? {} : { guidance }) },
    source: { path: "src/a.ts", startLine: 3, endLine: 9, text: "" },
    p: 0.876,
  });

  it("formats one edit finding with its rule, fix and repo-relative trait file", () => {
    expect(formatFindings("edit", [finding("alpha", "/repo/.agents/traits/alpha.md", "Do this. ")], "/repo")).toBe(
      [
        "trait-check: your last edit likely breaks 1 project trait. Fix each one that applies, or say in one line why it doesn't, then continue.",
        "",
        "1. alpha — src/a.ts lines 3-9 (p=0.88)",
        "   Rule: Rule alpha.",
        "   Fix: Do this.",
        "   Details: .agents/traits/alpha.md",
      ].join("\n"),
    );
  });

  it("lists at most ten stop findings, keeps overlay paths absolute and counts the rest", () => {
    const many = Array.from({ length: 12 }, (_, i) => finding(`t${i}`, "/state/traits/web-app/t.md"));
    const text = formatFindings("stop", many, "/repo");
    expect(text.startsWith("trait-check: before you finish, this branch's changes likely break 12 project traits marked severity: block.")).toBe(true);
    expect(text).toContain("10. t9 —");
    expect(text).not.toContain("11. t10");
    expect(text).toContain("   Details: /state/traits/web-app/t.md");
    expect(text).not.toContain("Fix:");
    expect(text.endsWith("…and 2 more.")).toBe(true);
  });
});
