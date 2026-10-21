import { formatFindings, formatScanFindings, runTraitCheck, type Mode, type TraitCheckDeps } from "./check.js";

const USAGE = [
  "usage: judge trait-check --edit --file <path> [--file <path>...] | --stop [--base <ref>]  [--budget-ms <n>] [--min-p <0..1>]",
  "       judge trait-check --scan [--path <pathspec>...] [--trait <name>...] [--budget-ms <n>] [--min-p <0..1>] [--concurrency <n>]",
].join("\n");

// Defaults per mode: the edit nudge only informs, so it reports earlier; the Stop
// gate holds the agent back, so it needs a surer call. Budgets sit under the hook
// timeouts in scripts/install-trait-check.sh. A scan is run by hand over the whole
// repo, so it gets an hour and more concurrent Jev calls.
const DEFAULTS = {
  edit: { budgetMs: 15_000, minP: 0.6, concurrency: 4 },
  stop: { budgetMs: 40_000, minP: 0.8, concurrency: 4 },
  scan: { budgetMs: 3_600_000, minP: 0.8, concurrency: 12 },
} as const;

const VALUE_FLAGS = new Set(["--file", "--base", "--budget-ms", "--min-p", "--path", "--trait", "--concurrency"]);

/**
 * Exit codes: 0 nothing to report (or nothing to check), 2 findings (on stderr
 * for --edit/--stop, as JSON lines on stdout for --scan), 3 Jev unavailable
 * (the hook logs it as a fail-open), 64 usage.
 */
export async function runTraitCheckCli(args: readonly string[], deps: TraitCheckDeps): Promise<{ exitCode: number; stdout: string; stderr?: string }> {
  const files: string[] = [];
  const paths: string[] = [];
  const traits: string[] = [];
  let mode: Mode | undefined;
  let base = "origin/main";
  let budgetMs: number | undefined;
  let minP: number | undefined;
  let concurrency: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const value = args[i + 1];
    if (arg === "--edit" || arg === "--stop" || arg === "--scan") {
      if (mode !== undefined) return { exitCode: 64, stdout: "", stderr: USAGE };
      mode = arg.slice(2) as Mode;
    } else if (value !== undefined && VALUE_FLAGS.has(arg)) {
      i++;
      if (arg === "--file") files.push(value);
      else if (arg === "--path") paths.push(value);
      else if (arg === "--trait") traits.push(value);
      else if (arg === "--base") base = value;
      else if (arg === "--budget-ms") budgetMs = Number(value);
      else if (arg === "--concurrency") concurrency = Number(value);
      else minP = Number(value);
    } else return { exitCode: 64, stdout: "", stderr: USAGE };
  }
  const scanFlags = paths.length > 0 || traits.length > 0 || concurrency !== undefined;
  if (mode === undefined || (mode === "edit") !== files.length > 0 || (mode !== "scan" && scanFlags)) {
    return { exitCode: 64, stdout: "", stderr: USAGE };
  }
  budgetMs ??= DEFAULTS[mode].budgetMs;
  minP ??= DEFAULTS[mode].minP;
  concurrency ??= DEFAULTS[mode].concurrency;
  if (!Number.isInteger(budgetMs) || budgetMs <= 0 || !(minP >= 0 && minP <= 1) || !Number.isInteger(concurrency) || concurrency <= 0) {
    return { exitCode: 64, stdout: "", stderr: USAGE };
  }

  const result = await runTraitCheck(deps, { mode, files, base, paths, traits, budgetMs, minP, concurrency });
  if (result.status === "skipped") return { exitCode: 0, stdout: "" };
  if (result.status === "unavailable") return { exitCode: 3, stdout: "", stderr: `trait-check: jev unavailable (${result.reason})` };
  if (result.findings.length === 0) return { exitCode: 0, stdout: "" };
  if (mode === "scan") return { exitCode: 2, stdout: formatScanFindings(result.findings), stderr: `trait-check: ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"} from ${result.requests} Jev requests` };
  return { exitCode: 2, stdout: "", stderr: formatFindings(mode, result.findings, result.root) };
}
