import { describe, expect, it } from "vitest";

import { browserLaunchArgs, DEFAULT_HOST, findWriteSteps, guardWrites, isLocalHost, isOffOriginNavigation, isSameOriginPath, provenanceFor, readCredentials, redact, resolveHost, worktreeSlotWebPort } from "../src/host-guard.js";
import type { ScriptStep } from "../src/script-schema.js";

const goto = (target: string): ScriptStep => ({ action: "goto", target, expectedState: { kind: "url-path", path: "/" } });
const click = (target: string): ScriptStep => ({ action: "click", target, expectedState: { kind: "testid-visible", testId: target } });

describe("resolveHost", () => {
  const env = { UI_EVIDENCE_PREVIEW_HOST_PATTERN: "pr-[0-9]+\\.preview\\.example\\.com" };
  it("defaults to localhost:3000 with no flags", () => {
    expect(resolveHost({}, {})).toEqual({ ok: true, host: DEFAULT_HOST, kind: "local" });
  });
  it("accepts a host matching the configured preview pattern only with --allow-preview-host", () => {
    expect(resolveHost({ host: "https://pr-17450.preview.example.com", allowPreviewHost: true }, env)).toEqual({ ok: true, host: "https://pr-17450.preview.example.com", kind: "preview" });
    expect(resolveHost({ host: "https://pr-17450.preview.example.com/", allowPreviewHost: true }, env)).toMatchObject({ ok: true });
    expect(resolveHost({ host: "https://pr-17450.preview.example.com" }, env)).toEqual({ ok: false, error: "--host needs --allow-preview-host" });
  });
  it("refuses every non-local host when no preview pattern is configured, naming the variable", () => {
    for (const e of [{}, { UI_EVIDENCE_PREVIEW_HOST_PATTERN: "  " }]) {
      const r = resolveHost({ host: "https://pr-1.preview.example.com", allowPreviewHost: true }, e);
      expect(r).toEqual({ ok: false, error: "--host needs a preview host pattern, and none is configured (set UI_EVIDENCE_PREVIEW_HOST_PATTERN)" });
    }
  });
  it("refuses an invalid pattern without echoing it", () => {
    expect(resolveHost({ host: "https://pr-1.preview.example.com", allowPreviewHost: true }, { UI_EVIDENCE_PREVIEW_HOST_PATTERN: "pr-(" })).toEqual({ ok: false, error: "UI_EVIDENCE_PREVIEW_HOST_PATTERN is not a valid regular expression" });
  });
  it("matches the whole hostname, so an alternation cannot widen it to a suffix or prefix", () => {
    const alt = { UI_EVIDENCE_PREVIEW_HOST_PATTERN: "pr-1\\.preview\\.example\\.com|pr-2\\.preview\\.example\\.com" };
    expect(resolveHost({ host: "https://pr-2.preview.example.com", allowPreviewHost: true }, alt)).toMatchObject({ ok: true });
    expect(resolveHost({ host: "https://pr-1.preview.example.com.evil.com", allowPreviewHost: true }, alt)).toMatchObject({ ok: false });
    expect(resolveHost({ host: "https://evil-pr-2.preview.example.com", allowPreviewHost: true }, alt)).toMatchObject({ ok: false });
  });
  it.each([
    ["https://app.preview.example.com", "not a preview host"],
    ["https://dev.example.com", "not a preview host"],
    ["https://example.com", "not a preview host"],
    ["https://pr-1.preview.example.com.evil.com", "not a preview host"],
    ["https://pr-abc.preview.example.com", "not a preview host"],
    ["https://app.example.org", "not a preview host"],
    ["http://pr-1.preview.example.com", "must be https"],
    ["https://user:pw@pr-1.preview.example.com", "credentials"],
    ["https://pr-1.preview.example.com:8443", "bare origin"],
    ["https://pr-1.preview.example.com/admin", "bare origin"],
    ["https://pr-1.preview.example.com/?x=1", "bare origin"],
    ["https://pr-1.preview.example.com/#x", "bare origin"],
    ["not a url", "not a URL"],
    ["localhost:3000", "must be https"],
  ])("refuses %s", (host, why) => {
    const r = resolveHost({ host, allowPreviewHost: true }, env);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain(why);
  });
});

