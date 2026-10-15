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
#
# Worktree mode (web-app): run from inside a web-app git worktree that has
# claimed a slot (`bash scripts/worktree.sh claim`, which writes
# `.env.worktree` with WORKTREE_SLOT=N), or set UI_EVIDENCE_WORKTREE=<worktree
# path>. The checks then target that slot's stack: web localhost:3000+10N, the
# API port +10N, database wt_N in the configured container, and those ports
# must be served from that worktree (a slot owned by another checkout is
# foreign). On success it prints the --host to pass to the runner and the
# database to check.
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

WORKTREE="${UI_EVIDENCE_WORKTREE:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
SLOT=0
if [ -n "$WORKTREE" ] && [ -f "$WORKTREE/.env.worktree" ]; then
  SLOT="$(sed -n 's/^WORKTREE_SLOT=\([0-9][0-9]*\)$/\1/p' "$WORKTREE/.env.worktree")"
  if [ -z "$SLOT" ] || [ "$SLOT" -lt 1 ] || [ "$SLOT" -gt 15 ]; then
    printf 'ui-evidence doctor: %s/.env.worktree has no WORKTREE_SLOT between 1 and 15\n' "$WORKTREE"
    exit 1
  fi
elif [ -n "${UI_EVIDENCE_WORKTREE:-}" ]; then
  printf 'ui-evidence doctor: UI_EVIDENCE_WORKTREE=%s has no .env.worktree — run `bash scripts/worktree.sh claim` there first\n' "$UI_EVIDENCE_WORKTREE"
  exit 1
fi
WEB_PORT=$((3000 + SLOT * 10))
API_PORT=""
[ -n "${UI_EVIDENCE_API_PORT:-}" ] && API_PORT=$((UI_EVIDENCE_API_PORT + SLOT * 10))
DB_CONTAINER="${UI_EVIDENCE_DB_CONTAINER:-}"
DB_USER="${UI_EVIDENCE_DB_USER:-postgres}"
if [ "$SLOT" -eq 0 ]; then DATABASE="postgres"; else DATABASE="wt_${SLOT}"; fi

LOGIN_HTML="$(curl -s --max-time 5 "http://localhost:${WEB_PORT}/login" 2>/dev/null || true)"
if ! printf '%s' "$LOGIN_HTML" | grep -q "<title>${UI_EVIDENCE_APP_TITLE}</title>"; then
  FAILS+=(":${WEB_PORT} does not look like this app (foreign process, or stack not up) — refusing to double-drive it")
fi

if [ -n "$DB_CONTAINER" ]; then
  if ! docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" > /dev/null 2>&1; then
    FAILS+=("postgres in container $DB_CONTAINER is not ready")
  elif [ "$SLOT" -ne 0 ] && [ "$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DATABASE}'" 2>/dev/null)" != "1" ]; then
    FAILS+=("database ${DATABASE} does not exist — run \`bash scripts/worktree.sh prepare\` in ${WORKTREE}")
  fi
fi

if [ -n "$API_PORT" ]; then
  if ! nc -z localhost "$API_PORT" 2>/dev/null; then
    FAILS+=("api-server (:$API_PORT) is not accepting connections")
  fi
fi

# A slot's ports must be served from that worktree, so evidence shows its code.
if [ "$SLOT" -ne 0 ]; then
  for port in "$WEB_PORT" $API_PORT; do
    pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
    [ -z "$pid" ] && continue
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    case "$cwd" in
      "$WORKTREE"|"$WORKTREE"/*) ;;
      *) FAILS+=(":${port} is served from ${cwd:-an unknown directory}, not ${WORKTREE} — foreign stack, refusing to drive it") ;;
    esac
  done
fi

if [ "${#FAILS[@]}" -gt 0 ]; then
  printf 'ui-evidence doctor: NOT healthy\n'
  for f in "${FAILS[@]}"; do printf ' - %s\n' "$f"; done
  exit 1
fi
if [ "$SLOT" -eq 0 ]; then
  echo "ui-evidence doctor: healthy"
else
  echo "ui-evidence doctor: healthy (worktree slot ${SLOT}: ${WORKTREE})"
  echo "  runner:    --host http://localhost:${WEB_PORT}"
  shown_container="$DB_CONTAINER"
  [ -n "$shown_container" ] || shown_container="<container>"
  echo "  database:  ${DATABASE} (docker exec ${shown_container} psql -U ${DB_USER} -d ${DATABASE})"
fi
exit 0
