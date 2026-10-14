---
name: ui-evidence
description: Generate Playwright-based UI evidence for a web app PR — plan with qa-runner, run headless with no model, repair broken selectors via judge, lint for sloppiness, and publish (ask-first) to Linear and a PR comment. Local stack only, never dev/prod.
---

# UI evidence

If `deployment.md` sits next to this file, read it first: it holds this deployment's conventions (preview hosts, roles, login form, where credentials come from). Deployment-specific values are settings, never code ([Configuration](#configuration)).

1. Doctor the stack: `bash scripts/doctor.sh`. Refuse to proceed if unhealthy or foreign (RF-1).
2. **Spawn a subagent** — the `qa-runner` custom agent (installed per provider) — with the PR diff and the app's route map (if the repo documents one) to write a script (`script-schema.ts`'s shape).
3. `with_stack_lock_and_heavy_job_lock 120 node dist/bin.js <script.json> <run-dir> [--baseline main.png] [--app-build <sha>] [--fixtures <id>] [--cache <manifest.json>]` (exit 0 all steps passed, 2 a step failed/broken, 1 bad usage or invalid script; the summary JSON is printed and written to `<run-dir>/summary.json`, including `appBuild` — pass `--app-build $(git rev-parse HEAD)` so the run is tied to a commit).
4. Check DB provenance (`checkDbProvenance`) before deciding whether Linear upload is even offered.
5. Visual verdict, cheapest first (`visual-gate.ts`): (a) deterministic pixel compare of the last passed screenshot against the approved main baseline — identical pixels and all steps passed ⇒ `unchanged`, **no model call**; (b) verdict cache (`verdict-cache.ts`) keyed on the actual after+baseline image hashes plus prompt/model version, app build, script, fixtures, viewport and browser version — a hit reuses the prior critique and is recorded as a cache hit; (c) otherwise one `judge visual-critique` call on the cropped changed region (image-capable CLI only — Jev is text-only and never sees images). Any failure, timeout, or out-of-enum result is `unchecked` — never a default `looks-right`. A run with a failed/broken step always gets a critique. The browser run and every step check always execute; a cached or `unchanged` visual never stands in for a behavior check.
6. `publishEvidence(...)` — every write asks first, per this repo's policy. Artifact URLs (screenshots, `*-trace.zip`, videos, diff overlay) come only from an approved `uploadArtifact` uploader and only when DB provenance is `seeded`; otherwise evidence stays local paths.

## Host override (guard rails)

