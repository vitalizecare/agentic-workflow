// Guard rails for running against a host other than localhost:3000. Pure
// functions: the CLI and the browser drivers call them before anything
// touches the network.
//
// Two overrides exist. A git worktree's own local stack (web-app's
// `scripts/worktree.sh` slots) serves the web app on localhost:3000 + 10 * N
// for slot N in 1-15; that is still this machine and seeded data, so it stays
// a "local" run. A PR living preview (UI_EVIDENCE_PREVIEW_HOST_PATTERN) is "preview".
import type { ScriptStep } from "./script-schema.js";

export const DEFAULT_HOST = "http://localhost:3000";
// Which hostnames count as per-PR preview hosts is deployment-specific:
// UI_EVIDENCE_PREVIEW_HOST_PATTERN, a regex matched against the whole
// hostname (e.g. `pr-[0-9]+\.preview\.example\.com`). Write it so dev,
// staging and prod hosts under the same domain never match. Unset, no
// preview host is accepted.
export const PREVIEW_HOST_PATTERN_VARIABLE = "UI_EVIDENCE_PREVIEW_HOST_PATTERN";

function previewHostPattern(env: Record<string, string | undefined>): RegExp | { error: string } {
  const raw = env[PREVIEW_HOST_PATTERN_VARIABLE];
  if (raw === undefined || raw.trim() === "") return { error: `--host needs a preview host pattern, and none is configured (set ${PREVIEW_HOST_PATTERN_VARIABLE})` };
  try {
    return new RegExp(`^(?:${raw.trim()})$`);
  } catch {
    return { error: `${PREVIEW_HOST_PATTERN_VARIABLE} is not a valid regular expression` };
  }
}

// web-app's worktree slots: slot N (1-15) serves the web app on 3000 + 10 * N.
export const MAX_WORKTREE_SLOT = 15;

/** The web port of worktree slot `slot`, or null outside 1-15. */
export function worktreeSlotWebPort(slot: number): number | null {
  return Number.isInteger(slot) && slot >= 1 && slot <= MAX_WORKTREE_SLOT ? 3000 + 10 * slot : null;
}

/** True for http://localhost:<slot web port> with nothing else in the URL. */
function isWorktreeSlotHost(url: URL): boolean {
  const port = Number(url.port);
  return (
    url.protocol === "http:" &&
    url.hostname === "localhost" &&
    port > 3000 &&
    (port - 3000) % 10 === 0 &&
    worktreeSlotWebPort((port - 3000) / 10) === port
  );
}

export type HostResult = { ok: true; host: string; kind: "local" | "preview" } | { ok: false; error: string };

export interface HostFlags {
  host?: string;
  allowPreviewHost?: boolean;
}

