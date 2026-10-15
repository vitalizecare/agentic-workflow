import { describe, expect, it } from "vitest";

import { buildParityEntry } from "../src/parity.js";
import {
  ATTACHMENT_PREFIX, attachmentSubtitle, attachmentTitle, buildAttachmentPlan, buildPutCommand, canEmbedImagesInPr, canUploadToLinear, renderLinearComment, renderParityPrComment, selectStale, unreviewed, type ParitySummary,
} from "../src/parity-publish.js";

const entry = (over: { known?: string[]; pass?: boolean; name?: string } = {}) =>
  buildParityEntry({
    designRegion: { x: 0, y: 0, w: 10, h: 10 },
    anchorBox: { x: 0, y: 0, w: 10, h: 10 },
    anchorOffset: { x: 0, y: 0 },
    comparison: { diffPixels: 9, total: 100, diffPercent: 9 },
    threshold: 0.1,
    includeAA: false,
    boxChecks: over.pass === undefined ? [] : [{ target: "testId:c", relativeTo: null, expected: { w: 10 }, actual: null, tolerance: 0, pass: over.pass, ...(over.pass ? {} : { failure: "w 9 != 10" }) }],
    knownDifferences: over.known ?? [],
    files: { design: "d.png", implementation: "i.png", diff: "x.png", sideBySide: `${over.name ?? "A"}-side-by-side.png` },
  });

const summary = (over: Partial<ParitySummary> = {}): ParitySummary => ({
  runId: "r1", host: "https://pr-1.preview.example.com", provenance: "scrubbed", appBuild: "abc1234", designNode: "12:34", viewport: { w: 1512, h: 982 }, frames: { A: entry({ known: ["copy", "data"] }) }, ...over,
});

describe("provenance policy", () => {
  it("allows Linear for seeded and scrubbed, never unknown", () => {
    expect([canUploadToLinear("seeded"), canUploadToLinear("scrubbed"), canUploadToLinear("unknown")]).toEqual([true, true, false]);
  });
  it("embeds images in GitHub only for seeded data with an approved uploader", () => {
    expect(canEmbedImagesInPr("seeded", true)).toBe(true);
    expect(canEmbedImagesInPr("seeded", false)).toBe(false);
    expect(canEmbedImagesInPr("scrubbed", true)).toBe(false);
    expect(canEmbedImagesInPr("unknown", true)).toBe(false);
  });
});

describe("attachment plan", () => {
  it("titles and subtitles carry node, build, viewport, diff and known differences", () => {
    expect(attachmentTitle("A-empty")).toBe("Pixel diff: A-empty (Figma | implementation | diff)");
    expect(attachmentSubtitle(summary(), "A")).toBe("design node 12:34 · build abc1234 · viewport 1512x982 · diff 9% (9/100 px) · known differences: copy; data");
  });
  it("never claims a build or node it was not given, and says when nothing differs on purpose", () => {
    const s = summary({ appBuild: null, designNode: null, frames: { A: entry() } });
    expect(attachmentSubtitle(s, "A")).toBe("design node unspecified · build unverified · viewport 1512x982 · diff 9% (9/100 px) · no known differences");
  });
  it("caps an over-long subtitle", () => {
    const s = summary({ frames: { A: entry({ known: ["x".repeat(600)] }) } });
    const sub = attachmentSubtitle(s, "A");
    expect(sub).toHaveLength(500);
    expect(sub.endsWith("…")).toBe(true);
  });
  it("plans one side-by-side upload per frame with size and a review expectation", () => {
    const [p] = buildAttachmentPlan(summary({ frames: { A: { ...entry(), designNode: "99:1" } } }), "/runs/r1", () => 1234);
    expect(p).toMatchObject({ frame: "A", file: "/runs/r1/A-side-by-side.png", filename: "A-side-by-side.png", contentType: "image/png", size: 1234, title: "Pixel diff: A (Figma | implementation | diff)" });
    expect(p?.subtitle).toContain("design node 99:1");
    expect(p?.expectation).toContain("no focus ring");
  });
  it("blocks until every image has been opened", () => {
    const plan = buildAttachmentPlan(summary({ frames: { A: entry(), B: entry({ name: "B" }) } }), "/r", () => 1);
    expect(unreviewed(plan, ["/r/A-side-by-side.png"])).toEqual(["/r/B-side-by-side.png"]);
    expect(unreviewed(plan, ["/r/A-side-by-side.png", "/r/B-side-by-side.png"])).toEqual([]);
  });
});

describe("PUT command", () => {
  it("passes every signed header verbatim as argv, no shell string", () => {
    expect(buildPutCommand({ url: "https://u/x", headers: { "content-type": "image/png", "Content-Disposition": 'attachment; filename="a.png"' } }, "/f.png")).toEqual([
      "curl", "-sS", "--fail", "-X", "PUT", "--data-binary", "@/f.png", "-H", "content-type: image/png", "-H", 'Content-Disposition: attachment; filename="a.png"', "https://u/x",
    ]);
  });
});

describe("selectStale", () => {
  it("offers only this skill's earlier attachments, excluding the new ones", () => {
    const existing = [
      { id: "1", title: `${ATTACHMENT_PREFIX}A (Figma | implementation | diff)` },
      { id: "2", title: `${ATTACHMENT_PREFIX}B (Figma | implementation | diff)` },
      { id: "3", title: "Design spec.pdf" },
    ];
    expect(selectStale(existing, ["2"])).toEqual([existing[0]]);
  });
});

describe("text renderers", () => {
  it("Linear comment summarises regions, geometry and known differences", () => {
    const s = summary({ frames: { A: entry({ known: ["copy"], pass: true }), B: entry({ pass: false }), C: entry() } });
    const c = renderLinearComment(s);
    expect(c).toContain("build abc1234, viewport 1512x982, design node 12:34");
    expect(c).toContain("| A | 9% (9/100) | pass | copy |");
    expect(c).toContain("| B | 9% (9/100) | FAIL | — |");
    expect(c).toContain("| C | 9% (9/100) | — | — |");
    expect(renderLinearComment(summary({ appBuild: null, designNode: null }))).toContain("build unverified, viewport 1512x982, design node unspecified");
  });
  it("PR comment is text-only: percentages and explanations, no image links", () => {
    const body = renderParityPrComment(summary({ frames: { A: entry({ known: ["copy"] }), B: entry({ pass: false }) } }));
    expect(body).toContain("scrubbed data, images on Linear");
    expect(body).toContain("| A | 9% | copy |");
    expect(body).toContain("| B | 9% | — |");
    expect(body).toContain("Geometry failures: B: testId:c (w 9 != 10)");
    expect(body).not.toMatch(/https?:\/\/|\.png/);
    expect(renderParityPrComment(summary())).not.toContain("Geometry failures");
  });
});
