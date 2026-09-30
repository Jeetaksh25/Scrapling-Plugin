# Install

Scrapling-Plugin has two halves: the thing that scrapes (a Python package) and the
thing that wires it into your agent (this plugin). Install both.

## 1. Install the scraper

```bash
pip install "scrapling[all]>=0.4.15"
scrapling install --force        # downloads the browsers
```

Then confirm two commands exist:

```bash
scrapling --help
scrapling-mcp --help
```

If `scrapling-mcp` is not on `PATH`, it is still installed for some interpreter. Find it
and either add it to `PATH` or let the plugin point at the interpreter directly:

```bash
pip show scrapling | grep -i location        # or: pip show scrapling
python -m scrapling.cli mcp --help           # equivalent to scrapling-mcp
node install.mjs --python /path/to/python    # registers <python> -m scrapling.cli mcp
```

### Common failure: an old `mcp` package

Scrapling's MCP server needs `mcp>=2.0.0`. If your environment has an older `mcp`,
`scrapling-mcp` starts and immediately dies with:

```
ImportError: cannot import name 'MCPServer' from 'mcp.server'
```

Fix:

```bash
pip install -U "mcp>=2.0.0"
```

The installer's preflight catches this and prints the same fix.

### Common failure: no markdown output

MCP tools default to `extraction_type: "markdown"`. If `markdownify` is missing, a call
fails with `Error executing tool make_request`. Fix:

```bash
pip install "scrapling[rag]"
```

or pass `extraction_type: "html"` / `"text"` to the tool.

## 2. Install the plugin

```bash
npx -y github:Jeetaksh25/Scrapling-Plugin
```

(The package is not on the npm registry yet, so `npx scrapling-plugin` will not resolve —
use the `github:` form.)

Or from a clone:

```bash
git clone https://github.com/Jeetaksh25/Scrapling-Plugin.git
cd Scrapling-Plugin
node install.mjs --list         # see what was detected
node install.mjs --dry-run      # see exactly what would change
node install.mjs                # do it
```

Restart the agent afterwards.

## Manual installation

Every agent accepts a config by hand. The installer only automates this; you can always
write the file yourself. Use `--print-docs <id>` to get the exact snippet for your agent:

```bash
node install.mjs --print-docs cursor
node install.mjs --print-docs claude-code
```

The one universal fact: **every server runs the command `scrapling-mcp` with no
arguments**, over the `stdio` transport. Everything else is spelling.

### JSON agents — `mcpServers`

Claude Code (`~/.claude.json`), Claude Desktop, Cursor, Windsurf, OMP, Gemini CLI,
Qwen Code, Kiro, Amazon Q, Cline, Roo Code, Zed (`context_servers`):

```json
{
  "mcpServers": {
    "scrapling": {
      "command": "scrapling-mcp",
      "args": []
    }
  }
}
```

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers.scrapling]
command = "scrapling-mcp"
args = []
```

### OpenCode — `~/.config/opencode/opencode.json`

OpenCode calls stdio servers `local` and takes a command array:

```json
{
  "mcp": {
    "scrapling": {
      "type": "local",
      "command": ["scrapling-mcp"],
      "enabled": true
    }
  }
}
```

### Continue — `~/.continue/config.yaml`

```yaml
mcpServers:
  - name: scrapling
    command: "scrapling-mcp"
    args: []
```

### Goose — `config.yaml`

```yaml
extensions:
  scrapling:
    type: stdio
    name: scrapling
    enabled: true
    cmd: "scrapling-mcp"
    args: []
    timeout: 300
```

## Project-scoped install

Commit Scrapling for a whole team:

```bash
cd my-repo
node install.mjs --scope project --agent claude-code,cursor,vscode,opencode,agent-skills
```

This writes `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `opencode.json` and
`.agents/skills/` — all safe to commit. Anyone who checks out the repo then has Scrapling
with no per-machine setup.

## Docker

With no Python at all, run the server from the image instead. Point any config at the
container by replacing the command:

```json
{
  "mcpServers": {
    "scrapling": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "pyd4vinci/scrapling", "mcp"]
    }
  }
}
```

See `docs/DOCKER.md`.

## Updating and removing

```bash
pip install -U "scrapling[all]"     # update the scraper
node install.mjs                    # re-run: idempotent, updates the config
node install.mjs --uninstall        # remove the MCP entries
```

`--uninstall` removes only the `scrapling` server entry, the installed skill folders and
the slash command. Your other servers, and everything else in the file, are left alone.
