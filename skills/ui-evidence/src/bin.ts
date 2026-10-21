// Process entry point — excluded from unit coverage; all logic is in cli.ts, parity-cli.ts and gh-publish-cli.ts.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { main, realDeps } from "./cli.js";
import { ghPublishMain } from "./gh-publish-cli.js";
import type { GhRunner } from "./github-publish.js";
import { parityMain } from "./parity-cli.js";
import { runParity } from "./parity-run.js";
import { runScript } from "./run-script.js";
import { applySettingsFiles } from "./settings-files.js";

// dist/bin.js -> the skill directory, where SKILL.md and the settings files live.
applySettingsFiles(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

const gh: GhRunner = {
  run: (args, stdin) =>
    new Promise((resolve) => {
      const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (e) => resolve({ code: 127, stdout, stderr: e.message }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.stdin.end(stdin ?? "");
    }),
};

const argv = process.argv.slice(2);
process.exitCode =
  argv[0] === "gh-publish"
    ? await ghPublishMain(argv, {
        gh,
        exists: (f) => fs.existsSync(f),
        readFile: (f) => fs.readFileSync(f),
        writeFile: (f, t) => fs.writeFileSync(f, t),
        out: (l) => console.log(l),
        err: (l) => console.error(l),
      })
    : argv[0] === "parity" || argv[0] === "parity-plan"
    ? await parityMain(argv, {
        run: runParity,
        readFile: (f) => fs.readFileSync(f, "utf8"),
        sizeOf: (f) => fs.statSync(f).size,
        out: (l) => console.log(l),
        err: (l) => console.error(l),
      })
    : await main(argv, realDeps(runScript));
