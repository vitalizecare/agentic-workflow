// A trait is one reusable code rule in a YAML file, `<name>.yaml`, with the
// fields below. `version` is the file format version: a format change bumps it
// here and in the repo's own trait schema together. The fields follow
// crosshatch/traits (Apache-2.0), with the Markdown body moved into `context`
// (examples, BAD -> GOOD diffs), plus two fields of our own: `paths` scopes a
// trait to files without a model call, and `severity` decides whether the Stop
// gate holds the agent back over it.
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { hasUnclosedBrace } from "./glob.js";

const text = z.string().regex(/\S/);

export const TraitFile = z
  .object({
    version: z.literal(1),
    name: z.string().regex(/^(?!trait-)[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
    subject: text,
    requirement: text,
    applicability: text.optional(),
    purpose: text,
    guidance: text.optional(),
    context: text.optional(),
    paths: z.array(z.string().min(1).refine((g) => !hasUnclosedBrace(g), "unclosed { in glob")).min(1).optional(),
    severity: z.enum(["block", "warn"]),
  })
  .strict();

export type Trait = Omit<z.infer<typeof TraitFile>, "version"> & { file: string };

export type TraitParse = { ok: true; trait: Trait } | { ok: false; file: string; error: string };

export const TRAIT_EXTENSION = ".yaml";

export function parseTrait(source: string, file: string): TraitParse {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    return { ok: false, file, error: `invalid YAML: ${(e as Error).message.split("\n")[0]}` };
  }
  const parsed = TraitFile.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0] as z.ZodIssue;
    return { ok: false, file, error: `${issue.path.join(".") || "trait"}: ${issue.message}` };
  }
  const { version: _version, ...trait } = parsed.data;
  const stem = path.basename(file, TRAIT_EXTENSION);
  if (stem !== trait.name) return { ok: false, file, error: `name "${trait.name}" must match the file name "${stem}${TRAIT_EXTENSION}"` };
  return { ok: true, trait: { ...trait, file } };
}
