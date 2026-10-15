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
