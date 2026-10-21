// Images for a GitHub PR comment, through the gh CLI. GitHub has no API for
// attaching an image to a comment, so the PNGs are committed to a per-PR
// evidence branch (ui-evidence/pr-<n>, never merged) with the git data API —
// no checkout, no working tree touched — and the comment embeds them by
// commit-pinned URL, which renders for anyone who can read the repo. Only
// seeded data is pushed (parity-publish.ts canEmbedImagesInPr); the caller
// asks first.
import path from "node:path";

export interface GhRunner {
  /** Runs `gh <args>` with `stdin` on standard input. */
  run(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface PushRequest {
  /** owner/name; always passed as the path, never resolved from the cwd or GH_REPO. */
  repo: string;
  pr: number;
  runId: string;
  files: string[];
  readFile: (file: string) => Buffer;
}

export interface PushResult {
  branch: string;
  commit: string;
  /** local path -> commit-pinned image URL. */
  urls: Record<string, string>;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_SEGMENT = /[^A-Za-z0-9._-]/g;
const firstLine = (text: string): string => text.split("\n")[0] as string;

export function evidenceBranch(pr: number): string {
  return `ui-evidence/pr-${pr}`;
}

export function imageUrl(repo: string, commit: string, filePath: string): string {
  return `https://github.com/${repo}/blob/${commit}/${filePath.split("/").map(encodeURIComponent).join("/")}?raw=true`;
}

async function ghJson(gh: GhRunner, args: string[], body?: unknown): Promise<Record<string, unknown>> {
  const r = await gh.run(body === undefined ? args : [...args, "--input", "-"], body === undefined ? undefined : JSON.stringify(body));
  if (r.code !== 0) throw new Error(`gh ${args.slice(0, 4).join(" ")} failed: ${firstLine(r.stderr)}`);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

/** The branch head, or null when the branch doesn't exist yet (gh reports HTTP 404). */
async function branchHead(gh: GhRunner, repo: string, branch: string): Promise<string | null> {
  const r = await gh.run(["api", `repos/${repo}/git/ref/heads/${branch}`]);
  if (r.code !== 0) {
    if (/HTTP 404|Not Found/.test(r.stderr)) return null;
    throw new Error(`gh api git/ref failed: ${firstLine(r.stderr)}`);
  }
  return String((JSON.parse(r.stdout) as { object: { sha: string } }).object.sha);
}

/** One commit on the PR's evidence branch holding every file under pr-<n>/<run-id>/; earlier runs stay. */
export async function pushImages(gh: GhRunner, req: PushRequest): Promise<PushResult> {
  if (!REPO.test(req.repo)) throw new Error(`--repo must be owner/name: ${req.repo}`);
  if (!Number.isInteger(req.pr) || req.pr < 1) throw new Error(`--pr must be a PR number: ${req.pr}`);
  if (req.files.length === 0) throw new Error("no images to push");
  const dir = `pr-${req.pr}/${req.runId.replace(SAFE_SEGMENT, "_")}`;
  const names = req.files.map((f) => `${dir}/${path.basename(f).replace(SAFE_SEGMENT, "_")}`);
  if (new Set(names).size !== names.length) throw new Error("two images share a file name");

  const branch = evidenceBranch(req.pr);
  const api = `repos/${req.repo}/git`;
  const parent = await branchHead(gh, req.repo, branch);
  const baseTree = parent === null ? undefined : String(((await ghJson(gh, ["api", `${api}/commits/${parent}`])).tree as { sha: string }).sha);
  const tree = [];
  for (const [i, file] of req.files.entries()) {
    const blob = await ghJson(gh, ["api", "--method", "POST", `${api}/blobs`], { content: req.readFile(file).toString("base64"), encoding: "base64" });
    tree.push({ path: names[i] as string, mode: "100644", type: "blob", sha: String(blob.sha) });
  }
  const newTree = await ghJson(gh, ["api", "--method", "POST", `${api}/trees`], { ...(baseTree !== undefined ? { base_tree: baseTree } : {}), tree });
  const commit = String(
    (await ghJson(gh, ["api", "--method", "POST", `${api}/commits`], { message: `ui-evidence: PR #${req.pr} run ${req.runId}`, tree: newTree.sha, parents: parent === null ? [] : [parent] })).sha,
  );
  if (parent === null) await ghJson(gh, ["api", "--method", "POST", `${api}/refs`], { ref: `refs/heads/${branch}`, sha: commit });
  else await ghJson(gh, ["api", "--method", "PATCH", `${api}/refs/heads/${branch}`], { sha: commit, force: false });

  const urls: Record<string, string> = {};
  req.files.forEach((f, i) => (urls[f] = imageUrl(req.repo, commit, names[i] as string)));
  return { branch, commit, urls };
}
