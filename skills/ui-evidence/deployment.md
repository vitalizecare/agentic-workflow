# ui-evidence at Vitalize (web-app)

Vitalize's conventions for this skill. The settings themselves live in `deployment.env` next to this file;
this page covers what settings can't express.

- **App:** Vitalize's `web-app` (`~/vitalize/web-app`). The local stack serves web on `localhost:3000` and the
  api-server on `:5002`; Postgres runs in Docker as `postgres_container`.
- **Route map:** give `qa-runner` web-app's `verify-web-app` route map along with the PR diff.
- **Roles:** `manager`, `staff`, `central-staffer`, `super-admin`. Use these exact names in a script's `role`.
- **Login form:** web-app's sign-in is a two-step form (contact, then password), not the skill's one-step default.
  Give a script's or manifest's `login` the full selectors. `doppler` supplies the env vars:

  ```json
  {"emailEnv": "ADMIN_EMAIL", "passwordEnv": "ADMIN_PASSWORD",
   "emailSelector": "input[name=\"contact\"]", "nextSelector": "button[type=\"submit\"]",
   "passwordSelector": "input[name=\"password\"]", "submitSelector": "button[type=\"submit\"]"}
  ```

  The login inputs have no test ids, so never script them as `fill` steps (selector repair can't be relied on).
- **Credentials:** only from Doppler, never typed into a script. Run under
  `doppler run --project vitalize --config dev_preview -- …` for previews.
- **Previews:** `--host https://pr-<n>.vitalize.build --allow-preview-host`. A preview is a scrubbed customer extract
  (provenance `scrubbed`).
- **Browser gate:** web-app's `UnsupportedBrowserError` page allows only Chrome/Edge 139+ or Safari 17+. The default
  desktop-Chrome user agent already passes it; don't set `UI_EVIDENCE_USER_AGENT` to a headless one.
- **C# binary** (`src/Evidence`, not installed yet): it reads the environment only. Export the `deployment.env`
  values, for example `set -a; . skills/ui-evidence/deployment.env; set +a`, before calling it.

## Worktree stacks (web-app `scripts/worktree.sh` slots)

In a web-app git worktree, use that worktree's own slot stack, not `:3000`. `--host http://localhost:30N0` targets slot N.

The main checkout's stack owns `localhost:3000` and `:5002`. Evidence must come from the code under review, so when you work in a web-app git worktree, never drive `:3000` (the doctor passes there, but that is the main checkout's code). Give the worktree its own stack instead:

1. From the worktree: `bash scripts/worktree.sh claim` (writes the gitignored `.env.worktree` with `WORKTREE_SLOT=N`, the lowest free slot 1-15), then `bash scripts/worktree.sh prepare` (installs deps, creates, migrates and seeds database `wt_N` in the shared `postgres_container`, and prints that slot's seeded logins). `bash scripts/worktree.sh info` prints the ports.
2. Start the slot's stack from the worktree: `printf '\n' | nohup bun dev:local > /tmp/wt<N>-dev-local.log 2>&1 &` (the newline answers its "Press Enter" prompt). Slot N serves web on `localhost:3000+10N`, the API on `:5002+10N` and cluster runners from `8080+10N`. Keep the PID and kill only it when done; `bash scripts/worktree.sh release` drops the slot's database and frees it.
3. Run the doctor **from the worktree** (or set `UI_EVIDENCE_WORKTREE=<path>`). It reads `.env.worktree`, probes the slot's ports and database, refuses a slot whose ports are served from another checkout, and prints the `--host` and database to use.
4. Run the script with `--host http://localhost:3000+10N` (for example `--host http://localhost:3020`). A slot host is a **local** run: no `--allow-preview-host`, no write guard, the same as `:3000`. Only `http://localhost:<3000+10N>` for N 1-15 is accepted, as a bare origin; `127.0.0.1` is refused because the api-server CORS allowlist names `localhost`.
5. Check provenance against the slot's database: `docker exec postgres_container psql -U postgres -d wt_N …`, not `-d postgres`. Use the seeded logins `prepare` (and each `dev:local` start, which re-seeds the slot) prints, not ones from the main database.
