// Process entry point — excluded from unit coverage; all logic is in cli.ts and parity-cli.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { main, realDeps } from "./cli.js";
import { parityMain } from "./parity-cli.js";
import { runParity } from "./parity-run.js";
import { runScript } from "./run-script.js";
import { applySettingsFiles } from "./settings-files.js";

// dist/bin.js -> the skill directory, where SKILL.md and the settings files live.
applySettingsFiles(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

const argv = process.argv.slice(2);
process.exitCode =
  argv[0] === "parity" || argv[0] === "parity-plan"
    ? await parityMain(argv, {
        run: runParity,
        readFile: (f) => fs.readFileSync(f, "utf8"),
        sizeOf: (f) => fs.statSync(f).size,
        out: (l) => console.log(l),
        err: (l) => console.error(l),
      })
    : await main(argv, realDeps(runScript));
