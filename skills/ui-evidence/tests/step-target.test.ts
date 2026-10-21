import { describe, expect, it } from "vitest";

import { isPrefixedTarget, parseStepTarget, targetLabel } from "../src/step-target.js";

describe("parseStepTarget", () => {
  it("keeps a bare target as a test id", () => {
    expect(parseStepTarget("save-btn")).toEqual({ kind: "testId", testId: "save-btn" });
  });
  it("parses role:<role>|<name>, keeping a | inside the name", () => {
    expect(parseStepTarget("role:button|Save")).toEqual({ kind: "role", role: "button", name: "Save" });
    expect(parseStepTarget("role:option|A | B")).toEqual({ kind: "role", role: "option", name: "A | B" });
  });
  it("parses a trailing #<n> as a 1-based nth and keeps the label clean", () => {
    expect(parseStepTarget("role:option|07:00-19:30 Day#2")).toEqual({ kind: "role", role: "option", name: "07:00-19:30 Day", nth: 2 });
    expect(parseStepTarget("text:Twin#1")).toEqual({ kind: "text", text: "Twin", nth: 1 });
    expect(parseStepTarget("role:option|A#0")).toHaveProperty("error");
    expect(parseStepTarget("text:A#0")).toHaveProperty("error");
    expect(parseStepTarget("text:Shift #12")).toEqual({ kind: "text", text: "Shift #12" });
    expect(parseStepTarget("role:option|Room #4#1")).toEqual({ kind: "role", role: "option", name: "Room #4", nth: 1 });
    expect(parseStepTarget("role:option|A#99999999999999999999")).toHaveProperty("error");
    expect(parseStepTarget("text:#2")).toEqual({ kind: "text", text: "#2" });
    expect(parseStepTarget("save#2")).toEqual({ kind: "testId", testId: "save#2" });
    expect(targetLabel("role:option|Delete shift#2")).toBe("Delete shift");
  });
  it("parses text:<text>", () => {
    expect(parseStepTarget("text:Unit 4200")).toEqual({ kind: "text", text: "Unit 4200" });
  });
  it("reports malformed prefixed targets", () => {
    for (const bad of ["role:button", "role:|x", "role:button|", "text:", "role:button|  ", "text:  ", "role:Button|Save", "Role:button|Save", " text:Save"]) expect(parseStepTarget(bad)).toHaveProperty("error");
  });
  it("labels prefixed targets by their name or text", () => {
    expect(targetLabel("role:button|Save")).toBe("Save");
    expect(targetLabel("text:Delete")).toBe("Delete");
    expect(targetLabel("save-btn")).toBe("save-btn");
    // A malformed target is labelled as written, so the write guard still reads its words.
    expect(targetLabel("role:delete")).toBe("role:delete");
    expect(isPrefixedTarget("text:x")).toBe(true);
    expect(isPrefixedTarget("x")).toBe(false);
  });
});