describe("resolveHost worktree slots", () => {
  it.each([
    ["http://localhost:3010", "http://localhost:3010"],
    ["http://localhost:3020/", "http://localhost:3020"],
    ["http://localhost:3150", "http://localhost:3150"],
  ])("accepts slot web port %s as a local run with no opt-in", (host, origin) => {
    expect(resolveHost({ host })).toEqual({ ok: true, host: origin, kind: "local" });
  });
  it.each([
    ["http://localhost:3000", "not a worktree slot"],
    ["http://localhost:3015", "not a worktree slot"],
    ["http://localhost:3160", "not a worktree slot"],
    ["http://localhost:5022", "not a worktree slot"],
    ["http://localhost", "not a worktree slot"],
    ["http://127.0.0.1:3020", "must use localhost"],
    ["http://localhost:3020/admin", "bare origin"],
    ["http://localhost:3020/?x=1", "bare origin"],
    ["http://user:pw@localhost:3020", "credentials"],
  ])("refuses %s", (host, why) => {
    const r = resolveHost({ host });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain(why);
  });
  it("worktreeSlotWebPort maps slots 1-15 and nothing else", () => {
    expect(worktreeSlotWebPort(1)).toBe(3010);
    expect(worktreeSlotWebPort(15)).toBe(3150);
    expect(worktreeSlotWebPort(0)).toBeNull();
    expect(worktreeSlotWebPort(16)).toBeNull();
    expect(worktreeSlotWebPort(1.5)).toBeNull();
  });
});

describe("readCredentials", () => {
  it("returns both values from the env", () => {
    expect(readCredentials({ E: "a@b.c", P: "pw" }, "E", "P")).toEqual({ email: "a@b.c", password: "pw" });
  });
  it("names only the missing variables, never a value", () => {
    const r = readCredentials({ E: "secret@x.y" }, "E", "P");
    expect(r).toEqual({ error: "missing credentials in environment: P" });
    expect(readCredentials({}, "E", "P")).toEqual({ error: "missing credentials in environment: E, P" });
    expect(readCredentials({ E: "", P: "" }, "E", "P")).toEqual({ error: "missing credentials in environment: E, P" });
  });
});

describe("redact", () => {
  it("removes every occurrence of every secret and ignores empty ones", () => {
    expect(redact("fill a@b.c then pw, pw again", ["a@b.c", "pw", ""])).toBe("fill [redacted] then [redacted], [redacted] again");
  });
});

describe("write guard", () => {
  it("flags click steps that read like save/submit/update controls, including camelCase", () => {
    const steps = [click("hospital-day-starts-at"), click("update-hospital-button"), click("saveChanges"), click("coverage-pattern-option-8/4/4/8"), { ...click("form"), action: "fill" as const }, { ...click("save"), action: "fill" as const }];
    expect(findWriteSteps(steps)).toEqual([
      { index: 1, target: "update-hospital-button" },
      { index: 2, target: "saveChanges" },
    ]);
  });
  it("does not trip on words that merely contain a write word", () => {
    expect(findWriteSteps([click("preview-manage-staffing-toggle"), click("postal-code-help"), click("address-line")])).toEqual([]);
  });
  it("never flags a read-only scroll step, whatever its target reads like", () => {
    const exp = { kind: "testid-visible" as const, testId: "y" };
    expect(findWriteSteps([{ action: "scroll", target: "save-panel-scroll", value: "end", expectedState: exp }])).toEqual([]);
    expect(guardWrites([{ action: "scroll", target: "schedule-view-scroll-container", expectedState: exp }], false)).toEqual({ ok: true });
  });
  it("refuses with the offending steps unless writes are allowed", () => {
    const steps = [click("a"), click("submit-form")];
    expect(guardWrites(steps, false)).toEqual({ ok: false, error: "refusing write-looking steps without --allow-writes: #2 click submit-form" });
    expect(guardWrites(steps, true)).toEqual({ ok: true });
    expect(guardWrites([click("a")], false)).toEqual({ ok: true });
  });
  it("flags every drag, whatever its test ids say", () => {
    const drag: ScriptStep = { action: "drag", target: "shift-card", to: "day-cell", expectedState: { kind: "testid-visible", testId: "day-cell" } };
    expect(findWriteSteps([click("a"), drag])).toEqual([{ index: 1, target: "shift-card → day-cell" }]);
    expect(guardWrites([drag], false)).toEqual({ ok: false, error: "refusing write-looking steps without --allow-writes: #1 drag shift-card → day-cell" });
    expect(guardWrites([drag], true)).toEqual({ ok: true });
  });
});

