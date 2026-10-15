# Local Development Guide

## Prerequisites

| Requirement | Minimum Version | Purpose |
|-------------|----------------|---------|
| Node.js | >= 22 (`.nvmrc`) | Runtime for the TypeScript packages (`scorer`, `judge`, `sindri`) and build tooling; better-sqlite3 13 requires 22 |
| GitHub CLI (`gh`) | Latest | Required by review skills for PR interaction |
| Claude Code, Codex, or Cursor CLI | Latest | At least one agent host for skills and MCP server registration |
| npm | Bundled with Node | Dependency management |

## Initial Setup

### 1. Clone the Repository

```bash
git clone https://github.com/jthorare/agentic-workflow.git ~/repos/agentic-workflow
cd ~/repos/agentic-workflow
```

### 2. Run the Setup Script

```bash
./setup.sh                                  # detect installed provider CLIs
./setup.sh --providers claude,codex,cursor  # or choose explicitly
```

The setup script performs the following (per-provider steps live in `providers/<name>/`; see `planning/PROVIDERS.md`):

1. **Symlinks skills** into each selected provider's skills directory, creates the stable `~/.agentic-workflow/toolkit` symlink, and writes the `~/.agentic-workflow/providers` registry.
   - If a directory already exists (not a symlink), it prompts before replacing.

2. **Copies config files** to `~/.claude/` (Claude Code only):
   - `settings.json` -- only if no existing file (will not overwrite).
   - `mcp.json` -- only if no existing file (will not overwrite).
   - If files exist, it prints a `diff` command for manual comparison.

### 3. MCP Servers

`setup.sh` registers `serena`, `headroom`, `prism-mcp` and, on macOS, `xcodebuildmcp` with every selected provider, and removes an old `agentic-bridge` registration on re-run. Agents hand off through Prism handoffs (`session_save_handoff` / `session_load_context`), judge's outbox and teammate names (agent teams), and Sindri's ledger; there is no bridge server.

## Running Tests

```bash
cd ~/repos/agentic-workflow/scorer   # or judge, sindri

# Single run
npm run test

# Type-check without emitting files
npm run typecheck
```

## Building

```bash
cd ~/repos/agentic-workflow/scorer   # or judge, sindri
npm run build
```

Build configuration (from `tsconfig.json`):

| Setting | Value |
|---------|-------|
| Target | ES2022 |
| Module | Node16 |
| Module Resolution | Node16 |
| Output Directory | `dist/` |
| Source Directory | `src/` |
| Strict Mode | Enabled |
| Source Maps | Enabled |
| Declaration Files | Enabled |

The build compiles `src/**/*` to `dist/`, excluding `node_modules`, `dist`, and `tests`.

## Project Structure

```
agentic-workflow/
├── skills/                    # Native skills (symlinked into each provider's skills dir)
│   ├── review/                # Multi-agent PR review
│   ├── postReview/            # GitHub comment publisher
│   ├── addressReview/         # Review fix implementer
│   └── enhancePrompt/         # Context-aware prompt rewriter
├── bootstrap/                 # Repo documentation generator skill
├── config/                    # Settings & MCP config archive
│   ├── settings.json
│   └── mcp.json
├── judge/                     # Cheap-agent-harness judge CLI
├── scorer/                    # Daily cost/involvement report
├── sindri/                    # Sindri core CLI
├── setup.sh                   # One-command setup script
└── README.md
```

## Common Development Tasks

### Adding a New Skill

1. Create a directory under `skills/` with the skill's name.
2. Add the skill name to the `for` loop in `setup.sh` so it gets symlinked on setup.
3. Re-run `./setup.sh` to install the symlink.
