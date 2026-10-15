#!/usr/bin/env bash
# skills/ui-evidence/scripts/doctor.sh — read-only health check of the local
# stack. Exits 0 only when the app is healthy and reachable at localhost:3000
# and owned by this convention's app (never "start a second stack" against a
# foreign process on :3000 — RF-1).
#
# Everything deployment-specific comes from config, never a hardcoded value
# (see SKILL.md's "Configuration" section). Precedence, highest first: the
# environment; the local, uncommitted env file (UI_EVIDENCE_CONFIG, else
# .ui-evidence.local.env next to SKILL.md); a committed deployment.env next to
# SKILL.md. The runner (src/settings-files.ts) reads the same files the same way.
#   UI_EVIDENCE_APP_TITLE     required: the <title> :3000/login must show
#   UI_EVIDENCE_DB_CONTAINER  optional: the Postgres container to pg_isready
#   UI_EVIDENCE_DB_USER       optional: its user (default postgres)
#   UI_EVIDENCE_API_PORT      optional: a localhost port that must accept connections
set -uo pipefail
FAILS=()
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$DIR/.."
LOCAL_CONFIG="${UI_EVIDENCE_CONFIG:-$SKILL_DIR/.ui-evidence.local.env}"
DEPLOYMENT_CONFIG="$SKILL_DIR/deployment.env"

# NAME=value lines (blank lines, # comments and an optional `export ` are
# allowed; one layer of matching quotes is stripped). Fills only variables
# that are unset or blank, so the environment and earlier files win. The file
# is parsed, never sourced.
fill_unset_from() {
  local file="$1" line name value current
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in ''|'#'*) continue ;; esac
    line="${line#export }"
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    name="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value%"${value##*[![:space:]]}"}"
    if [ "${#value}" -ge 2 ] && { [[ "$value" == \"*\" ]] || [[ "$value" == \'*\' ]]; }; then
      value="${value:1:${#value}-2}"
    fi
    current="${!name-}"
    if [ -z "${current//[[:space:]]/}" ]; then
      export "$name=$value"
    fi
  done < "$file"
}
fill_unset_from "$LOCAL_CONFIG"
fill_unset_from "$DEPLOYMENT_CONFIG"

if [ -z "${UI_EVIDENCE_APP_TITLE:-}" ]; then
  printf 'ui-evidence doctor: UI_EVIDENCE_APP_TITLE is not set — set it in the environment, in %s, or in %s (see SKILL.md)\n' "$LOCAL_CONFIG" "$DEPLOYMENT_CONFIG"
  exit 1
fi

LOGIN_HTML="$(curl -s --max-time 5 http://localhost:3000/login 2>/dev/null || true)"
if ! printf '%s' "$LOGIN_HTML" | grep -q "<title>${UI_EVIDENCE_APP_TITLE}</title>"; then
  FAILS+=(":3000 does not look like this app (foreign process, or stack not up) — refusing to double-drive it")
fi

if [ -n "${UI_EVIDENCE_DB_CONTAINER:-}" ]; then
  if ! docker exec "$UI_EVIDENCE_DB_CONTAINER" pg_isready -U "${UI_EVIDENCE_DB_USER:-postgres}" > /dev/null 2>&1; then
    FAILS+=("postgres in container $UI_EVIDENCE_DB_CONTAINER is not ready")
  fi
fi

if [ -n "${UI_EVIDENCE_API_PORT:-}" ]; then
  if ! nc -z localhost "$UI_EVIDENCE_API_PORT" 2>/dev/null; then
    FAILS+=("api-server (:$UI_EVIDENCE_API_PORT) is not accepting connections")
  fi
fi

if [ "${#FAILS[@]}" -gt 0 ]; then
  printf 'ui-evidence doctor: NOT healthy\n'
  for f in "${FAILS[@]}"; do printf ' - %s\n' "$f"; done
  exit 1
fi
echo "ui-evidence doctor: healthy"
exit 0
