import { z } from "zod";

import { ScriptLoginSchema } from "./login.js";

// A machine-checkable post-step expectation. Free-form prose can't be
// asserted, so the planner must emit one of these shapes; runStep checks it
// after every step, and a step whose expectation fails is never a pass.
export const ExpectedStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text-visible"), text: z.string().min(1) }),
  z.object({ kind: z.literal("text-absent"), text: z.string().min(1) }),
  z.object({ kind: z.literal("testid-visible"), testId: z.string().min(1) }),
  // Checked once, immediately after the action (no wait for disappearance), so
  // a leftover element right after a drag drop fails the step.
  z.object({ kind: z.literal("testid-absent"), testId: z.string().min(1) }),
  z.object({ kind: z.literal("url-path"), path: z.string().min(1) }),
  z.object({ kind: z.literal("input-value"), testId: z.string().min(1), value: z.string() }),
]);
export type ExpectedState = z.infer<typeof ExpectedStateSchema>;

// scroll's `value`: end/start (horizontal), bottom/top (vertical) or a horizontal pixel offset; default end.
const SCROLL_VALUE = /^(end|start|bottom|top|\d+)$/;

// Pixels from an element's top-left corner.
const OffsetSchema = z.object({ x: z.number(), y: z.number() });

export const ScriptStepSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.enum(["goto", "click", "fill", "expect-visible", "scroll"]),
      target: z.string(),
      value: z.string().optional(),
      /** Picks the nth match (0-based) when a data-testid repeats; click, fill and scroll only. */
      index: z.number().int().nonnegative().optional(),
      expectedState: ExpectedStateSchema,
    }),
    // A real-mouse drag from `target` to `to` (both data-testids). Offsets
    // default to each element's center; `holdAlt` holds Alt through the release.
    z.object({
      action: z.literal("drag"),
      target: z.string().min(1),
      to: z.string().min(1),
      grabOffset: OffsetSchema.optional(),
      dropOffset: OffsetSchema.optional(),
      holdAlt: z.boolean().optional(),
      expectedState: ExpectedStateSchema,
    }),
  ])
  .superRefine((step, ctx) => {
    if (step.action === "drag") return;
    if (step.index !== undefined && step.action !== "click" && step.action !== "fill" && step.action !== "scroll") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["index"], message: "index is only allowed for click, fill and scroll steps" });
    }
    if (step.action === "scroll" && step.value !== undefined && !SCROLL_VALUE.test(step.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: 'scroll value must be "end", "start", "bottom", "top" or a non-negative integer pixel offset' });
    }
  });
export type ScriptStep = z.infer<typeof ScriptStepSchema>;
export type DragStep = Extract<ScriptStep, { action: "drag" }>;

/** The step's label in summaries and errors: `click save`, `drag shift-1 → day-2`. */
export function describeStep(step: ScriptStep): string {
  return step.action === "drag" ? `drag ${step.target} → ${step.to}` : `${step.action} ${step.target}`;
}

// Provenance for the cost baseline: the planner's one model invocation,
// linked to the run that executes its script. Every field is optional —
// missing usage stays unknown, never zero.
export const PlanningMetaSchema = z.object({
  pr: z.string().optional(),
  model: z.string().optional(),
  elapsedMs: z.number().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});
export type PlanningMeta = z.infer<typeof PlanningMetaSchema>;

export const UiScriptSchema = z.object({
  route: z.string(),
  // The app role the script signs in as (the app's own names, e.g. "admin");
  // recorded in the summary, not interpreted.
  role: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** Env-var sign-in run before the first step (credentials never live in the script). */
  login: ScriptLoginSchema.optional(),
  steps: z.array(ScriptStepSchema).min(1),
  viewports: z.array(z.enum(["desktop", "phone"])).min(1),
  planning: PlanningMetaSchema.optional(),
  // Written verbatim into the host origin's localStorage before every page
  // load (so before the first step): feature-flag overrides and similar
  // client toggles.
  localStorage: z.record(z.string(), z.string()).optional(),
});
export type UiScript = z.infer<typeof UiScriptSchema>;

export function parseUiScript(raw: unknown): UiScript | { error: string } {
  const parsed = UiScriptSchema.safeParse(raw);
  return parsed.success ? parsed.data : { error: parsed.error.message };
}

export function describeExpectedState(e: ExpectedState): string {
  switch (e.kind) {
    case "text-visible": return `text "${e.text}" visible`;
    case "text-absent": return `text "${e.text}" absent`;
    case "testid-visible": return `element ${e.testId} visible`;
    case "testid-absent": return `element ${e.testId} absent`;
    case "url-path": return `url path ${e.path}`;
    case "input-value": return `input ${e.testId} has value "${e.value}"`;
  }
}