describe("goto origin guard", () => {
  it("accepts a single-slash path and rejects anything that could rewrite the host", () => {
    expect(isSameOriginPath("/admin?x=1")).toBe(true);
    expect(isSameOriginPath("/a@b.com")).toBe(true);
    for (const bad of ["@app.example.com/admin", ".evil.com", "//evil.com", "/\\evil.com", "https://evil.com", ""]) expect(isSameOriginPath(bad)).toBe(false);
  });
  it("guardWrites refuses off-origin goto targets even with --allow-writes", () => {
    const steps = [goto("/ok"), goto("@app.example.com/admin")];
    expect(guardWrites(steps, true)).toEqual({ ok: false, error: 'goto targets must be paths on the host (start with a single "/"): #2 goto @app.example.com/admin' });
    expect(guardWrites(steps, false).ok).toBe(false);
  });
  it("flags a goto to a mutating path, ignoring the query string", () => {
    expect(findWriteSteps([goto("/hospital/1/delete"), goto("/admin?action=save"), goto("/admin-hospital-configuration?tab=info")])).toEqual([{ index: 0, target: "/hospital/1/delete" }]);
    expect(guardWrites([goto("/hospital/1/delete")], false)).toEqual({ ok: false, error: "refusing write-looking steps without --allow-writes: #1 goto /hospital/1/delete" });
  });
  it("detects off-origin navigations only", () => {
    const host = "https://pr-1.preview.example.com";
    expect(isOffOriginNavigation(host, "https://pr-1.preview.example.com/x", true)).toBe(false);
    expect(isOffOriginNavigation(host, "https://app.example.com/x", true)).toBe(true);
    expect(isOffOriginNavigation(host, "https://cdn.example.com/a.js", false)).toBe(false);
    expect(isOffOriginNavigation(host, "about:blank", true)).toBe(false);
  });
});

describe("expanded write words", () => {
  it("catches verbs beyond save/submit and control-suffixed ids", () => {
    const targets = ["invite-user", "archive-hospital", "reset-password", "cancel-shift", "logout", "saveBtn", "delete-button", "SAVEBUTTON", "btn-save", "import-link"];
    expect(findWriteSteps(targets.map(click)).map((s) => s.target)).toEqual(targets);
  });
  it("still leaves read-only controls and look-alike words alone", () => {
    expect(findWriteSteps(["savings-summary", "address-line", "postal-code", "assignee-filter"].map(click))).toEqual([]);
  });
});

describe("provenanceFor", () => {
  it("treats a preview as scrubbed, keeps an explicit unknown, and a local run as its DB check", () => {
    expect(provenanceFor("preview", undefined)).toBe("scrubbed");
    expect(provenanceFor("preview", "seeded")).toBe("scrubbed");
    expect(provenanceFor("preview", "unknown")).toBe("unknown");
    expect(provenanceFor("local", "seeded")).toBe("seeded");
    expect(provenanceFor("local", "unknown")).toBe("unknown");
    expect(provenanceFor("local", undefined)).toBe("unknown");
  });
  it("only localhost counts as a local host", () => {
    expect([isLocalHost(undefined), isLocalHost("http://localhost:3000"), isLocalHost("http://127.0.0.1:4000"), isLocalHost("https://pr-1.preview.example.com")]).toEqual([true, true, true, false]);
  });
});

describe("browserLaunchArgs", () => {
  it("passes the private-network flags only for preview hosts", () => {
    expect(browserLaunchArgs("preview")).toEqual(["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"]);
    expect(browserLaunchArgs("local")).toEqual([]);
  });
  it("returns a fresh array each call", () => {
    expect(browserLaunchArgs("preview")).not.toBe(browserLaunchArgs("preview"));
  });
});
