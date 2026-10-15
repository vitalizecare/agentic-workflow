import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applySettingsFiles, parseEnvFile, settingsFiles } from "../src/settings-files.js";

describe("parseEnvFile", () => {
  it("reads NAME=value lines, skipping blanks and comments, stripping export and one layer of matching quotes", () => {
    const text = ["# deployment defaults", "", "A=1", "export B=two words", 'C="quoted # not a comment"', "D='single'", "E=\"unbalanced", "  F = spaced", "not a line", "G="].join("\n");
    expect(parseEnvFile(text)).toEqual({ A: "1", B: "two words", C: "quoted # not a comment", D: "single", E: '"unbalanced', G: "" });
  });
});

describe("settingsFiles", () => {
  it("is the local file (UI_EVIDENCE_CONFIG, else .ui-evidence.local.env) then deployment.env", () => {
    expect(settingsFiles("/skill", {})).toEqual([path.join("/skill", ".ui-evidence.local.env"), path.join("/skill", "deployment.env")]);
    expect(settingsFiles("/skill", { UI_EVIDENCE_CONFIG: "/etc/mine.env" })).toEqual(["/etc/mine.env", path.join("/skill", "deployment.env")]);
    expect(settingsFiles("/skill", { UI_EVIDENCE_CONFIG: " " })[0]).toBe(path.join("/skill", ".ui-evidence.local.env"));
  });
});

describe("applySettingsFiles", () => {
  const files: Record<string, string> = {
    [path.join("/skill", ".ui-evidence.local.env")]: "UI_EVIDENCE_APP_TITLE=Local\n",
    [path.join("/skill", "deployment.env")]: "UI_EVIDENCE_APP_TITLE=Deployed\nUI_EVIDENCE_DB_CONTAINER=db\nUI_EVIDENCE_API_PORT=5002\n",
  };
  const read = (f: string): string | null => files[f] ?? null;

  it("fills unset and blank variables: the environment wins, then the local file, then deployment.env", () => {
    const env: NodeJS.ProcessEnv = { UI_EVIDENCE_API_PORT: "6000", UI_EVIDENCE_DB_CONTAINER: "  " };
    applySettingsFiles("/skill", env, read);
    expect(env).toEqual({ UI_EVIDENCE_APP_TITLE: "Local", UI_EVIDENCE_DB_CONTAINER: "db", UI_EVIDENCE_API_PORT: "6000" });
  });

  it("reads the real files from disk by default", () => {
    const skill = fs.mkdtempSync(path.join(os.tmpdir(), "ui-evidence-settings-"));
    try {
      fs.writeFileSync(path.join(skill, "deployment.env"), "UI_EVIDENCE_SEED_TABLE=public.users\n");
      const env: NodeJS.ProcessEnv = {};
      applySettingsFiles(skill, env);
      expect(env).toEqual({ UI_EVIDENCE_SEED_TABLE: "public.users" });
    } finally {
      fs.rmSync(skill, { recursive: true, force: true });
    }
  });

  it("skips missing files", () => {
    const env: NodeJS.ProcessEnv = {};
    applySettingsFiles("/elsewhere", env, read);
    expect(env).toEqual({});
  });
});