`localhost:3000` stays the default. `--host https://<preview-host> --allow-preview-host` runs against a PR living preview and nothing else: the hostname must fully match `UI_EVIDENCE_PREVIEW_HOST_PATTERN` (a regex such as `pr-[0-9]+\.preview\.example\.com`; write it so dev, staging and prod hosts never match), over https with no port, path or credentials. With no pattern configured every non-local host is refused. `goto` targets must be paths on that host (one leading `/`; `@evil.com/x`, `//evil.com` and backslashes are refused, and `performAction` re-checks), and the parity browser aborts any navigation to another origin. A host override is read-only on a best-effort basis: click steps (and `goto` paths) whose words read like save/submit/update/delete/create/confirm/publish/send/apply/approve/post/add/invite/archive/cancel/reset/assign/import/upload/enable/disable/complete/sync/logout and similar — including `saveBtn`/`delete-button` forms — are refused unless `--allow-writes`. The check is a keyword heuristic on test ids: it cannot see what an opaque id does, and a `fill` into an autosaving input is not covered, so only point it at pages whose controls you know. Selector repair can click a model-chosen element; keep host-override scripts to stable test ids. Credentials come only from environment variables (e.g. run under your secrets manager's `run --` wrapper); they are never printed, and error text is scrubbed of them. A preview is a scrubbed customer extract: `parity` records provenance `scrubbed` (an explicit `--db-provenance unknown` stays `unknown`). On the original script runner a non-local host is recorded in `summary.json` (`host`), and `publishEvidence` treats any non-local host as `unknown` whatever the caller passes, so those runs stay local; use `parity` for scrubbed-data uploads to Linear.

### Step actions and login for the plain runner

Script steps are `goto`, `click`, `fill`, `expect-visible` and `scroll`; each asserts its `expectedState` afterwards and takes a per-step screenshot. `scroll` moves a scroll container (`target` is its `data-testid`) so a scrolled state can be captured: `value` is `end` (default; `scrollLeft = scrollWidth`), `start` (`scrollLeft = 0`), `bottom` / `top` (vertical) or a non-negative integer horizontal pixel offset; anything else fails the schema. It waits for layout to settle, is read-only (the write guard never flags it), and a missing target is `broken`; like `expect-visible` it is never selector-repaired.

A step may carry an optional `index` (non-negative integer; `click`, `fill` and `scroll` only, rejected at parse time on `goto` and `expect-visible`) to pick the nth match (0-based) of a repeated `data-testid`, e.g. `{"action":"click","target":"timeline-window-row-open-list","index":1,...}`. Without `index` the locator stays strict: several matches fail the action and go to selector repair as before; with `index` a broken target is repaired as before. `index` is part of the step, so it is in the scenario hash.

An optional script-level `login` signs in before the first step of each viewport, on previews that need a session: `{"emailEnv": "ADMIN_EMAIL", "passwordEnv": "ADMIN_PASSWORD"}` plus optional `emailSelector`, `passwordSelector`, `nextSelector`, `submitSelector` (defaults fit a one-step email + password form: `input[type="email"]`, `input[type="password"]`, `button[type="submit"]`; set `nextSelector` for a two-step form) and `loginPath` (default `/login`). It is strict like the parity login: env var names must be `UPPER_SNAKE`, unknown keys fail the parse. Credentials come only from the environment; a missing variable stops the run before a browser starts, values never reach `summary.json` or logs, and error text is scrubbed of them. Only the env var names and selectors enter the scenario hash. The shared implementation lives in `login.ts`; without `login` nothing changes.


## Design-parity mode (Figma pixel diff)

Compares the implementation with a design export instead of with a main-branch screenshot. Existing usage is unchanged.

```bash
with_stack_lock_and_heavy_job_lock 120 node dist/bin.js parity <manifest.json> <run-dir> \
  [--host https://<preview-host> --allow-preview-host] [--allow-writes] [--app-build $(git rev-parse HEAD)] [--db-provenance seeded|unknown]
```

Exit 0 all geometry checks passed, 1 bad usage/manifest/guard, 2 a geometry check failed, 4 the run itself errored (anchor missing, step failed, region outside the viewport). `<run-dir>/parity.json` is the summary; it is deleted at the start of every run, so a failed run never leaves an earlier summary for `parity-plan` to publish.

1. **Design PNGs at 1x.** Get each frame at its native size with the Figma MCP `get_screenshot` (frame node, scale 1) and save it under the run, or accept any PNG export. The default viewport is the Figma frame (1512x982, DPR 1) — set `viewport` to match your frame.
2. **Manifest** (`parity-schema.ts`; worked example in `examples/design-parity/example-manifest.json`): `route`, `ready` (an element that must be visible before anything is asserted — a text-absent check straight after `goto` passes vacuously on the loading spinner), optional `login` (env var names + CSS selectors only), `settleMs`, `threshold` (default 0.1), `includeAA` (default false), and `frames[]`. Every object is strict — a misspelt key (`expectBox`) fails the parse instead of dropping an assertion. `viewport` must contain every crop (`anchor origin + designRegion` size); otherwise the run stops with the viewport size it needs (raise `viewport.h`). `timeoutMs` (default 60s) bounds `ready`, `waitFor` and the anchor lookup. `neutralClick` (default: 22px in from the viewport corner, or `false`) is skipped when that spot holds a control. `login` also takes `nextSelector` (two-step forms) and `loginPath`. The write guard applies to `parity` steps on localhost too. Each frame has `designPng`, `designRegion {x,y,w,h}`, an `anchor` (`{testId}` or `{text}`) whose bbox origin locates the implementation crop (plus optional `anchorOffset`), optional `steps` (same shape as script steps, run in order on the same page so states accumulate), `formValues` (typed to match the design's sample data, never saved), `expectBoxes`, `knownDifferences` and `designNode` (this frame's Figma node; it wins over the manifest-level one in the Linear subtitle).
3. **Output per frame:** `<name>-design.png`, `-implementation.png`, `-diff.png`, `-side-by-side.png` (design | implementation | diff, 12px gaps), `-full.png`, and a `parity.json` entry: `diffPercent`, `diffPixels`, `total`, anchor bbox, `sizeDelta` vs the design region, `boxChecks`, `knownDifferences`. Pure, unit-tested primitives live in `parity.ts` (`cropRegion`, `compareRegion`, `sideBySide`, `checkBoxes`).
4. **Geometry assertions:** `expectBoxes: [{target, relativeTo?, expected:{w,h,x,y}, tolerance?}]` (tolerance default 0; x/y are relative to `relativeTo` when given). A mismatch, or an element that cannot be found, fails the run (exit 2) and is printed.
5. **Known differences:** list intentional differences (copy, data) per frame. They are carried into the report, the Linear subtitle and the PR text, so a non-zero diff is explained, never hidden. Do not list a difference you have not looked at.
6. **Capture hygiene** is built in: `document.fonts.ready`, `settleMs` before each screenshot (a popover mid fade-in gives a see-through shot), blur of the active element plus a click on a neutral spot (a Radix select restores focus after closing and leaves a blue ring), scroll containers reset to the top, and `formValues` applied before capture. Raise `settleMs` for slow animations.

### Publishing parity evidence (images to Linear, text to GitHub)

- **Policy** (`parity-publish.ts`): images go to Linear, GitHub stays text-only. Linear upload is allowed for `seeded` and `scrubbed` provenance after an explicit ask; `unknown` never leaves the machine. A GitHub comment carries image URLs only for `seeded` data with an approved uploader (`renderParityPrComment` has none). Every write still asks first.
- **Review gate:** before any upload, open every image in the plan (the Read tool shows PNGs) and compare it with its `expectation`. Reject mid-animation shots, focus rings and see-through popovers and re-capture. `parity-plan` stays blocked (exit 3) until the files are listed: `node dist/bin.js parity-plan <run-dir> --reviewed <file>,<file>`. The list is self-attested — nothing enforces that the images were really opened, so do it.
- **Helpers:** `buildPutCommand`, `selectStale`, `renderLinearComment` and `renderParityPrComment` are exported from `dist/parity-publish.js`; there is no subcommand for them. Import them from a short `node --input-type=module -e` call, or apply the same rules by hand.
- **Per image, one at a time** (the signed URL lives 60s): `mcp: linear/prepare_attachment_upload` (issue, filename, contentType `image/png`, exact size) → PUT the bytes with every returned header verbatim (`buildPutCommand` gives the argv; `curl --data-binary`) → `mcp: linear/create_attachment_from_upload` with `assetUrl`, the plan's `title` (`Pixel diff: <state> (Figma | implementation | diff)`) and `subtitle` (design node, build, viewport, diff %, known differences). Never pass `--app-build` a commit you did not verify; an unverified build prints as "unverified".
- **Replacing stale evidence:** list the issue's attachments (`get_issue`) before attaching, attach the new ones first, then show the user the IDs of earlier attachments whose title starts with `Pixel diff: ` (`selectStale`) and delete them (`mcp: linear/delete_attachment`) only after the user approves those IDs.
- **Optional summary:** one `mcp: linear/save_comment` built from `renderLinearComment` (regions, percentages, geometry, known differences).

## Step checks and selector repair

Every script step carries a machine-checkable `expectedState` (`text-visible`, `text-absent`, `testid-visible`, `testid-absent`, `url-path`, `input-value`) asserted after the action. `testid-absent` passes when no visible element has that test id; unlike the others it looks once, immediately, with no wait, so a leftover element (a drag ghost) right after the action fails the step. A step whose action works but whose expectation fails is `failed`. A step whose selector is broken (click/fill only) goes to `judge ui-element-repair` with the actual broken target; the judge's chosen index is validated against the currently visible DOM, the same action is executed on that candidate, and the expected state is re-checked — only then is the step `passed`. Two attempts max, then `broken`.

**Drag.** `{ "action": "drag", "target": "<source testid>", "to": "<destination testid>", "grabOffset"?: {x,y}, "dropOffset"?: {x,y}, "holdAlt"?: true, "expectedState": … }` drags with real mouse events (press, a 10px first move to clear dnd-kit's 6px PointerSensor activation, 12 steps to the drop point, a 150ms hover, release), so pointer-sensor libraries see a genuine drag. Offsets are pixels from each element's top-left (default: center); `holdAlt` holds Alt through the release. Each test id resolves to its first visible match; both elements must be on screen together (the source is scrolled into view). A missing source or destination is `broken` — drags get no selector repair. The step screenshot is taken straight after the check, so it shows the state right after the drop. Every drag counts as a write: a preview host (and `parity`) refuses it without `--allow-writes`.

**localStorage.** A script-level `"localStorage": { "<key>": "<value>" }` (strings, written verbatim) is set on the host origin by an init script before every page load, so the app sees it on its first render and after each navigation. Use it for feature-flag overrides and similar client toggles; it is part of the verdict-cache scenario key.

## Cost baseline

Each run writes `summary.json` with every model invocation (planning, selector-repair, visual-critique): elapsed time, and token counts that are `null` (unknown) unless the provider reported them. `scorer` renders per-phase and per-PR/route tables and prints `unknown`, never `0`. To link the planner's single call to its run, add `planning: { pr, model, elapsedMs, inputTokens?, outputTokens? }` to the script. See `docs/ui-evidence-cost.md` for the measurement protocol and status of the planner-model pilot.

## Configuration

Deployment-specific values are settings, never code. Each is read from, highest precedence first:

1. the environment;
2. a local, uncommitted env file: the one `UI_EVIDENCE_CONFIG` names, else `.ui-evidence.local.env` next to this SKILL.md (gitignored);
3. `deployment.env` next to this SKILL.md: a deployment's committed defaults. It is absent here; a fork that adapts the toolkit to one app commits its own (with a `deployment.md` for the conventions settings can't express), so syncing from upstream never conflicts.

The files are `NAME=value` lines (`#` comments, optional `export ` and quotes); they are parsed, never sourced. `doctor.sh` and `dist/bin.js` read them the same way. Unset settings fail closed.

- `UI_EVIDENCE_APP_TITLE` — the app's `<title>` text, used by `doctor.sh` to
  confirm `:3000` is this app and not a foreign process. Required; `doctor.sh`
  fails with a clear message if it's unset.
- `UI_EVIDENCE_PREVIEW_HOST_PATTERN` — a regex the whole hostname of a `--host`
  preview must match (see [Host override](#host-override-guard-rails)). Unset: no
  preview host is accepted.
- `UI_EVIDENCE_DB_CONTAINER` / `UI_EVIDENCE_DB_USER` — the Docker container running the
  local Postgres and its user (default `postgres`). `doctor.sh` runs `pg_isready` there,
  and the provenance query runs `psql` there. Unset: `doctor.sh` skips the database check.
- `UI_EVIDENCE_API_PORT` — a localhost port (an API server) `doctor.sh` must reach. Unset: skipped.
- `UI_EVIDENCE_SEED_TABLE` — the `[schema.]table` with an `email` column that
  `checkDbProvenance` reads. Unset: provenance is `unknown` (evidence stays local).
- `UI_EVIDENCE_SEED_DOMAINS` — comma-separated list of email domains that
  count as seed/synthetic data for `checkDbProvenance`. Default: `example.com`.
- `UI_EVIDENCE_SEED_EMAIL_PATTERN` — the SQL `LIKE` pattern used to find a
  seed marker row in the seed table. Default: a generic example.com pattern.
  Unconfigured, both defaults only match fictional example.com addresses, so
  provenance fails closed ("unknown") against any real database.
- `UI_EVIDENCE_USER_AGENT` — the browser's user agent. Default: desktop Chrome at the
  bundled Chromium's version, because headless Chromium's own UA says "HeadlessChrome"
  and apps that gate on browser support (an "unsupported browser" page) block it.
