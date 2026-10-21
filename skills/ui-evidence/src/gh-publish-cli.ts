// CLI: ui-evidence gh-publish <run-dir> --repo owner/name --pr N [--db-provenance seeded|unknown] [--reviewed file,file]
// Pushes a run's images to the PR's evidence branch with gh and writes the PR
// comment that embeds them to <run-dir>/pr-comment.md; the agent posts it with
// `gh pr comment`. Reads <run-dir>/parity.json (design parity) or
// <run-dir>/summary.json (script run). Seeded data only; every image must be
// listed in --reviewed first.
// Exit 0 pushed, 1 bad usage/input or not seeded, 3 review pending (nothing pushed), 4 gh failed.
import path from "node:path";

import { isLocalHost, type Provenance } from "./host-guard.js";
import { pushImages, type GhRunner } from "./github-publish.js";
import { parseFlags } from "./parity-cli.js";
import { canEmbedImagesInPr, renderParityPrComment, type ParitySummary } from "./parity-publish.js";
import { renderPrComment, type RunSummary } from "./publish.js";

export interface GhPublishDeps {
  gh: GhRunner;
  exists: (file: string) => boolean;
  readFile: (file: string) => Buffer;
  writeFile: (file: string, text: string) => void;
  out: (line: string) => void;
  err: (line: string) => void;
}

const VALUE_FLAGS = new Set(["--repo", "--pr", "--db-provenance", "--reviewed"]);
const USAGE = "usage: ui-evidence gh-publish <run-dir> --repo owner/name --pr N [--db-provenance seeded|unknown] [--reviewed file,file]";

interface Loaded {
  runId: string;
  provenance: Provenance;
  images: string[];
  comment: (urls: Record<string, string>) => string;
}

function load(runDir: string, db: string | undefined, deps: GhPublishDeps): Loaded {
  const parityFile = path.join(runDir, "parity.json");
  if (deps.exists(parityFile)) {
    const s = JSON.parse(deps.readFile(parityFile).toString("utf8")) as ParitySummary;
    const images = Object.values(s.frames).map((e) => path.join(runDir, e.files.sideBySide));
    return { runId: s.runId, provenance: s.provenance, images, comment: (urls) => renderParityPrComment(s, urls, runDir) };
  }
  const s = JSON.parse(deps.readFile(path.join(runDir, "summary.json")).toString("utf8")) as RunSummary;
  // The summary doesn't record provenance: the caller passes checkDbProvenance's answer, and a non-local host is never seeded.
  const provenance: Provenance = isLocalHost(s.host) && db === "seeded" ? "seeded" : "unknown";
  const diff = s.evidence?.diff ?? null;
  const images = [...s.steps.map((x) => x.screenshot).filter((f) => deps.exists(f)), ...(diff === null ? [] : [diff])];
  return { runId: s.runId ?? path.basename(runDir), provenance, images, comment: (urls) => renderPrComment(s, null, urls) };
}

export async function ghPublishMain(argv: string[], deps: GhPublishDeps): Promise<number> {
  const [, runDir, ...rest] = argv;
  const flags = parseFlags(rest, VALUE_FLAGS, new Set());
  const repo = flags?.["--repo"];
  const pr = Number(flags?.["--pr"]);
  const db = flags?.["--db-provenance"];
  if (runDir === undefined || typeof repo !== "string" || !Number.isInteger(pr) || pr < 1 || (db !== undefined && db !== "seeded" && db !== "unknown")) return fail(deps, USAGE);

  let run: Loaded;
  try {
    run = load(runDir, typeof db === "string" ? db : undefined, deps);
  } catch (e) {
    return fail(deps, `cannot read the run in ${runDir}: ${(e as Error).message}`);
  }
  if (!canEmbedImagesInPr(run.provenance, true)) return fail(deps, `provenance ${run.provenance}: images stay off GitHub (seeded data only)`);
  if (run.images.length === 0) return fail(deps, `no images in ${runDir}`);

  const reviewed = typeof flags?.["--reviewed"] === "string" ? flags["--reviewed"].split(",") : [];
  const unreviewed = run.images.filter((f) => !reviewed.includes(f));
  if (unreviewed.length > 0) {
    deps.out(JSON.stringify({ provenance: run.provenance, askFirst: true, reviewBlocked: true, unreviewed }));
    return 3;
  }

  try {
    const pushed = await pushImages(deps.gh, { repo, pr, runId: run.runId, files: run.images, readFile: deps.readFile });
    const commentFile = path.join(runDir, "pr-comment.md");
    deps.writeFile(commentFile, run.comment(pushed.urls));
    deps.out(JSON.stringify({ provenance: run.provenance, ...pushed, commentFile, post: ["gh", "pr", "comment", String(pr), "--repo", repo, "--body-file", commentFile] }));
    return 0;
  } catch (e) {
    deps.err(`gh-publish failed: ${(e as Error).message}`);
    return 4;
  }
}

function fail(deps: GhPublishDeps, message: string): number {
  deps.err(message);
  return 1;
}
