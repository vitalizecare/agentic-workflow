#!/usr/bin/env bash
# Optional local session-history add-on. Requires Beacon + beacon-otelcol on PATH.
# Usage: scripts/install-beacon.sh [--providers claude,codex,cursor] [--dry-run]
# Defaults to detected providers. Does not install the upstream binary or cloud services.
set -euo pipefail
TOOLKIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$TOOLKIT_DIR/providers/lib.sh"
for provider in claude codex cursor; do source "$TOOLKIT_DIR/providers/$provider/install.sh"; done
selection=""
while [ $# -gt 0 ]; do
  case "$1" in
    --providers) selection="${2:?--providers requires a value}"; shift 2 ;;
    --dry-run) AW_DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
if [ -z "$selection" ]; then
  for provider in claude codex cursor; do
    if "${provider}_detect"; then selection="${selection:+$selection,}$provider"; fi
  done
fi
[ -n "$selection" ] || { echo 'No providers detected; use --providers.' >&2; exit 1; }
providers=()
IFS=',' read -r -a providers <<< "$selection"
for provider in "${providers[@]}"; do
  case "$provider" in
    claude|codex|cursor) ;;
    *) echo "Unknown provider: $provider" >&2; exit 1 ;;
  esac
  if ! aw_dry && [ "$provider" != cursor ] && ! command -v "$provider" >/dev/null; then
    echo "Missing provider CLI: $provider" >&2; exit 1
  fi
done
command -v jq >/dev/null || { echo 'jq is required.' >&2; exit 1; }
beacon_bin="$(command -v beacon || true)"
if [ -z "$beacon_bin" ]; then
  if aw_dry; then beacon_bin=beacon
  else echo 'Install Beacon first (docs/beacon.md), then rerun this script.' >&2; exit 1
  fi
fi
# Refuse to relabel an existing forwarding install as local. Do not print its secrets.
config="$HOME/.beacon/endpoint/config.json"
if [ -e "$config" ] && ! jq -e '
  type == "object" and (.managed_ingest.enabled != true) and
  ((.destinations // {}) | all(.[];
    .enabled != true and (.endpoint // "") == "" and (.token // "") == ""))
' "$config" >/dev/null 2>&1; then
  echo 'Beacon config is invalid or enables forwarding; resolve it in Beacon before using this local installer.' >&2
  exit 1
fi
# The Cursor adapter intentionally tolerates invalid JSON; this opt-in must instead
# fail before starting a collector when it cannot register the requested MCP server.
if [[ ",$selection," == *,cursor,* ]] && [ -e "$CURSOR_DIR/mcp.json" ]; then
  jq -e 'type == "object" and ((.mcpServers // {}) | type == "object")' \
    "$CURSOR_DIR/mcp.json" >/dev/null || { echo 'Invalid Cursor MCP config.' >&2; exit 1; }
fi
echo "Beacon: local session capture for $selection (no historical backfill)."
aw_run env BEACON_ONBOARDING=0 BEACON_MANAGED_INGEST=0 \
  "$beacon_bin" endpoint install --user --harness "$selection" --no-backfill </dev/null
# endpoint install treats hook failures as warnings. This idempotent command
# propagates them, so a selected harness cannot silently miss capture hooks.
aw_run env BEACON_ONBOARDING=0 BEACON_MANAGED_INGEST=0 \
  "$beacon_bin" endpoint hooks install --user --harness "$selection" --level user </dev/null

# A dedicated name avoids colliding with an independently installed Beacon server.
# Never inherit setup.sh's retired-server list into this additive registration.
AW_MCP_RETIRED=""
AW_MCP_SERVERS="$(jq -nc --arg binary "$beacon_bin" \
  '[{name:"aw-beacon",command:$binary,args:["mcp","serve","--user","--transport","stdio"]}]')"
aw_mcp_unpack "$(printf '%s' "$AW_MCP_SERVERS" | jq -c '.[0]')"
for provider in "${providers[@]}"; do
  if [ "$provider" = cursor ]; then
    cursor_register_mcp
  elif "${provider}_mcp_present" aw-beacon </dev/null; then
    echo "aw-beacon: already registered in $provider"
  else
    "${provider}_mcp_add" </dev/null
  fi
done
echo 'Restart agent sessions to load aw-beacon; review new hooks in Codex /hooks.'
echo 'Inspect locally: beacon endpoint status; beacon mcp doctor; beacon endpoint dashboard'
