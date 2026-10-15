// Deployment settings files, read once at process start (bin.ts) so every
// module keeps reading plain `process.env`. Precedence, highest first:
//   1. the process environment;
//   2. the local, uncommitted env file: UI_EVIDENCE_CONFIG, else
//      `.ui-evidence.local.env` next to SKILL.md;
//   3. `deployment.env` next to SKILL.md: a deployment's committed defaults
//      (absent upstream; a fork commits its own).
// doctor.sh sources the same files in the same order.
import fs from "node:fs";
import path from "node:path";

/** NAME=value lines; blank lines and `#` comments are skipped, an optional `export ` and one layer of matching quotes are stripped. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m === null) continue;
    const value = (m[2] as string).trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
    out[m[1] as string] = quoted ? value.slice(1, -1) : value;
  }
  return out;
}

/** The files in precedence order (highest first); a missing file is skipped. */
export function settingsFiles(skillDir: string, env: NodeJS.ProcessEnv): string[] {
  const local = env.UI_EVIDENCE_CONFIG !== undefined && env.UI_EVIDENCE_CONFIG.trim() !== "" ? env.UI_EVIDENCE_CONFIG : path.join(skillDir, ".ui-evidence.local.env");
  return [local, path.join(skillDir, "deployment.env")];
}

/** Fills unset (or blank) variables in `env` from the settings files; never overrides a set one. */
export function applySettingsFiles(skillDir: string, env: NodeJS.ProcessEnv = process.env, read: (file: string) => string | null = readIfPresent): void {
  for (const file of settingsFiles(skillDir, env)) {
    const text = read(file);
    if (text === null) continue;
    for (const [name, value] of Object.entries(parseEnvFile(text))) {
      if (env[name] === undefined || env[name].trim() === "") env[name] = value;
    }
  }
}

function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
