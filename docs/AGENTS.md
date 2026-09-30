# Agents

Every agent this plugin can configure, with the file it writes and the shape it uses.
`node install.mjs --list` shows which are detected on this machine;
`node install.mjs --print-docs <id>` prints the exact snippet for one.

All entries run the same server: **`scrapling-mcp`, no arguments, `stdio`**.

| id | agent | config file (Windows) | shape | skill | command |
|---|---|---|---|---|---|
| `claude-code` | Claude Code | `~/.claude.json`, project `.mcp.json` | `mcpServers` map | ✅ | ✅ md |
| `claude-desktop` | Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers` map | — | — |
| `codex` | Codex CLI | `~/.codex/config.toml`, project `.codex/config.toml` | `[mcp_servers.*]` | ✅ | ✅ md |
| `cursor` | Cursor | `~/.cursor/mcp.json`, project `.cursor/mcp.json` | `mcpServers` map | — | — |
| `windsurf` | Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` map | — | — |
| `omp` | OMP (oh-my-pi) | `~/.omp/agent/mcp.json`, project `.omp/mcp.json` | `mcpServers` map | ✅ | ✅ md |
| `gemini` | Gemini CLI | `~/.gemini/settings.json` | `mcpServers` map | — | ✅ toml |
| `qwen` | Qwen Code | `~/.qwen/settings.json` | `mcpServers` map | — | — |
| `opencode` | OpenCode | `~/.config/opencode/opencode.json` | `mcp` map, `type: local` | ✅ | ✅ md |
| `vscode` | VS Code | project `.vscode/mcp.json` | `servers` map, `type: stdio` | — | — |
| `agent-skills` | Cross-tool `.agents/` | — | skills only | ✅ | — |
| `amp` | Amp | `~/.config/amp/settings.json` | `amp.mcpServers` map | — | — |
| `crush` | Crush | `~/.config/crush/crush.json` | `mcp` map | — | — |
| `kiro` | Kiro | `~/.kiro/settings/mcp.json` | `mcpServers` map | — | — |
| `amazon-q` | Amazon Q Developer CLI | `~/.aws/amazonq/mcp.json` | `mcpServers` map | — | — |
| `zed` | Zed | `%APPDATA%\Zed\settings.json` | `context_servers` map | — | — |
| `continue` | Continue | `~/.continue/config.yaml` | `mcpServers` list | — | — |
| `goose` | Goose | `%APPDATA%\Block\goose\config\config.yaml` | `extensions` map | — | — |
| `cline` | Cline | `~/.cline/data/settings/cline_mcp_settings.json` | `mcpServers` map | — | — |
| `roo-code` | Roo Code | `%APPDATA%\Code\User\globalStorage\...\mcp_settings.json` | `mcpServers` map | — | — |

macOS and Linux differ mainly in home-directory conventions for Claude Desktop, Zed, Goose
and Roo Code; `--list` prints the resolved path for your platform.

## Which surfaces an agent gets

- **MCP tools** — every agent above except `agent-skills`, which has no MCP concept.
- **Skill** — agents that discover `skills/<name>/SKILL.md`. The `scrapling` skill and the
  upstream `scrapling-official` skill (full API reference + examples) are both installed.
- **Slash command** — Claude Code, Codex (`prompts/`), OMP, OpenCode (markdown), and
  Gemini CLI, Qwen Code (TOML).

An agent that supports none of the three still benefits: the MCP server it gets is the
whole scraper, and the skill is readable documentation you can point it at.

## Adding an agent

One object in `agents.json`. No code change:

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "kind": "json",                    // json | toml | yaml-list | yaml-map | skill-only
  "key": "mcpServers",               // the map/table the server goes under
  "shape": "map",                    // map | typed | opencode | toml
  "docs": "https://…",
  "detect": ["~/.my-agent"],         // paths whose existence means "installed"
  "user": { "win32": ["~/.my-agent/mcp.json"], "darwin": ["…"], "linux": ["…"] },
  "project": { "win32": [".my-agent/mcp.json"], "darwin": ["…"], "linux": ["…"] },
  "skillDirs": ["~/.my-agent/skills"],
  "projectSkillDirs": [".my-agent/skills"],
  "commandDirs": ["~/.my-agent/commands"],
  "projectCommandDirs": [".my-agent/commands"],
  "commandFormat": "md"              // md | toml
}
```

Fields are optional; omit what an agent lacks. `shape` picks the server object:

| shape | produces |
|---|---|
| `map` | `{"command": "scrapling-mcp", "args": []}` |
| `typed` | `{"type": "stdio", "command": "…", "args": []}` (VS Code) |
| `opencode` | `{"type": "local", "command": ["scrapling-mcp"], "enabled": true}` |
| `toml` | the TOML table form (Codex) |

The installer validates any existing config before touching it, backs it up, and edits
surgically — a `shape` or `key` mistake shows up in `--dry-run` rather than in a broken
file.

## Sources

Each entry carries a `docs` URL in `agents.json`; those are the authoritative pages used
to derive the paths and shapes, checked rather than guessed.
