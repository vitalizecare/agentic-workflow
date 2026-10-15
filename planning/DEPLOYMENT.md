# Deployment Guide

## Deployment Model

This project runs **locally only**. There is no cloud deployment, no containerization, and no remote hosting. The toolkit runs on the developer's machine alongside whichever agent CLIs are installed (Claude Code, Codex, Cursor).

## Registering MCP Servers

`./setup.sh` registers `serena`, `headroom`, `prism-mcp` and, on macOS, `xcodebuildmcp` with every selected provider (`claude mcp add --scope user`, `codex mcp add`, `mcpServers` in `~/.cursor/mcp.json`). On re-run it also removes an old `agentic-bridge` registration: the MCP bridge was retired on 2026-10-10. Agents hand off through Prism handoffs (`session_save_handoff` / `session_load_context`), judge's outbox and teammate names (agent teams), and Sindri's ledger; there is no bridge server.

### MCP Config File

When Claude Code is a selected provider, the setup script copies `config/mcp.json` to `~/.claude/mcp.json` if one does not already exist. This file can also contain the MCP server registration. To check or update the config manually:

```bash
diff ~/.claude/mcp.json ~/repos/agentic-workflow/config/mcp.json
```

## Skills Deployment

Skills are deployed via **symlinks** managed by `setup.sh` (provider-specific logic in `providers/<name>/install.sh`). The script links each skill directory from the repo into every selected provider's skills directory, and records each provider in `~/.agentic-workflow/providers`:

```
~/.agentic-workflow/toolkit            -> ~/repos/agentic-workflow   (stable path; skills resolve _shared/ through it)
~/.claude/skills/review                -> ~/repos/agentic-workflow/skills/review
~/.claude/skills/bootstrap             -> ~/repos/agentic-workflow/bootstrap
<codex skills dir>/review              -> ~/repos/agentic-workflow/skills/review
<cursor skills dir>/review             -> ~/repos/agentic-workflow/skills/review
```

Provider skills directories are listed in `planning/PROVIDERS.md`.

Because these are symlinks, any changes to skill files in the repo are immediately reflected -- no reinstallation needed. The symlink approach means:

- `git pull` in the repo updates all skills instantly.
- Skills can be version-controlled and reviewed via normal Git workflow.
- Multiple machines stay in sync by pulling and re-running `setup.sh` if new skills are added.

### Adding a New Skill

1. Create the skill directory under `skills/` (or at the repo root for standalone skills like `bootstrap`).
2. Add the skill name to the `MANAGED_SKILLS` array in `setup.sh`.
3. Run `./setup.sh` on each machine to create the symlinks for every installed provider.

## New Machine Onboarding

Full setup from scratch:

```bash
# 1. Clone the repository
git clone https://github.com/jthorare/agentic-workflow.git ~/repos/agentic-workflow
cd ~/repos/agentic-workflow

# 2. Run the setup script (detects installed provider CLIs; or pass --providers)
./setup.sh                                  # or: ./setup.sh --providers claude,codex,cursor
```

The setup script handles:
- Creating `~/.agentic-workflow/toolkit` and the `~/.agentic-workflow/providers` registry
- Symlinking all skills into each selected provider's skills directory
- Installing hooks per provider (native for Claude Code; via `config/hooks/adapters/` for Codex and Cursor)
- Registering MCP servers with each selected provider
- Claude Code only: copying `settings.json` and `mcp.json` to `~/.claude/` (non-destructive -- skips if files exist), statusline, and plugin marketplaces
