# Evidence — `ui-evidence`

`Aw.Evidence` (`src/Evidence`, tier 2, full shape: `Core`, `Features`, `Infrastructure`, `Host`) drives a web app in a
headless browser and records what it saw: a scripted run's steps, screenshots, lint findings and visual verdict
(`summary.json`), and design parity against exported design frames (`parity.json`). The binary is `ui-evidence`
(`Aw.Evidence.Host`, framework-dependent). Until the switch the installed toolkit keeps running the TypeScript
`skills/ui-evidence`; nothing installs or calls this binary yet ("At the switch" below).

```bash
dotnet run --project src/Evidence/Aw.Evidence.Host -- <command> [arguments]
```

## Commands

Every command binds its arguments, calls one use case and maps the result to an exit code. Arguments are strict: an
unknown flag, a flag without its value (a value never starts with `--`), a repeated flag or the wrong number of
positionals is a usage error. Paths may be relative; the binary makes them absolute against the working directory, and
every path it writes into a run file is absolute.

| Command | Does | Exit |
|---|---|---|
| `run <script.json> <run-dir> [--baseline png] [--app-build sha] [--fixtures id] [--cache verdict-cache.json] [--host url] [--allow-preview-host] [--allow-writes] [--lock-timeout s]` | Once both locks are held, deletes `<run-dir>/summary.json`; runs every step of a UI script in each of its viewports, writes `summary.json` and prints it | 0 every step passed · 2 a step failed or broke · 1 · 4 · 75 |
| `parity <manifest.json> <run-dir> [--host url] [--allow-preview-host] [--allow-writes] [--app-build sha] [--db-provenance seeded\|unknown] [--lock-timeout s]` | Once both locks are held, deletes `<run-dir>/parity.json`; measures each design frame, writes `parity.json` and prints it; each failed box check is also a stderr line `ui-evidence: geometry: <frame> <target>: <failure>` | 0 every geometry check passed · 2 one failed · 1 · 4 · 75 |
| `parity-plan <run-dir> [--reviewed file,file]` | Prints the Linear attachment plan (one side-by-side image per frame) | 0 every image reviewed · 3 an image is unreviewed · 1 provenance unknown (AW-EVIDENCE-016: the evidence stays local) |
| `parity-comment <run-dir> --for linear\|github` | Prints the comment as markdown (Linear: a table with geometry; GitHub: a table, images stay on Linear) | 0 · 1 |
| `parity-stale --attachments <file.json> --keep id,id` | Prints the JSON array of `Pixel diff: ` attachments not kept, from a JSON array of `{id, title}` (other fields ignored) | 0 · 1 |
| `parity-put --upload <file.json> --file <png>` | Prints the JSON argv of the signed PUT (`curl … -H "<name>: <value>"` for every signed header, verbatim; run it within a minute of signing) from `{url, headers}` | 0 · 1 |
| `publish-plan <run-dir> --provenance seeded\|unknown [--linear-issue id]` | Prints the publish plan for `summary.json` (below) | 0 · 1 |
| `doctor` | Prints `{healthy, failures[]}` for the local stack; each failure is also a stderr line `ui-evidence: doctor: <failure>` | 0 healthy · 2 not · 1 usage |
| `provenance` | Prints `{provenance: seeded\|unknown, reason}` for the local database | 0 |
| `install-browser` | Installs the browser the run and parity commands drive; the installer's download progress goes to stderr, so stdout is only `{installed}`. Ctrl-C returns at once (a download already running finishes in Playwright's driver) | 0 · 4 |

`--lock-timeout` is whole seconds, 0 to 86400 (default 120; 0 tries once), and applies to each lock in turn, so exit 75 can come after up to twice the value; anything else is a usage error. A `--baseline` that doesn't exist is AW-EVIDENCE-010 (exit 1) before any lock is taken; one that exists but doesn't decode as a PNG leaves the verdict `unchecked` (never `unchanged`). `--host` takes a bare origin: `http://localhost:<port>`
or `http://127.0.0.1:<port>` (local: no extra flag), or an https preview host matching `UI_EVIDENCE_PREVIEW_HOST_PATTERN`
with `--allow-preview-host` (the host guard below). Without `--host` the binary drives `http://localhost:3000`.

### Exit codes

One scheme for every command:

