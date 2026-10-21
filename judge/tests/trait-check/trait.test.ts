import { describe, expect, it } from "vitest";

import { parseTrait } from "../../src/trait-check/trait.js";

const base =
  "version: 1\nname: static-imports-first\nsubject: Static imports.\nrequirement: >\n  Put static imports at the top.\npurpose: Find dependencies first.\nseverity: block";

describe("parseTrait", () => {
  it("reads every field and drops the version", () => {
    const out = parseTrait(`${base}\npaths: ["**/*.ts"]\ncontext: |-\n  \`\`\`diff\n  -a\n  +b\n  \`\`\``, "/r/.agents/traits/static-imports-first.yaml");
    expect(out).toEqual({
      ok: true,
      trait: {
        name: "static-imports-first",
        subject: "Static imports.",
        requirement: "Put static imports at the top.\n",
        purpose: "Find dependencies first.",
        paths: ["**/*.ts"],
        severity: "block",
        context: "```diff\n-a\n+b\n```",
        file: "/r/.agents/traits/static-imports-first.yaml",
      },
    });
  });

  it("accepts the optional fields and omits the absent ones", () => {
    const withOptional = `${base.replace("severity: block", "severity: warn")}\napplicability: Only TS.\nguidance: Move them.`;
    const out = parseTrait(withOptional, "static-imports-first.yaml");
    expect(out).toMatchObject({ ok: true, trait: { applicability: "Only TS.", guidance: "Move them.", severity: "warn" } });
    expect(out.ok && "context" in out.trait).toBe(false);
  });

  it("rejects invalid YAML with its first diagnostic line", () => {
    const out = parseTrait("name: [unclosed", "x.yaml");
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error.startsWith("invalid YAML: ")).toBe(true);
  });

  it("requires a known version and an explicit severity", () => {
    expect(parseTrait(base.replace("version: 1\n", ""), "static-imports-first.yaml")).toMatchObject({ ok: false, error: expect.stringMatching(/^version: /) });
    expect(parseTrait(base.replace("version: 1", "version: 2"), "static-imports-first.yaml")).toMatchObject({ ok: false, error: expect.stringMatching(/^version: /) });
    expect(parseTrait(base.replace("\nseverity: block", ""), "static-imports-first.yaml")).toMatchObject({ ok: false, error: expect.stringMatching(/^severity: /) });
  });

  it("rejects unknown keys and bad values, naming the field", () => {
    expect(parseTrait(`${base}\nwhen: always`, "static-imports-first.yaml")).toMatchObject({ ok: false, error: expect.stringContaining("Unrecognized key") });
    expect(parseTrait(base.replace("static-imports-first", "trait-bad"), "trait-bad.yaml")).toMatchObject({ ok: false, error: expect.stringMatching(/^name: /) });
    expect(parseTrait("just a string", "x.yaml")).toMatchObject({ ok: false, error: expect.stringMatching(/^trait: /) });
    expect(parseTrait(`${base}\npaths: ["src/{a,b.ts"]`, "static-imports-first.yaml")).toEqual({
      ok: false,
      file: "static-imports-first.yaml",
      error: "paths.0: unclosed { in glob",
    });
  });

  it("requires the name to match the file name", () => {
    expect(parseTrait(base, "/r/other.yaml")).toEqual({ ok: false, file: "/r/other.yaml", error: 'name "static-imports-first" must match the file name "other.yaml"' });
  });
});
