# Scrapling-Plugin

**Give any coding agent a fast, stealthy web scraper.**

One command installs [Scrapling](https://github.com/d4vinci/Scrapling) — an adaptive
scraping framework that renders JavaScript and bypasses Cloudflare — into **20 coding
agents**: Claude Code, Claude Desktop, Codex, Cursor, Windsurf, OMP (oh-my-pi), Gemini
CLI, Qwen Code, OpenCode, VS Code, Amp, Crush, Kiro, Amazon Q, Zed, Continue, Goose,
Cline, Roo Code, and the cross-tool `.agents/` / `.github/skills/` layout.

Works the way you already work: as **MCP tools**, as a **skill** the agent invokes on
its own, and as a **slash command** you type.

---

## Install

```bash
npx scrapling-plugin
```

Everything detected on the machine gets configured. Or do it by hand from a clone:

```bash
git clone https://github.com/Jeetaksh25/Scrapling-Plugin.git
cd Scrapling-Plugin
node install.mjs
```

Node 18+. No dependencies.

### One-time dependency: the scraper itself

The plugin wires your agent to the `scrapling-mcp` command. Install what runs behind it:

```bash
pip install "scrapling[all]>=0.4.15"
scrapling install --force          # downloads the browsers
```

`scrapling-mcp` must be on `PATH` — verify with `scrapling-mcp --help`. If your Python
is elsewhere, point the installer at it and it will register `<python> -m scrapling.cli mcp`
instead:

```bash
node install.mjs --python /path/to/python
```

No Python at all? Use Docker. The installer will still write the config, and every
command in `docs/` has a `docker run` equivalent.

---

## What gets installed

For each agent, up to three things, each degrading gracefully if the agent lacks it:

| Surface | What it is | How it is triggered |
|---|---|---|
| **MCP tools** | 13 scraping tools served by `scrapling-mcp` | The agent calls them on its own |
| **Skill** | `scrapling` + the upstream `scrapling-official` skill, with full API references | The agent reads it when a task needs scraping |
| **Slash command** | `/scrape <url>` | You type it |

That is the whole point: **the agent is invokable-with, and you are invokable-with too.**

---

## Usage

### Let the agent decide (nothing to type)

Just ask for what you want. The skill and the MCP tools are discovered automatically:

> "Get me the pricing table from https://example.com/pricing"
>
> "This page renders with JavaScript and my fetch came back empty — get the content."
>
> "Scrape the top 20 results from that shop and give me a CSV."
>
> "That site is behind Cloudflare. Get past it."

### Slash command

```
/scrape https://example.com
/scrape https://shop.example.com .product-card
```

Installed per agent in its native command format: markdown for Claude Code, Codex
(`prompts/`), OMP and OpenCode; TOML for Gemini CLI and Qwen Code.

### MCP tools

| Need | Tool |
|---|---|
| Simple page, article, API, JSON | `make_request` |
| Many simple URLs at once | `bulk_get` |
| JS-rendered page | `fetch` |
| Many JS pages at once | `bulk_fetch` |
| Cloudflare / anti-bot | `stealthy_fetch` |
| Many protected URLs at once | `bulk_stealthy_fetch` |
| Login, cookies, pagination | `open_session` → `session_fetch` → `close_session` |
| Plain HTTP with kept cookies | `open_request_session` → `session_make_request` |
| Inspect / screenshot | `list_sessions`, `screenshot` |

### CLI (no agent needed)

```bash
scrapling extract get            "https://example.com" out.md --ai-targeted
scrapling extract fetch          "https://app.example.com" out.md --ai-targeted --network-idle
scrapling extract stealthy-fetch "https://protected.example.com" out.md --ai-targeted --solve-cloudflare
```

`--ai-targeted` strips navigation and ads and sanitizes hidden content that could carry
a prompt injection. Use it every time. The output format follows the file extension:
`.md`, `.html`, `.txt`, `.json`.

### Python (everything else)

```python
from scrapling.fetchers import Fetcher

page = Fetcher.get("https://quotes.toscrape.com/")
quotes = page.css(".quote .text::text").getall()
```

Spiders, sessions, proxy rotation and pause/resume: see `examples/quickstart.py` and the
skill's `references/` directory.

---

## Commands

```bash
node install.mjs --list                      # agents, detection, config paths
node install.mjs                             # install into everything detected
node install.mjs --agent cursor,claude-code  # or specific ones
node install.mjs --scope project --dir .     # portable, committed with the repo
node install.mjs --dry-run                   # show changes, write nothing
node install.mjs --uninstall                 # remove what this added
node install.mjs --print-docs cursor         # manual setup instructions
```

| Flag | Meaning |
|---|---|
| `-a, --agent <id>` | Agent id, repeatable or comma-separated; `all` for every one |
| `-s, --scope <user\|project>` | User config, or a file inside the project |
| `--dir <path>` | Project directory for `--scope project` |
| `--python <exe>` | Register `exe -m scrapling.cli mcp` instead of `scrapling-mcp` |
| `--no-skills` / `--only-skills` | MCP only, or skill only |
| `--dry-run` / `--uninstall` / `--list` / `--json` | Exactly what they say |

Supported ids: `claude-code`, `claude-desktop`, `codex`, `cursor`, `windsurf`, `omp`,
`gemini`, `qwen`, `opencode`, `vscode`, `agent-skills`, `amp`, `crush`, `kiro`,
`amazon-q`, `zed`, `continue`, `goose`, `cline`, `roo-code`.

---

## Project scope

`--scope project` writes config the whole team gets, committed with the repository:

```bash
cd my-repo
node install.mjs --scope project --agent claude-code,cursor,vscode,agent-skills
git add .mcp.json .cursor/mcp.json .vscode/mcp.json .agents/
```

Any checkout of that repo then has Scrapling available with no per-machine setup.

---

## Safety

The installer edits config files that also hold your unrelated agent state, so it is
deliberately conservative:

- **Surgical edits.** `~/.claude.json` can hold megabytes of history and project state.
  The installer rebuilds only the object it touches, from the raw text of every other
  member — everything else survives byte-for-byte.
- **Backups.** Any file it changes keeps a `.bak-scrapling-plugin` copy.
- **Refuses on malformed input.** If an existing config is not valid JSON, it reports and
  skips rather than overwriting it.
- **Idempotent.** Running it twice changes nothing the second time.
- **Reversible.** `--uninstall` removes exactly what it added and leaves your other
  servers alone.
- **Previewable.** `--dry-run` shows every path it would touch.

`node scripts/selftest.mjs` proves all of the above against a throwaway `HOME` — it never
touches your real configs (53 checks).

---

## Verify

```bash
node scripts/selftest.mjs          # installer behaviour, isolated HOME
node scripts/verify-mcp.mjs --live # MCP handshake, tools/list, a real fetch
```

---

## Layout

```
install.mjs            the installer (Node, no dependencies)
agents.json            agent registry: paths, formats, keys — the whole matrix as data
skills/
  scrapling/           this plugin's skill: three layers, selectors, rules
  scrapling-official/  upstream skill: full API reference + runnable examples
commands/
  scrape.md            slash command (Claude Code, Codex, OMP, OpenCode)
  scrape.toml          slash command (Gemini CLI, Qwen Code)
examples/quickstart.py
scripts/
  selftest.mjs         installer self-test against an isolated HOME
  verify-mcp.mjs       live MCP protocol check
docs/                  per-agent manual setup and Docker usage
```

Adding an agent means adding one object to `agents.json` — the installer needs no code
change.

---

## License

BSD-3-Clause, matching Scrapling. Scrapling is by
[D4Vinci](https://github.com/d4vinci/Scrapling); this plugin only packages and wires it.
