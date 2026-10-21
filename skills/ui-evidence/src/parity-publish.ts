// Publishing policy and plan for design-parity evidence. Pure: the agent runs
// the Linear MCP calls (prepare -> PUT -> create) from this plan; every write
// still asks first. Images go to Linear; GitHub gets them too for seeded data,
// pushed by github-publish.ts.
import path from "node:path";

import type { Provenance } from "./host-guard.js";
import { failedBoxChecks, type ParityEntry } from "./parity.js";

export const ATTACHMENT_PREFIX = "Pixel diff: ";
const SUBTITLE_MAX = 500;

/** Linear accepts seeded and scrubbed data (after an explicit ask); unknown never leaves the machine. */
export function canUploadToLinear(p: Provenance): boolean {
  return p === "seeded" || p === "scrubbed";
}

/** GitHub comments carry image URLs only for seeded data AND an approved uploader. */
export function canEmbedImagesInPr(p: Provenance, hasApprovedUploader: boolean): boolean {
  return p === "seeded" && hasApprovedUploader;
}

export interface ParitySummary {
  runId: string;
  host: string;
  provenance: Provenance;
  /** Commit the run executed against, only if the caller verified it; null otherwise. */
  appBuild: string | null;
  designNode: string | null;
  viewport: { w: number; h: number };
  frames: Record<string, ParityEntry>;
}

export interface PlannedAttachment {
  frame: string;
  file: string;
  filename: string;
  contentType: "image/png";
  size: number;
  title: string;
  subtitle: string;
  /** What the agent must see in the image before it may be uploaded. */
  expectation: string;
}

export function attachmentTitle(frame: string): string {
  return `${ATTACHMENT_PREFIX}${frame} (Figma | implementation | diff)`;
}

export function attachmentSubtitle(s: ParitySummary, frame: string): string {
  const e = s.frames[frame] as ParityEntry;
  const known = e.knownDifferences.length > 0 ? `known differences: ${e.knownDifferences.join("; ")}` : "no known differences";
  const text = [
    `design node ${e.designNode ?? s.designNode ?? "unspecified"}`,
    `build ${s.appBuild ?? "unverified"}`,
    `viewport ${s.viewport.w}x${s.viewport.h}`,
    `diff ${e.diffPercent}% (${e.diffPixels}/${e.total} px)`,
    known,
  ].join(" · ");
  return text.length > SUBTITLE_MAX ? `${text.slice(0, SUBTITLE_MAX - 1)}…` : text;
}

/** One side-by-side attachment per frame; a frame's own `designNode` wins over the manifest's. */
export function buildAttachmentPlan(s: ParitySummary, runDir: string, sizeOf: (file: string) => number): PlannedAttachment[] {
  return Object.keys(s.frames).map((frame) => {
    const e = s.frames[frame] as ParityEntry;
    const file = path.join(runDir, e.files.sideBySide);
    return {
      frame,
      file,
      filename: path.basename(file),
      contentType: "image/png",
      size: sizeOf(file),
      title: attachmentTitle(frame),
      subtitle: attachmentSubtitle(s, frame),
      expectation: `${frame}: left = design, middle = implementation, right = diff; settled (no fade-in), no focus ring, ${e.diffPercent}% differing`,
    };
  });
}

/** Files the agent has not yet confirmed it opened and compared. */
export function unreviewed(plan: PlannedAttachment[], reviewedFiles: string[]): string[] {
  return plan.map((p) => p.file).filter((f) => !reviewedFiles.includes(f));
}

/** argv for the signed PUT: every header verbatim, bytes untouched. Run it within 60s of prepare_attachment_upload. */
export function buildPutCommand(upload: { url: string; headers: Record<string, string> }, file: string): string[] {
  return ["curl", "-sS", "--fail", "-X", "PUT", "--data-binary", `@${file}`, ...Object.entries(upload.headers).flatMap(([k, v]) => ["-H", `${k}: ${v}`]), upload.url];
}

export interface ExistingAttachment { id: string; title: string }

/** Earlier evidence from this skill, to be offered for deletion after the new attachments exist. Never deletes by itself. */
export function selectStale(existing: ExistingAttachment[], newIds: string[]): ExistingAttachment[] {
  return existing.filter((a) => a.title.startsWith(ATTACHMENT_PREFIX) && !newIds.includes(a.id));
}

export function renderLinearComment(s: ParitySummary): string {
  const rows = Object.entries(s.frames).map(([name, e]) => {
    const known = e.knownDifferences.length > 0 ? e.knownDifferences.join("; ") : "—";
    const geometry = e.boxChecks.length === 0 ? "—" : e.boxChecks.every((c) => c.pass) ? "pass" : "FAIL";
    return `| ${name} | ${e.diffPercent}% (${e.diffPixels}/${e.total}) | ${geometry} | ${known} |`;
  });
  return [
    `**Design parity** — build ${s.appBuild ?? "unverified"}, viewport ${s.viewport.w}x${s.viewport.h}, design node ${s.designNode ?? "unspecified"}`,
    "",
    "| State | Pixel diff | Geometry | Known differences |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/**
 * GitHub text: numbers and explanations. `urls` (side-by-side file -> image URL, from github-publish.ts)
 * adds each frame's image; without it the images stay on Linear.
 */
export function renderParityPrComment(s: ParitySummary, urls: Record<string, string> = {}, runDir = ""): string {
  const fails = failedBoxChecks(s.frames);
  const image = (name: string, e: ParityEntry): string => {
    const url = urls[path.join(runDir, e.files.sideBySide)];
    return url === undefined ? " — |" : ` ![${name}: Figma, implementation, diff](${url}) |`;
  };
  const withImages = Object.keys(urls).length > 0;
  const rows = Object.entries(s.frames).map(([name, e]) => `| ${name} | ${e.diffPercent}% | ${e.knownDifferences.join("; ") || "—"} |${withImages ? image(name, e) : ""}`);
  return [
    `## Design parity (${s.provenance} data, images ${withImages ? "below" : "on Linear"})`,
    "",
    withImages ? "| State | Pixel diff | Known differences | Figma, implementation, diff |" : "| State | Pixel diff | Known differences |",
    withImages ? "|---|---|---|---|" : "|---|---|---|",
    ...rows,
    ...(fails.length > 0 ? ["", `Geometry failures: ${fails.map((f) => `${f.frame}: ${f.check.target} (${f.check.failure})`).join("; ")}`] : []),
  ].join("\n");
}