| Exit | Meaning | Errors |
|---|---|---|
| 0 | Done; every check passed | — |
| 1 | Usage error, invalid input, or a guard refused | `ui-evidence: usage: ui-evidence <shape>`; AW-EVIDENCE-001…006, 010, 012, 016 |
| 2 | A check failed: a step failed or broke (`run`), a box check failed (`parity`), the stack is unhealthy (`doctor`) | the document is still written and printed |
| 3 | Blocked on review (`parity-plan`) | the plan is still printed |
| 4 | The run itself errored, or the environment's I/O failed: the browser failed to start or crashed, a frame's anchor is missing, a region runs past the viewport, a file couldn't be read or written (the script included), a lock directory couldn't be made | AW-EVIDENCE-011, 013, 015 (a stack probe failure, AW-EVIDENCE-014, is never an exit: `doctor` and `provenance` report it in their document) |
| 75 | A machine lock stayed busy past `--lock-timeout` | AW-EVIDENCE-009 |
| 130 | Interrupted (SIGINT, SIGTERM, SIGHUP, SIGQUIT): a browser call in flight is abandoned at once and the locks are released on the way out. A second signal terminates the process without waiting (a lock it held is then left for a person to remove) | `ui-evidence: interrupted` |

The mapping is by error kind: `timeout` → 75, `unavailable` → 4, anything else → 1. An unexpected exception (a bug,
or a failure outside a result) is `ui-evidence: AW-EVIDENCE-015 the run failed unexpectedly: <first line>` and exit 4,
never the runtime's crash exit.

### stdout and stderr