export function resolveHost(flags: HostFlags, env: Record<string, string | undefined> = process.env): HostResult {
  if (flags.host === undefined) return { ok: true, host: DEFAULT_HOST, kind: "local" };
  let url: URL;
  try {
    url = new URL(flags.host);
  } catch {
    return { ok: false, error: `--host is not a URL: ${flags.host}` };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, error: "--host must not carry credentials" };
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") return { ok: false, error: "--host must be a bare origin (no path, query or fragment)" };
    if (url.hostname !== "localhost") return { ok: false, error: "--host must use localhost, not 127.0.0.1 (the api-server CORS allowlist names localhost)" };
    if (!isWorktreeSlotHost(url)) return { ok: false, error: `--host ${url.origin} is not a worktree slot web port (http://localhost:3000 + 10 * N, N 1-${MAX_WORKTREE_SLOT}); omit --host for localhost:3000` };
    return { ok: true, host: url.origin, kind: "local" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "--host must be https" };
  const preview = previewHostPattern(env);
  if ("error" in preview) return { ok: false, error: preview.error };
  if (!preview.test(url.hostname)) return { ok: false, error: `--host ${url.hostname} is not a preview host (${PREVIEW_HOST_PATTERN_VARIABLE}); dev and prod hosts are refused` };
  if (url.port !== "" || (url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") return { ok: false, error: "--host must be a bare origin (no port, path, query or fragment)" };
  if (flags.allowPreviewHost !== true) return { ok: false, error: "--host needs --allow-preview-host" };
  return { ok: true, host: url.origin, kind: "preview" };
}

/** Credentials come only from the environment; the error names variables, never values. */
export function readCredentials(env: Record<string, string | undefined>, emailEnv: string, passwordEnv: string): { email: string; password: string } | { error: string } {
  const email = env[emailEnv];
  const password = env[passwordEnv];
  const missing = [email ? null : emailEnv, password ? null : passwordEnv].filter((n): n is string => n !== null);
  return missing.length > 0 || !email || !password ? { error: `missing credentials in environment: ${missing.join(", ")}` } : { email, password };
}

/** Replaces every secret in `text`, so a Playwright error that echoes a filled value never reaches a log. */
export function redact(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length > 0).reduce((acc, s) => acc.split(s).join("[redacted]"), text);
}

const WRITE_WORDS = new Set([
  "save", "submit", "update", "delete", "remove", "create", "confirm", "publish", "send", "apply", "approve", "post", "add",
  "invite", "archive", "deactivate", "activate", "enable", "disable", "cancel", "reset", "assign", "import", "upload", "complete",
  "finish", "accept", "reject", "sync", "release", "merge", "logout", "signout", "register",
]);
// "savebutton", "deleteBtn": a write word fused with a generic control suffix.
const CONTROL_SUFFIXES = new Set(["btn", "button", "link", "action"]);

function isWriteWord(token: string): boolean {
  if (WRITE_WORDS.has(token)) return true;
  return [...WRITE_WORDS].some((w) => token.startsWith(w) && CONTROL_SUFFIXES.has(token.slice(w.length)));
}

/** Splits camelCase and separators into lower-case words: "updateHospital-btn" -> update, hospital, btn. */
function words(target: string): string[] {
  return target.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}

/** A goto target is a path on the vetted host: one leading slash, no scheme-relative `//` and no backslash. */
export function isSameOriginPath(target: string): boolean {
  return target.startsWith("/") && !target.startsWith("//") && !target.includes("\\");
}

/**
 * Best-effort: click steps (and goto paths) whose words read like a save/submit/update/delete control.
 * Every drag counts as a write: dropping moves data whatever the test ids say.
 */
export function findWriteSteps(steps: ScriptStep[]): Array<{ index: number; target: string }> {
  return steps.flatMap((s, index) => {
    if (s.action === "drag") return [{ index, target: `${s.target} → ${s.to}` }];
    const label = s.action === "click" ? s.target : s.action === "goto" ? (s.target.split("?")[0] as string) : null;
    return label !== null && words(label).some(isWriteWord) ? [{ index, target: s.target }] : [];
  });
}

/**
 * The goto origin check always applies (a target like `@app.example.com/x` would leave the vetted
 * host); the write-word check is skipped under --allow-writes.
 */
export function guardWrites(steps: ScriptStep[], allowWrites: boolean): { ok: true } | { ok: false; error: string } {
  const offOrigin = steps.flatMap((s, index) => (s.action === "goto" && !isSameOriginPath(s.target) ? [`#${index + 1} goto ${s.target}`] : []));
  if (offOrigin.length > 0) return { ok: false, error: `goto targets must be paths on the host (start with a single "/"): ${offOrigin.join(", ")}` };
  const writes = allowWrites ? [] : findWriteSteps(steps);
  return writes.length === 0 ? { ok: true } : { ok: false, error: `refusing write-looking steps without --allow-writes: ${writes.map((w) => `#${w.index + 1} ${steps[w.index]?.action} ${w.target}`).join(", ")}` };
}

/** True for a request that would navigate the browser away from the vetted host. */
export function isOffOriginNavigation(host: string, url: string, isNavigation: boolean): boolean {
  return isNavigation && !url.startsWith("about:") && new URL(url).origin !== new URL(host).origin;
}

export type Provenance = "seeded" | "scrubbed" | "unknown";

/**
 * A preview is a scrubbed customer extract, but an explicit `unknown` stays `unknown` (the caller
 * asked for the data to stay local). A local run is only as safe as its DB check says.
 */
export function provenanceFor(kind: "local" | "preview", dbProvenance: "seeded" | "unknown" | undefined): Provenance {
  if (kind === "preview") return dbProvenance === "unknown" ? "unknown" : "scrubbed";
  return dbProvenance ?? "unknown";
}

/** Runs against anything but this machine never count as seeded data. */
export function isLocalHost(host: string | undefined): boolean {
  if (host === undefined) return true;
  const { hostname } = new URL(host);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

// Previews sit behind private-network preflights that headless Chrome otherwise blocks (their API resolves to a 10.x address).
const PREVIEW_LAUNCH_ARGS = ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"];

/** Chromium launch args for a run: the preview flags only for preview hosts; localhost is unchanged. */
export function browserLaunchArgs(hostKind: "local" | "preview"): string[] {
  return hostKind === "preview" ? [...PREVIEW_LAUNCH_ARGS] : [];
}
