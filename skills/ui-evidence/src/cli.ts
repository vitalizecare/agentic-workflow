// CLI: node dist/bin.js <script.json> <run-dir> [--baseline png] [--app-build id]
//                       [--fixtures id] [--cache manifest.json]
//                       [--host http://localhost:30N0 | --host https://<preview-host> --allow-preview-host]
//                       [--allow-writes]
// Exit 0 = every step passed; 1 = bad usage/script; 2 = at least one step
// failed or broken (the summary is still written and printed).
import { createHash } from "node:crypto";
import fs from "node:fs";

import { guardWrites, resolveHost } from "./host-guard.js";
import type { RunOptions } from "./run-script.js";
import type { RunSummary } from "./publish.js";
import { parseUiScript, type UiScript } from "./script-schema.js";

export interface CliDeps {
  run: (script: UiScript, runDir: string, baseline: string | undefined, opts: RunOptions) => Promise<RunSummary>;
  readFile: (file: string) => string;
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = "usage: ui-evidence <script.json> <run-dir> [--baseline png] [--app-build id] [--fixtures id] [--cache manifest.json] [--host url --allow-preview-host] [--allow-writes]";
const FLAGS: Record<string, "baseline" | "appBuild" | "fixtures" | "cacheManifest" | "host"> = {
  "--baseline": "baseline",
  "--app-build": "appBuild",
  "--fixtures": "fixtures",
  "--cache": "cacheManifest",
  "--host": "host",
};
const SWITCHES: Record<string, "allowPreviewHost" | "allowWrites"> = {
  "--allow-preview-host": "allowPreviewHost",
  "--allow-writes": "allowWrites",
};

export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const [scriptFile, runDir, ...rest] = argv;
  if (scriptFile === undefined || runDir === undefined) return fail(deps, USAGE);

  const opts: Partial<Record<"baseline" | "appBuild" | "fixtures" | "cacheManifest" | "host", string>> = {};
  const on: Partial<Record<"allowPreviewHost" | "allowWrites", true>> = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i] as string;
    const switchKey = SWITCHES[flag];
    if (switchKey !== undefined) {
      on[switchKey] = true;
      continue;
    }
    const key = FLAGS[flag];
    const value = rest[++i];
    if (key === undefined || value === undefined) return fail(deps, USAGE);
    opts[key] = value;
  }

  let raw: unknown;
  let text: string;
  try {
    text = deps.readFile(scriptFile);
    raw = JSON.parse(text);
  } catch (e) {
    return fail(deps, `cannot read script ${scriptFile}: ${(e as Error).message}`);
  }
  const script = parseUiScript(raw);
  if ("error" in script) return fail(deps, `invalid script: ${script.error}`);

  // A preview host is the only time the runner leaves this machine, so it is
  // also the only time it runs read-only unless --allow-writes says so. A
  // worktree slot host is local seeded data, like localhost:3000.
  const { baseline, host: hostFlag, ...runOpts } = opts;
  const target = resolveHost({ ...(hostFlag !== undefined ? { host: hostFlag } : {}), ...(on.allowPreviewHost ? { allowPreviewHost: true } : {}) });
  if (!target.ok) return fail(deps, target.error);
  if (target.kind === "preview") {
    const guard = guardWrites(script.steps, on.allowWrites === true);
    if (!guard.ok) return fail(deps, guard.error);
  }
  // The script's hash lets bugfix-state prove a run executed the frozen check.
  const scriptSha256 = createHash("sha256").update(text).digest("hex");
  const summary = await deps.run(script, runDir, baseline, { ...runOpts, ...(hostFlag !== undefined ? { host: target.host } : {}), scriptSha256 });
  deps.out(JSON.stringify(summary));
  return summary.steps.every((s) => s.status === "passed") ? 0 : 2;
}

function fail(deps: CliDeps, message: string): number {
  deps.err(message);
  return 1;
}

export const realDeps = (run: CliDeps["run"]): CliDeps => ({
  run,
  readFile: (f) => fs.readFileSync(f, "utf8"),
  out: (l) => console.log(l),
  err: (l) => console.error(l),
});
