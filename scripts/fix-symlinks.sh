#!/usr/bin/env bash
# fix-symlinks.sh — repair Agentic Workflow symlink layout for this repo.
#
# 1. In-repo: CLAUDE.md, .claude/rules, .cursor/rules/*.mdc (via sync-rules.sh)
# 2. ~/.agentic-workflow/toolkit → this repo (via setup's aw_link_toolkit)
# 3. Provider skill dirs → skills/ + bootstrap + external packs (via setup.sh)
#
# Usage: scripts/fix-symlinks.sh [--force]
#   --force  passed to sync-rules.sh (replace non-symlink rule paths)

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "fix-symlinks: unknown flag $arg" >&2; exit 2 ;;
  esac
done

echo "=== fix-symlinks: repo rule links ==="
if [ "$FORCE" = true ]; then
  "$REPO/scripts/sync-rules.sh" --force "$REPO"
else
  "$REPO/scripts/sync-rules.sh" "$REPO"
fi

REG="${HOME}/.agentic-workflow/providers"
PROVS=""
if [ -f "$REG" ]; then
  while read -r name _dir; do
    [ -n "$name" ] || continue
    if [ -n "$PROVS" ]; then PROVS="$PROVS,$name"; else PROVS="$name"; fi
  done < "$REG"
fi
PROVS="${PROVS:-claude,codex,cursor}"

echo ""
echo "=== fix-symlinks: toolkit + provider skills ($PROVS) ==="
bash "$REPO/setup.sh" --providers "$PROVS"

echo ""
echo "fix-symlinks: done"
