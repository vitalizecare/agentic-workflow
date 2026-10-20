#!/usr/bin/env bash
# Installer contract: local capture, exact provider selection, preserved MCP entries,
# repeatability, dry-run and refusal before mutation. All state is disposable.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/bin" "$TEMP/home/.cursor"
cat > "$TEMP/bin/beacon" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$HOME/beacon-calls"
test "$BEACON_ONBOARDING" = 0
test "$BEACON_MANAGED_INGEST" = 0
case "$*" in
  'endpoint install --user --harness cursor --no-backfill'|'endpoint install --user --harness claude,codex --no-backfill') ;;
  'endpoint hooks install --user --harness cursor --level user'|'endpoint hooks install --user --harness claude,codex --level user') test ! -f "$HOME/fail-hooks"; exit $? ;;
  *) exit 1 ;;
esac
test ! -f "$HOME/fail-endpoint"
STUB
chmod +x "$TEMP/bin/beacon"
printf '%s\n' '{"other":1,"mcpServers":{"prism-mcp":{"command":"npx","args":["prism"]},"mine":{"url":"https://example.com/mcp"}}}' > "$TEMP/home/.cursor/mcp.json"
run() {
  env HOME="$TEMP/home" PATH="$TEMP/bin:$PATH" CURSOR_DIR="$TEMP/home/.cursor" \
    AW_STATE_DIR="$TEMP/state" AW_MCP_RETIRED=prism-mcp \
    bash "$ROOT/scripts/install-beacon.sh" "$@"
}
fail() { echo "FAIL: $*" >&2; exit 1; }
run --providers cursor --dry-run > "$TEMP/dry"
test ! -e "$TEMP/home/beacon-calls" || fail 'dry-run ran Beacon'
! jq -e '.mcpServers["aw-beacon"]' "$TEMP/home/.cursor/mcp.json" >/dev/null || fail 'dry-run registered MCP'
run --providers cursor
jq -e --arg binary "$TEMP/bin/beacon" '
  .other == 1 and .mcpServers.mine.url == "https://example.com/mcp" and
  .mcpServers["prism-mcp"].args == ["prism"] and
  .mcpServers["aw-beacon"] == {command:$binary,args:["mcp","serve","--user","--transport","stdio"]}
' "$TEMP/home/.cursor/mcp.json" >/dev/null || fail 'MCP merge lost configuration or wrong server'
cp "$TEMP/home/.cursor/mcp.json" "$TEMP/first.json"
run --providers cursor
cmp "$TEMP/first.json" "$TEMP/home/.cursor/mcp.json" || fail 'repeat install changed MCP'
echo 'PASS: dry-run, local capture, exact selection, MCP preservation and repeat install'

for bad in '{"managed_ingest":{"enabled":true}}' '{"destinations":{"splunk_hec":{"enabled":true}}}' '{"destinations":{"falcon_hec":{"endpoint":"https://example.com","enabled":false}}}' '{"destinations":{"splunk_hec":{"token":"test-token"}}}' 'broken'; do
  mkdir -p "$TEMP/home/.beacon/endpoint"
  printf '%s\n' "$bad" > "$TEMP/home/.beacon/endpoint/config.json"
  cp "$TEMP/home/beacon-calls" "$TEMP/before"
  if run --providers cursor > "$TEMP/refused" 2>&1; then fail 'unsafe existing config accepted'; fi
  cmp "$TEMP/before" "$TEMP/home/beacon-calls" || fail 'refusal ran Beacon'
done
rm "$TEMP/home/.beacon/endpoint/config.json"
if run --providers cursor,unknown > "$TEMP/refused" 2>&1; then fail 'invalid provider accepted'; fi
cmp "$TEMP/before" "$TEMP/home/beacon-calls" || fail 'invalid selection ran Beacon'
echo 'PASS: invalid selection and existing forwarding refuse before mutation'

rm "$TEMP/home/.cursor/mcp.json"
touch "$TEMP/home/fail-endpoint"
if run --providers cursor > "$TEMP/refused" 2>&1; then fail 'collector failure accepted'; fi
test ! -e "$TEMP/home/.cursor/mcp.json" || fail 'MCP registered after collector failure'
echo 'PASS: collector failure stops MCP registration'

rm "$TEMP/home/fail-endpoint"
touch "$TEMP/home/fail-hooks"
if run --providers cursor > "$TEMP/refused" 2>&1; then fail 'hook failure accepted'; fi
test ! -e "$TEMP/home/.cursor/mcp.json" || fail 'MCP registered after hook failure'
rm "$TEMP/home/fail-hooks"
echo 'PASS: hook failure stops MCP registration'
for provider in claude codex; do
  cat > "$TEMP/bin/$provider" <<'STUB'
#!/usr/bin/env bash
set -eu
name="$(basename "$0")"
[ "$1 $2" = 'mcp get' ] && exit 1
[ "$1 $2" = 'mcp add' ] || exit 2
[ ! -f "$HOME/fail-mcp" ] || exit 3
printf '%s\n' "$*" > "$HOME/$name-call"
STUB
  chmod +x "$TEMP/bin/$provider"
done
run --providers claude,codex
test "$(cat "$TEMP/home/claude-call")" = "mcp add --scope user aw-beacon -- $TEMP/bin/beacon mcp serve --user --transport stdio" || fail 'Claude scope or MCP command wrong'
test "$(cat "$TEMP/home/codex-call")" = "mcp add aw-beacon -- $TEMP/bin/beacon mcp serve --user --transport stdio" || fail 'Codex MCP command wrong'
touch "$TEMP/home/fail-mcp"
if run --providers claude,codex > "$TEMP/refused" 2>&1; then fail 'MCP failure reported as success'; fi
echo 'PASS: Claude/Codex stdio registration and registration failure propagation'
