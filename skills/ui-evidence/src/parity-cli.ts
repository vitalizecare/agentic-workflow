// CLI: ui-evidence parity <manifest.json> <run-dir> [--host https://<preview-host> --allow-preview-host]
//                         [--allow-writes] [--app-build sha] [--db-provenance seeded|unknown]
//      ui-evidence parity-plan <run-dir> [--reviewed file,file]
// parity exit: 0 all geometry checks passed, 1 bad usage/manifest/guard, 2 a geometry check failed, 4 the run itself errored.
import { guardWrites, resolveHost } from "./host-guard.js";
import { failedBoxChecks } from "./parity.js";
import { parseDesignManifest, type DesignManifest } from "./parity-schema.js";
import { buildAttachmentPlan, canUploadToLinear, unreviewed, type ParitySummary } from "./parity-publish.js";
import type { ParityRunOptions } from "./parity-run.js";

export interface ParityDeps {
  run: (m: DesignManifest, runDir: string, opts: ParityRunOptions) => Promise<ParitySummary>;
  readFile: (file: string) => string;
  sizeOf: (file: string) => number;
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = "usage: ui-evidence parity <manifest.json> <run-dir> [--host url --allow-preview-host] [--allow-writes] [--app-build sha] [--db-provenance seeded|unknown]\n       ui-evidence parity-plan <run-dir> [--reviewed file,file]";
const VALUE_FLAGS = new Set(["--host", "--app-build", "--db-provenance", "--reviewed"]);
const BOOL_FLAGS = new Set(["--allow-preview-host", "--allow-writes"]);

export function parseFlags(rest: string[]): Record<string, string | true> | null {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i] as string;
    if (BOOL_FLAGS.has(f)) flags[f] = true;
    else if (VALUE_FLAGS.has(f) && rest[i + 1] !== undefined) flags[f] = rest[++i] as string;
    else return null;
  }
  return flags;
}

export async function parityMain(argv: string[], deps: ParityDeps): Promise<number> {
  const [command, first, second, ...rest] = argv;
  if (command === "parity-plan") return planMain(first, [second, ...rest].filter((a): a is string => a !== undefined), deps);
  if (command !== "parity" || first === undefined || second === undefined) return fail(deps, USAGE);
  const flags = parseFlags(rest);
  if (flags === null) return fail(deps, USAGE);

  let manifest: DesignManifest;
  try {
    const parsed = parseDesignManifest(JSON.parse(deps.readFile(first)));
    if ("error" in parsed) return fail(deps, `invalid manifest: ${parsed.error}`);
    manifest = parsed;
  } catch (e) {
    return fail(deps, `cannot read manifest ${first}: ${(e as Error).message}`);
  }

  const host = resolveHost({ ...(typeof flags["--host"] === "string" ? { host: flags["--host"] } : {}), allowPreviewHost: flags["--allow-preview-host"] === true });
  if (!host.ok) return fail(deps, host.error);
  // Parity is read-only on every host, localhost included.
  const guard = guardWrites(manifest.frames.flatMap((f) => f.steps ?? []), flags["--allow-writes"] === true);
  if (!guard.ok) return fail(deps, guard.error);
  const db = flags["--db-provenance"];
  if (db !== undefined && db !== "seeded" && db !== "unknown") return fail(deps, USAGE);

  let summary: ParitySummary;
  try {
    summary = await deps.run(manifest, second, {
      host: host.host,
      hostKind: host.kind,
      ...(typeof flags["--app-build"] === "string" ? { appBuild: flags["--app-build"] } : {}),
      ...(db !== undefined ? { dbProvenance: db } : {}),
    });
  } catch (e) {
    deps.err(`parity run failed: ${(e as Error).message}`);
    return 4;
  }
  deps.out(JSON.stringify(summary));
  const failures = failedBoxChecks(summary.frames);
  for (const f of failures) deps.err(`geometry: ${f.frame} ${f.check.target}: ${f.check.failure}`);
  return failures.length === 0 ? 0 : 2;
}

/** Prints the Linear attachment plan; the agent must open every image, then re-run with --reviewed to see the plan unblocked. */
function planMain(runDir: string | undefined, rest: string[], deps: ParityDeps): number {
  const flags = parseFlags(rest);
  if (runDir === undefined || flags === null) return fail(deps, USAGE);
  let summary: ParitySummary;
  try {
    summary = JSON.parse(deps.readFile(`${runDir}/parity.json`)) as ParitySummary;
  } catch (e) {
    return fail(deps, `cannot read ${runDir}/parity.json: ${(e as Error).message}`);
  }
  if (!canUploadToLinear(summary.provenance)) return fail(deps, `provenance ${summary.provenance}: evidence stays local, no Linear upload`);
  const plan = buildAttachmentPlan(summary, runDir, deps.sizeOf);
  const reviewed = typeof flags["--reviewed"] === "string" ? flags["--reviewed"].split(",") : [];
  const pending = unreviewed(plan, reviewed);
  deps.out(JSON.stringify({ provenance: summary.provenance, askFirst: true, reviewBlocked: pending.length > 0, unreviewed: pending, plan }));
  return pending.length === 0 ? 0 : 3;
}

function fail(deps: ParityDeps, message: string): number {
  deps.err(message);
  return 1;
}
