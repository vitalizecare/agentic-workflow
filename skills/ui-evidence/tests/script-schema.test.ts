import { describe, expect, it } from "vitest";

import { describeExpectedState, parseUiScript } from "../src/script-schema.js";

const exp = { kind: "testid-visible", testId: "y" };
const scriptWith = (extra: object, steps: unknown[] = [{ action: "goto", target: "/x", expectedState: exp }]): unknown => ({ route: "/", role: "manager", viewports: ["desktop"], steps, ...extra });

describe("scroll step", () => {
  it.each([undefined, "end", "start", "top", "bottom", "0", "480"])("accepts value %s", (value) => {
    const step = { action: "scroll", target: "schedule-view-scroll-container", ...(value !== undefined ? { value } : {}), expectedState: exp };
    expect(parseUiScript(scriptWith({}, [step]))).not.toHaveProperty("error");
  });
  it.each(["middle", "-5", "1.5", "", "10px"])("rejects value %j", (value) => {
    expect(parseUiScript(scriptWith({}, [{ action: "scroll", target: "c", value, expectedState: exp }]))).toHaveProperty("error");
  });
  it("leaves other actions' values unconstrained", () => {
    expect(parseUiScript(scriptWith({}, [{ action: "fill", target: "c", value: "middle", expectedState: exp }]))).not.toHaveProperty("error");
  });
});

describe("step index", () => {
  it.each(["click", "fill", "scroll"])("accepts index 0 and 3 on %s", (action) => {
    for (const index of [0, 3]) expect(parseUiScript(scriptWith({}, [{ action, target: "c", index, expectedState: exp }]))).not.toHaveProperty("error");
  });
  it.each(["goto", "expect-visible"])("rejects index on %s", (action) => {
    expect(parseUiScript(scriptWith({}, [{ action, target: "/c", index: 1, expectedState: exp }]))).toHaveProperty("error");
  });
  it.each([-1, 1.5, "1"])("rejects index %j", (index) => {
    expect(parseUiScript(scriptWith({}, [{ action: "click", target: "c", index, expectedState: exp }]))).toHaveProperty("error");
  });
});

describe("script login", () => {
  it("parses the env-var-only form with one-step form defaults and an explicit form", () => {
    const r = parseUiScript(scriptWith({ login: { emailEnv: "ADMIN_EMAIL", passwordEnv: "ADMIN_PASSWORD" } }, [{ action: "goto", target: "/x", expectedState: exp }, { action: "scroll", target: "schedule-view-scroll-container", value: "end", expectedState: exp }]));
    expect(r).toMatchObject({ login: { emailSelector: 'input[type="email"]', passwordSelector: 'input[type="password"]', submitSelector: 'button[type="submit"]', loginPath: "/login" } });
    expect((r as { login: object }).login).not.toHaveProperty("nextSelector");
    const full = { emailEnv: "E", passwordEnv: "P", emailSelector: "a", passwordSelector: "b", nextSelector: "n", submitSelector: "s", loginPath: "/signin" };
    expect(parseUiScript(scriptWith({ login: full }))).toMatchObject({ login: full });
  });
  it.each([
    ["a literal email as the env name", { emailEnv: "me@x.com", passwordEnv: "P" }],
    ["a lower-case env name", { emailEnv: "E", passwordEnv: "p" }],
    ["a missing password env", { emailEnv: "E" }],
    ["a misspelt key", { emailEnv: "E", passwordEnv: "P", loginpath: "/x" }],
    ["a literal password key", { emailEnv: "E", passwordEnv: "P", password: "hunter2" }],
  ])("rejects %s", (_n, login) => {
    expect(parseUiScript(scriptWith({ login }))).toHaveProperty("error");
  });
  it("is optional", () => {
    expect(parseUiScript(scriptWith({}))).not.toHaveProperty("login");
  });
});

describe("parseUiScript", () => {
  it("parses a valid script", () => {
    const result = parseUiScript({
      route: "/staff-schedule/my-schedule",
      role: "staff",
      viewports: ["desktop", "phone"],
      steps: [{ action: "goto", target: "/staff-schedule/my-schedule", expectedState: { kind: "text-visible", text: "My Schedule" } }],
    });
    expect(result).not.toHaveProperty("error");
  });

  it("takes any lower-case kebab-case role, the app's own name for it", () => {
    for (const role of ["admin", "team-lead", "viewer2"]) {
      expect(parseUiScript({ route: "/x", role, viewports: ["desktop"], steps: [{ action: "goto", target: "/x", expectedState: { kind: "text-visible", text: "x" } }] })).not.toHaveProperty("error");
    }
  });

  it.each(["", "Admin", "super admin", "-x"])("rejects the role %j", (role) => {
    expect(parseUiScript({ route: "/x", role, viewports: ["desktop"], steps: [{ action: "goto", target: "/x", expectedState: { kind: "text-visible", text: "x" } }] })).toHaveProperty("error");
  });

  it("rejects a script with no viewports", () => {
    const result = parseUiScript({ route: "/x", role: "staff", viewports: [], steps: [{ action: "goto", target: "/x", expectedState: { kind: "text-visible", text: "x" } }] });
    expect(result).toHaveProperty("error");
  });

  it("rejects malformed JSON-shaped input entirely (not an object)", () => {
    expect(parseUiScript("not an object")).toHaveProperty("error");
  });

  it("rejects free-form prose as an expectedState (must be machine-checkable)", () => {
    const result = parseUiScript({ route: "/x", role: "staff", viewports: ["desktop"], steps: [{ action: "goto", target: "/x", expectedState: "page looks fine" }] });
    expect(result).toHaveProperty("error");
  });

  it("accepts optional planning provenance with unknown usage left out", () => {
    const result = parseUiScript({ route: "/x", role: "staff", viewports: ["desktop"], planning: { pr: "123", model: "sonnet" }, steps: [{ action: "goto", target: "/x", expectedState: { kind: "url-path", path: "/x" } }] });
    expect(result).not.toHaveProperty("error");
  });

  it("describes every expectedState kind for the repair prompt", () => {
    expect(describeExpectedState({ kind: "text-visible", text: "a" })).toContain("visible");
    expect(describeExpectedState({ kind: "text-absent", text: "a" })).toContain("absent");
    expect(describeExpectedState({ kind: "testid-visible", testId: "t" })).toContain("t");
    expect(describeExpectedState({ kind: "url-path", path: "/p" })).toContain("/p");
    expect(describeExpectedState({ kind: "input-value", testId: "t", value: "v" })).toContain('"v"');
  });
});