stdout carries exactly one JSON document, written through the Kernel `AwJson` profile (camelCase, UTC `O` timestamps,
nulls written), or markdown for `parity-comment`. stderr carries one-line messages prefixed `ui-evidence: `:
`ui-evidence: <code> <message>` for an error (an invalid script or manifest names the file, the JSON location and
the problem in the input's own terms: `ui-evidence: AW-EVIDENCE-002 script /work/script.json: $.steps[0]: missing
required property "expectedState"`; "Inputs" below), the `geometry:` and `doctor:` lines above, `ui-evidence: waiting on lock:
<dir>` (once, while a lock is busy), and the Kernel telemetry's JSON lines at `AW_LOG_LEVEL`. No message carries a
sign-in credential: a parity failure's text is scrubbed of the email and password before it leaves the use case.

## Inputs

`run` reads a UI script and `parity` reads a design manifest, both written by the planner (or by hand). Each is one
JSON object read through the package's `AwJson` options into the Core records (`UiScript`, `DesignManifest`); a key
marked required must be present and not null, an optional key may be left out (or `null` where the type says so), and
names are camelCase. A document that doesn't read, or breaks a rule below, is refused before any lock is taken:
AW-EVIDENCE-002 for a script, AW-EVIDENCE-003 for a manifest, exit 1. The message names the file, the JSON location
and the problem (`script <path>: $.steps[0]: missing required property "expectedState"`, `manifest <path>:
$.frames[0].zoom: unknown property`, `$.role: "intern" is not a valid value`, `$: not valid JSON (line 1, column 2)`);
a rule broken after reading is named by its place instead (`step 2: …`, `frame "empty-state": …`), and every broken
rule is listed, joined by `; `.

### Run script (`run <script.json>`)

| Key | Type | Required | Holds and rules |
|---|---|---|---|
| `route` | string | yes | the route under test; recorded in `summary.json` (the run navigates only through `goto` steps) |
| `role` | lower-case kebab-case string (the app's own role name, e.g. `admin`) | yes | the app role; recorded in `summary.json`, not interpreted |
| `viewports` | (`desktop` \| `phone`)[] | yes | at least one; every step runs in each (desktop 1280x800, phone 375x812) |
| `steps` | step[] | yes | at least one, run in order (below) |
| `planning` | object \| null | no | the planner's own model call, recorded as the first `invocations[]` entry: `pr` (string \| null, also `summary.json`'s `pr`), `model` (string \| null), `elapsedMs`, `inputTokens`, `outputTokens` (integer \| null each, not negative; null is unknown, never zero) |

A step:

| Key | Type | Required | Holds and rules |
|---|---|---|---|
| `action` | `goto` \| `click` \| `fill` \| `expect-visible` | yes | what the step does |
| `target` | string | yes | `goto`: a path on the host (one leading `/`; the host guard below); `click`, `fill`: a `data-testid`; `expect-visible`: visible text |
| `expectedState` | object | yes | the state that must hold after the action (below) |
| `value` | string \| null | no | the text a `fill` types; null or absent types nothing |

`expectedState` is one of five kinds, chosen by its `kind` key (anywhere in the object):

| `kind` | Other keys (all required) | Holds when |
|---|---|---|
| `text-visible` | `text` (string, not empty) | some visible element shows the text |
| `text-absent` | `text` (string, not empty) | no visible element shows the text |
| `testid-visible` | `testId` (string, not blank) | the element with that `data-testid` is visible |
| `url-path` | `path` (string, not empty) | the page's URL path is `path` |
| `input-value` | `testId` (string, not blank), `value` (string, may be empty) | that input holds exactly `value` |

A missing `kind` is `missing required property "kind"`; another value names the five kinds. Enum values are matched by
name only (a number is refused). Unknown keys are refused in every script object (the script, `planning`, each step
and each `expectedState`, whatever its kind and wherever `kind` sits): a misspelt key is one error naming the file, the
JSON location and the key (`script <path>: $.steps[0].vaule: unknown property`), never a silently ignored setting such
as a fill that types nothing. The script's SHA-256 is `summary.json`'s `scriptSha256`.

### Design manifest (`parity <manifest.json>`)

Unknown keys are refused in every manifest object (the manifest, `ready`, `viewport`, `neutralClick`, `login`, each
frame and its `designRegion`, `anchor`, `anchorOffset`, `waitFor`, `formValues[]` and `expectBoxes[]` with their
`target`, `relativeTo` and `expected`): a misspelt key is an error, not a silently ignored setting. A frame's `steps[]`
use the run script's step format above and are just as strict (`$.frames[0].steps[0].vaule: unknown property`).

| Key | Type | Required | Default | Holds and rules |
|---|---|---|---|---|
| `route` | string | yes | — | the route opened first; starts with `/` |
| `ready` | selector | yes | — | visible once the route has loaded (past any spinner) |
| `frames` | frame[] | yes | — | at least one; names unique (`duplicate frame name "<name>"`) |
| `viewport` | `{w, h}` (integers) | no | 1512x982 | the browser viewport; both positive |
| `timeoutMs` | integer | no | 60000 | the wait for `ready`, a frame's `waitFor` and its anchor, in ms; positive |
| `settleMs` | integer | no | 600 | the settle time before and after capture preparation, in ms; not negative |
| `threshold` | number | no | 0.1 | the per-pixel colour tolerance of the pixel diff; 0 to 1 |
| `includeAA` | boolean | no | false | count anti-aliased pixels as differences |
| `neutralClick` | `{x, y}` (numbers) | no | 22 px in from the viewport's bottom-right corner | where to click to drop focus before capture |
| `skipNeutralClick` | boolean | no | false | skip that click |
| `designNode` | string \| null | no | null | the design file or node every frame comes from; copied to `parity.json` |
| `login` | object \| null | no | null (no sign-in) | how to sign in first (below) |

A selector (`ready`, `anchor`, `waitFor`, a box's `target` and `relativeTo`) is `{testId}` or `{text}`, exactly one:
`testId` a `data-testid` (not blank), `text` visible text (not empty; the first visible match).

`login`:

| Key | Type | Required | Default | Holds and rules |
|---|---|---|---|---|
| `emailEnv`, `passwordEnv` | string | yes | — | the environment variables holding the credentials; UPPER_SNAKE (`^[A-Z][A-Z0-9_]*$`). The values come only from the environment, never the manifest |
| `emailSelector`, `passwordSelector`, `submitSelector` | string (CSS) | yes | — | the form's fields and submit control; not empty |
| `nextSelector` | string (CSS) \| null | no | null | clicked after the email on a two-step form |
| `loginPath` | string | no | `/login` | sign-in is done once the URL path no longer contains this |

A frame:

| Key | Type | Required | Default | Holds and rules |
|---|---|---|---|---|
| `name` | string | yes | — | letters, digits, `_` and `-`, starting with a letter or digit; names the frame's output files |
| `designPng` | string | yes | — | the design export (PNG at 1x); not empty. A relative path resolves against the manifest's directory, an absolute one is used as is |
| `designRegion` | `{x, y, w, h}` (integers) | yes | — | the compared region of the export; `x`, `y` ≥ 0, `w`, `h` > 0 |
| `anchor` | selector | yes | — | the element whose bounding-box origin locates the implementation crop |
| `anchorOffset` | `{x, y}` (numbers) \| null | no | no offset | added to the anchor's origin |
| `waitFor` | selector \| null | no | null | visible before the frame's steps run |
| `steps` | step[] | no | [] | steps that bring the page into this state (run script steps, same rules; the write guard applies on every host) |
| `formValues` | object[] | no | [] | values typed into the form (never submitted): `value` (string, required) and exactly one of `testId` (not blank) and `css` (not empty) |
| `expectBoxes` | object[] | no | [] | geometry checks: `target` (selector, required), `expected` (required: `{w, h, x, y}`, numbers, at least one set), `relativeTo` (selector: measure `x`, `y` from its top-left instead of the page's), `tolerance` (number ≥ 0 px per axis; absent is 0) |
| `knownDifferences` | string[] | no | [] | intentional differences that explain a non-zero diff; no empty entry |
| `designNode` | string \| null | no | null | the design node (id or URL) this frame was exported from |

## Run files

Scorer and bugfix-state read these files after their own ports; the fields they read are marked †.

### `summary.json` (`schema: "ui-evidence.run/1"`)

| Field | Type | Holds |
|---|---|---|
| `schema` | string | `ui-evidence.run/1` |
| `runId` | string | the run directory's name |
| `runInstance` | string | this invocation: a new UUID every time, so a rerun in the same directory has another |
| `startedAt`, `finishedAt` † | string (UTC `O`) | when the run started and ended |
| `route` | string | the script's route |
| `role` | string | the script's role |
| `host` | string | the origin driven |
| `appBuild` † | string \| null | `--app-build` (the commit under test, when verified) |
| `fixtures` | string \| null | `--fixtures` |
| `scriptSha256` † | string | SHA-256 (hex) of the script file's bytes as read: proves which script a run executed |
| `pr` | string \| null | the script's `planning.pr` |
| `viewports` | (`desktop` \| `phone`)[] | the script's viewports (1280x800, 375x812) |
| `steps[]` † | object[] | viewport by viewport, in order: `viewport`, `index` (1-based), `action` (`goto` \| `click` \| `fill` \| `expect-visible`), `target`, `status` † (`passed` \| `failed` \| `broken`), `screenshot` (`<run-dir>/<viewport>-<index>-<action>.png`) |
| `visual` | object | `verdict` † (`unchecked` \| `unchanged` \| `looks-right` \| `looks-off` \| `sloppy`), `reasons` (string[]), `diffScore` (number \| null: the fraction of pixels differing from the baseline, 1 for a size change), `diffImage` (string \| null: `<run-dir>/visual-diff.png`) |
| `lintFindings[]` | object[] | `viewport`, `rule` (`overlap` \| `misaligned-edge` \| `phone-overflow` \| `truncated-label` \| `clipped` \| `missing-hover-focus` \| `unresolved-placeholder` \| `non-token-color`), `selector`, `detail` |
| `invocations[]` † | object[] | every model call actually made, in order (none when no judge is wired: "Judge" below): `phase` (`planning` \| `selector-repair` \| `visual-critique`), `model` (string \| null), `elapsedMs` (number \| null), `ok` (false: the judge was called and failed or answered nothing), `inputTokens`, `outputTokens` (number \| null: null is unknown, never zero), `cacheHit` (a verdict-cache hit stands in for a critique) |
| `planning` | object \| null | the script's planning block: `pr`, `model`, `elapsedMs`, `inputTokens`, `outputTokens` |
| `evidence` | object | `traces` (string[]: `<run-dir>/<viewport>-trace.zip`), `videos` (string[]) |

A step's `status`: `passed` (the action ran and the expected state held), `failed` (the action ran, the expected state
didn't hold: a behaviour failure, never repaired; also a repaired action that ran but missed the expectation, which is
never repaired again), `broken` (the action itself failed and no repair made it run). Every
step runs whatever an earlier one did. The visual verdict comes from the last passed step's screenshot: no pixel
differing from `--baseline` beyond the diff tolerance (threshold 0.1, anti-aliased pixels ignored) is `unchanged` with no model (never for a run with a failed step); otherwise the verdict cache
(`--cache`, default `<run-dir>/verdict-cache.json`; keyed on the pixels' and baseline's hashes, the prompt version,
`AW_VISUAL_MODEL`, the app build, the script's scenario hash, fixtures, viewports and the browser build; an entry without
an app build is trusted only inside the run invocation that wrote it, its `runInstance`, so a rerun in the same directory
never reuses it), then one critique of the changed region. No passed step, no
judge wired, or no answer from the judge, is `unchecked`.

### `parity.json` (`schema: "ui-evidence.parity/1"`)

| Field | Type | Holds |
|---|---|---|
| `schema` | string | `ui-evidence.parity/1` |
| `runId` | string | the run directory's name |
| `host` | string | the origin driven |
| `provenance` | `seeded` \| `scrubbed` \| `unknown` | a preview host is `scrubbed` (or `unknown` when `--db-provenance unknown`); a local host is `seeded` only with `--db-provenance seeded` |
| `appBuild`, `designNode` | string \| null | `--app-build`; the manifest's design node |
| `viewport` | `{w, h}` | the manifest's viewport |
| `frames[]` | object[] | one per manifest frame, in order (below) |

Each frame: `name`, `designRegion` `{x, y, w, h}` (in the design export), `implementationOrigin` `{x, y}` (where the
same-size region starts on the page: the anchor plus `anchorOffset`), `anchorBox` `{x, y, w, h}`, `anchorOffset` `{x, y}`,
`sizeDelta` `{w, h}` (anchor size minus design region size), `diffPixels`, `total`, `diffPercent` (two decimals),
`threshold`, `includeAA`, `boxChecks[]` (`target`, `relativeTo`, `expected` `{w, h, x, y}`, `actual` (or null when an
element is missing), `tolerance`, `pass`, `failure`), `knownDifferences[]`, `files` (`design`, `implementation`, `diff`,
`sideBySide`: `<run-dir>/<frame>-{design,implementation,diff,side-by-side}.png`), `designNode`.

A relative `designPng` in the manifest resolves against the manifest's directory. `parity.json` is deleted before the
run, so a failed run never leaves an earlier summary for `parity-plan` to publish. `run` does the same with
`summary.json`: once the locks are held, an earlier `summary.json` in the run directory is deleted, so exit 4 leaves none.

### `publish-plan` output

`provenance` (`seeded` \| `unknown`: the claim, downgraded to `unknown` for any host that isn't local), `question` (the
ask-first question; it states what will happen: a Linear upload only when seeded with an issue given, otherwise why
there is none), `linearUploadAllowed` (seeded and an issue given), `files` (the step screenshots), `note`, and
`prComment` (the markdown body).

## Locks

`run` and `parity` hold two box-wide locks for the whole browser run, through Evidence's own Core port
`IMachineLocks` (`AcquireAsync(LockKind, timeout) → Result<ILockLease>`), in a fixed order: the QA-stack lock (the wider
one) first, then the heavy-job lock; failing to take the second releases the first. A guard refusal or a bad input is
reported before any lock is taken. The leases are released on every path: success, failure, exception and
interruption.

The adapter (`DirectoryLocks`) is the same lock the shell tools take, so the two exclude each other both ways:

| | |
|---|---|
| QA-stack lock | `$AW_QA_STACK_LOCK`, else `${AW_STATE_DIR:-~/.agentic-workflow}/locks/qa-stack.lock` |
| Heavy-job lock | `$AW_HEAVY_JOB_LOCK`, else `${AW_STATE_DIR:-~/.agentic-workflow}/locks/heavy-job.lock`: slot 1. Slot k (2 … `$AW_HEAVY_SLOTS`) is `<lock>.k` |
| Path form | A configured path is made absolute (against the working directory) and loses any trailing separators, so `/x/qa.lock//` is the lock `/x/qa.lock` |
| Heavy-job slots | `$AW_HEAVY_SLOTS`, default 2: at most that many heavy jobs at once, the same count the `heavy` wrapper uses. A value that isn't a whole number of at least 1 isn't refused: the lock uses 2 and says once on stderr `ui-evidence: AW_HEAVY_SLOTS='<value>' isn't a whole number of at least 1; using 2 slots` |
| Acquire | an atomic `mkdir` of a slot directory (libc `mkdir`; `EEXIST` means that slot is busy). Each poll tries slot 1, then 2 … N, the wrapper's order, so a holder that knows only `<lock>` (sindri's lock, a plain `acquire_lock` caller) occupies slot 1 and the total never exceeds the slot count. Polled every second until the timeout; `ui-evidence: waiting on lock: <lock>` once. The QA-stack lock has one slot |
| Owner | `<slot>/owner`: `<pid> <UTC time> ui-evidence`, the file the `heavy` wrapper writes too |
| Release | delete our `owner`, then `rmdir` the slot we hold; a directory something else wrote into, or whose `owner` line names another process (ours was removed by hand and another holder took the slot), is left alone |
| `AW_HEAVY_LOCK_HELD=1` | set by the `heavy` wrapper: the parent already holds a heavy-job slot, so that lease is a no-op (it takes no second slot) |
| Stale locks | never taken over (the shell primitive doesn't either); remove a dead holder's directory by hand |

The `heavy` wrapper is the owner's machine script (`~/.agentic-workflow/bin-r1b/heavy`, outside this repo); its slot
layout and owner line are the ones above. `config/lib/locks.sh` (`acquire_lock` / `release_lock`) is the in-repo shell
side of the same format; the integration tests
source it to prove the exclusion in both directions, and that a C# holder takes `<lock>.2` while bash holds `<lock>`.

## Judge

Selector repair and visual critique go through the Core port `IJudge` (`IsAvailable`, `RepairSelectorAsync`,
`CritiqueAsync`). `IsAvailable` says whether a judge is wired at all; callers check it first, and with no judge they
don't call it and record nothing in `invocations[]`, because no model ran. A wired judge's null answer means the call
failed (timed out, errored or answered out of contract); that call is recorded with `ok: false`. Either way every caller
fails closed: no repair (the step stays `broken`), and the verdict stays `unchecked`. A recorded call carries null
token counts when the answer reports none. Until `docs/csharp/judge.md` lands, the composition registers
`UnavailableJudge` (`IsAvailable` false, every answer null; it logs once that it isn't wired), so a run records no
`selector-repair` or `visual-critique` invocation; the CLI adapter over the C# `judge` binary is BLOCKED on that
contract.

## Host guard

| Host | Accepted as | Write guard |
|---|---|---|
| none | `http://localhost:3000` (local) | none |
| `http://localhost:<port>`, `http://127.0.0.1:<port>` (bare origin) | local | none |
| `https://<host>` (bare origin) whose whole hostname matches `UI_EVIDENCE_PREVIEW_HOST_PATTERN`, with `--allow-preview-host` | preview | write-looking steps refused without `--allow-writes` |
| anything else (dev, staging, prod, a path, a query, credentials in the URL; every non-loopback host when no pattern is configured, or the pattern doesn't compile) | refused, AW-EVIDENCE-004 | — |

Every `goto` target must be a path on the host (one leading `/`); a step that leaves the host is refused
(AW-EVIDENCE-005), and the browser aborts any off-origin navigation it is asked to make. Playwright never routes a
redirect hop, though, so a server's `3xx` (or a canonical-host or auth redirect) can still take the page elsewhere. The
session therefore also watches where the page actually is: every main-frame navigation, and the page's URL before and
after each browser call. Once the page has been off the vetted origin, that call and every later one in the session
fail with `AW-EVIDENCE-013 <call>: the page left <vetted origin> for <other origin> …`, so `run` and `parity` end with
exit 4 and write no `summary.json` / `parity.json`. In `run` that message is the one reported; `parity` reports every
run failure as AW-EVIDENCE-015, naming the origin when the page left during sign-in or route opening, and naming the
frame and its step (`step N … broken`) when it left during a frame step. Sign-in checks again after loading the host and right before it
types each credential, so a credential is never typed into a page off the vetted origin. A write-looking step is a click (or a `goto`) whose
target has a write verb (`save`, `submit`, `delete`, …, including fused control names such as `saveBtn`). Selector
repair is held to the same guard: where writes are refused, a candidate the judge picks whose test id, accessible name
or text reads like a write is never clicked or filled (it counts as no candidate, so the step stays `broken`). `parity`
applies the write guard on every host, local included, to its manifest `route` (vetted as the first `goto`) and every
frame step. Sign-in credentials come only from the environment variables
the manifest's `login` names (AW-EVIDENCE-006 lists the missing names, never values).

## Environment

These are read by Infrastructure's `EnvironmentEvidenceSettings` and lock settings; the use cases see only the typed
`IEvidenceSettings` port, never a variable name. Blank counts as unset.

| Variable | Read by |
|---|---|
| `UI_EVIDENCE_USER_AGENT` | `run`, `parity`: the user agent to present instead of desktop Chrome at the browser's build |
| `AW_VISUAL_MODEL` | `run`: the model label in the verdict-cache key (default `judge-default`) |
| `UI_EVIDENCE_APP_TITLE`, `UI_EVIDENCE_CONFIG` | `doctor`: the title the app on :3000 must show at `/login`; else the `NAME=value` env file `UI_EVIDENCE_CONFIG` names (an `export ` prefix and quotes are allowed). Neither set (or an unreadable file) is itself a doctor failure: `the app title is not set: set …` |
| `UI_EVIDENCE_PREVIEW_HOST_PATTERN` | `run`, `parity`: the regex a preview `--host`'s whole hostname must match (e.g. `pr-[0-9]+\.preview\.example\.com`; write it so dev, staging and prod never match). Unset: every non-loopback host is refused |
| `UI_EVIDENCE_API_PORT` | `doctor`: a localhost port (an API server) that must accept connections, 1-65535. Unset: not checked |
| `UI_EVIDENCE_DB_CONTAINER`, `UI_EVIDENCE_DB_USER` | `doctor`, `provenance`: the Docker container running the local Postgres and its user (default `postgres`). No container: `doctor` skips the database and `provenance` is `unknown` |
| `UI_EVIDENCE_SEED_TABLE` | `provenance`: the `[schema.]table` whose `email` column is read (a plain identifier only, since it is spliced into the SQL; anything else counts as unset). Unset: `unknown` |
| `UI_EVIDENCE_SEED_DOMAINS`, `UI_EVIDENCE_SEED_EMAIL_PATTERN` | `provenance`: the seed policy (defaults match only `example.com`, so an unconfigured install stays `unknown`) |
| `AW_QA_STACK_LOCK`, `AW_HEAVY_JOB_LOCK`, `AW_HEAVY_SLOTS`, `AW_HEAVY_LOCK_HELD`, `AW_STATE_DIR` | the lock adapter |
| the manifest's `login.emailEnv` / `login.passwordEnv` | `parity` sign-in |

`doctor` checks `http://localhost:3000/login`'s title, `docker exec <container> pg_isready -U <user>` when a container is
configured, and a TCP connect to `localhost:<UI_EVIDENCE_API_PORT>` when a port is. `provenance` runs
`docker exec <container> psql` against the seed table with the seed pattern passed as a psql variable, never
interpolated into the SQL; a failed query (or no container or table configured) is `unknown` with the reason. A row
with a NULL email reads as an empty email (not on a seed domain), so it makes the data `unknown` rather than being
skipped. The TypeScript skill also reads these from a committed `deployment.env` next to its SKILL.md; the binary
reads the environment only until the switch.

## AOT scope

The Host is framework-dependent, not an AOT entry point: Playwright for .NET has no NativeAOT or trimming support.
`Aw.Evidence.Infrastructure` opts out of AOT analysis (`AwAotCompatible=false`) for the same reason. `Core` and
`Features` stay AOT-compatible (no reflection; JSON through the package's source-generated context), so they could
move behind an AOT host if the browser adapter ever allowed it.

## Ports and adapters

| Port (Core) | Adapter (Infrastructure) | Fake (Testing) |
|---|---|---|
| `IBrowser`, `IBrowserSession` | `PlaywrightBrowser` (headless Chromium) | `FakeBrowser`, `FakeBrowserSession`, `FakePage` |
| `IBrowserInstaller` | the Playwright installer (`install chromium`) | `FakeBrowserInstaller` |
| `IRunFiles` | `FileRunFiles` | `InMemoryRunFiles` |
| `IImageCodec` | `PngCodec` | `FakeImageCodec` |
| `IVerdictCacheStore` | `FileVerdictCacheStore` | `InMemoryVerdictCacheStore` |
| `IMachineLocks` | `DirectoryLocks` | `InMemoryMachineLocks` |
| `IJudge` | `UnavailableJudge` (CLI adapter blocked, above) | `FakeJudge` |
| `IStackProbe`, `IProvenanceQuery` | `ProcessStackProbe`, `DockerPsqlProvenance` | `FakeStackProbe`, `FakeProvenanceQuery` |
| `ISecretsSource` (credentials by the name the manifest gives) | `EnvironmentSecrets` | `FakeSecrets` |
| `IEvidenceSettings` (user agent, visual model, preview host pattern, API port, seed policy, app title) | `EnvironmentEvidenceSettings` | `FakeEvidenceSettings` |
| `IIdGenerator` (Kernel; the run instance) | `RandomIds` | `SequentialIds` |

Each port with behaviour to pin has a contract suite in `tests/Aw.Evidence.Testing` that the fake and the adapter both
run: `BrowserSessionContract` (fake: unit; Playwright on the fixture site: heavy), `BrowserInstallerContract` (fake: unit;
Playwright: heavy), `RunFilesContract`, `ImageCodecContract`, `VerdictCacheStoreContract`, `MachineLocksContract`,
`JudgeContract`, `StackProbeContract` (the adapter over a local HTTP server, a stub `docker` and a loopback listener),
`ProvenanceQueryContract` (the adapter over a stub `docker` playing `psql -At`), `SecretsSourceContract` and
`IdGeneratorContract`. `IEvidenceSettings` has none: its fake is a set of plain values with no behaviour that could
drift; the adapter's names, defaults, blank-as-unset and env-file fallback are pinned by `EnvironmentEvidenceSettingsTests`.

## At the switch

What changes for the callers when the install moves to the C# build:

- **Run directories.** `run` and `parity` write wherever `<run-dir>` points; Evidence keeps no state directory of its
  own. Scorer finds runs by enumerating `${AW_STATE_DIR:-~/.agentic-workflow}/ui-evidence/runs/*/summary.json` (the
  Evidence `files` edge in `deps.yaml`), so a caller that wants a run counted passes
  `<run-dir>` = `$AW_STATE_DIR/ui-evidence/runs/<id>`, a new `<id>` per run. A caller that wants verdict-cache hits across
  runs passes a stable `--cache` together with `--app-build <sha>` (the default cache lives in the run directory, so it
  never hits across runs, and an entry written without an app build is trusted only by the invocation that wrote it).
- **SKILL.md** (`skills/ui-evidence`): `with_stack_lock_and_heavy_job_lock 120 node dist/bin.js <script> <run-dir> …`
  becomes `ui-evidence run <script> <run-dir> … [--lock-timeout 120]`. The binary takes both locks itself, so the bash
  wrapper goes. The parity, plan, comment, stale, put and publish steps call `ui-evidence parity …`,
  `ui-evidence parity-plan …` and so on; `scripts/doctor.sh` becomes `ui-evidence doctor` (unhealthy is exit 2); the
  provenance probe becomes `ui-evidence provenance`; `npx playwright install chromium` becomes `ui-evidence
  install-browser`.
- **bugfix-state** (`run-ui`): drops the `process.execPath, deps.uiEvidenceBin` argv (`deps.ts` `siblingUiEvidence`)
  and runs `ui-evidence run <script> <run-dir> --app-build <sha>` with a new `<run-dir>` per run; reads `summary.json`
  per the field changes below (`steps[].status`, `appBuild`, `scriptSha256`: its `UiSummarySchema` already accepts all
  three as written); treats exit 75 as "stack busy, try again" rather than a failed check; and its "wrote no summary"
  refusal now covers exit 4 and 75 as well as a crash. That refusal relies on the fresh directory: `run` deletes an
  earlier `summary.json` only once both locks are held, so a reused directory can still hold the previous run's file
  after exit 1, exit 75, or an exit 4 raised before the locks (the script unreadable, a lock directory that can't be made).
- **Scorer** (`scorer/src/ui-evidence-runs.ts`, `RunSummarySchema`): the C# summary is a new schema, and every changed
  field must move with the port, or `safeParse` fails and Scorer silently skips every C# run. The table below is the
  whole difference between what the readers' schemas expect today and what `ui-evidence run` writes.

Every key in `summary.json` is always written; a value that is unknown or wasn't given is `null`, never a missing key,
so a reader that accepts "missing" (`.optional()`) must also accept `null` (`.nullable()`) wherever the type says
`| null`. Pinned by `RunSummaryShapeTests` (a full and a minimal summary: the keys, their order, and which are null).

| Field | Today's readers expect | C# writes | Reader change |
|---|---|---|---|
| `ts` | string, required (Scorer) | gone: `startedAt` and `finishedAt`, UTC `O` with seven fractional digits (`2026-10-10T12:00:00.0000000Z`) | Scorer reads `finishedAt` (parse it, don't compare strings) |
| `steps[].name` | string, required (Scorer) | gone: a step is `viewport`, `index`, `action`, `target`, `status`, `screenshot` | Scorer drops `name` |
| `steps[].status`, `steps[].screenshot` | as written | unchanged | none |
| `visual` | `unchecked` \| `unchanged` \| `looks-right` \| `looks-off` \| `sloppy` (Scorer) | an object: `verdict` (those five), `reasons`, `diffScore` (number \| null), `diffImage` (string \| null) | Scorer reads `visual.verdict` |
| `visualReasons` | string[], required (Scorer) | gone: `visual.reasons` | Scorer reads `visual.reasons` |
| `diffScore` (top level) | not read | gone: `visual.diffScore` | none |
| `pr` | string, optional (Scorer: `z.string().optional()`) | string \| null, always written (`null` when the script has no `planning.pr`) | Scorer: `z.string().nullable()`; without it every run whose script has no `planning.pr` is skipped |
| `route` | string, optional (Scorer) | string, always written | none |
| `appBuild` | string \| null, optional (bugfix-state) | string \| null, always written | none |
| `scriptSha256` | string \| null, optional (bugfix-state) | string, always written (never null) | none; bugfix-state's "no check hash" refusal can no longer fire |
| `lintFindings[]` | `rule`, `selector`, `detail` (Scorer) | adds `viewport`; `rule` is one of the eight names in the table above | none (a non-strict object ignores `viewport`) |
| `invocations[]` | optional array; `phase`, `ok`, `elapsedMs`, `inputTokens`, `outputTokens` (number \| null), `cacheHit` optional (Scorer) | always written (`[]` when no model ran); adds `model` (string \| null); `cacheHit` always written | none required; Scorer may drop `.optional()` |
| `planning` | not read | object \| null; inside, `pr` and `model` are string \| null, `elapsedMs`, `inputTokens`, `outputTokens` number \| null | a reader that adds it must accept `null` |
| `fixtures` | not read | string \| null | as `planning` |
| `schema`, `runId`, `runInstance`, `host`, `viewports`, `evidence` | not read | new, always written | none (ignored by a non-strict object) |

- Exit 4 (the run errored) and 75 (a lock stayed busy) are new; a caller that only knew 0, 1 and 2 must treat both as
  "no evidence", never as a pass.
