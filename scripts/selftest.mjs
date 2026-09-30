#!/usr/bin/env node
/**
 * Self-test for install.mjs.
 *
 * Builds a throwaway HOME containing pre-existing agent configs (including a
 * large ~/.claude.json with unrelated state), runs the installer against it,
 * and asserts that:
 *   - new entries are added in the right shape for each agent
 *   - every existing byte of unrelated config survives
 *   - a second run is a no-op (idempotent)
 *   - --uninstall removes only what the installer added
 *
 * Never touches the real HOME. Run: node scripts/selftest.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INSTALL = join(ROOT, "install.mjs");

let pass = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { failures.push(label); console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ""}`); }
}

function eq(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const home = mkdtempSync(join(tmpdir(), "scrapling-selftest-"));
const env = { ...process.env, HOME: home, USERPROFILE: home };

/** Run the installer with an isolated HOME and cwd, so it can never write here. */
function run(args, cwd) {
  const r = spawnSync(process.execPath, [INSTALL, ...args], { env, encoding: "utf8", cwd: cwd || home });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

const read = (p) => readFileSync(join(home, p), "utf8");
const exists = (p) => existsSync(join(home, p));
const json = (p) => JSON.parse(read(p));

// ---------------------------------------------------------------- fixtures

writeFileSync(join(home, ".claude.json"), `{
  "numStartups": 42,
  "projects": {
    "E:\\\\AI Testing\\\\FASEA": {
      "allowedTools": [
        "Read",
        "Bash(git status)"
      ]
    }
  },
  "mcpServers": {
    "existing-server": {
      "command": "existing-mcp",
      "args": [
        "--foo"
      ]
    }
  },
  "someFlag": true
}
`);

mkdirSync(join(home, ".codex"), { recursive: true });
writeFileSync(join(home, ".codex/config.toml"), `# keep me
model = "gpt-5"

[mcp_servers.other]
command = "other-mcp"
args = ["-x"]
`);

mkdirSync(join(home, ".cursor"), { recursive: true });
writeFileSync(join(home, ".cursor/mcp.json"), `{
  "mcpServers": {
    "other": {
      "command": "other-mcp"
    }
  }
}
`);

mkdirSync(join(home, ".config/opencode"), { recursive: true });
writeFileSync(join(home, ".config/opencode/opencode.json"), `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {}
}
`);

const claudeBefore = read(".claude.json");
const codexBefore = read(".codex/config.toml");

// ------------------------------------------------------------------- tests

console.log(`\n\x1b[1mScrapling-Plugin self-test\x1b[0m  \x1b[2mHOME=${home}\x1b[0m`);
console.log("\n\x1b[1m1. user-scope install\x1b[0m");
let r = run(["--agent", "claude-code,codex,cursor,opencode"]);
check("installer exits 0", r.code === 0, r.err || r.out);

// claude-code: surgical JSON edit of a pre-existing, large file
{
  const cfg = json(".claude.json");
  eq("claude: adds scrapling", cfg.mcpServers.scrapling.command, "scrapling-mcp");
  check("claude: keeps existing server", cfg.mcpServers["existing-server"].command === "existing-mcp");
  check("claude: keeps existing server args", JSON.stringify(cfg.mcpServers["existing-server"].args) === '["--foo"]');
  check("claude: keeps unrelated scalar", cfg.numStartups === 42);
  check("claude: keeps unrelated bool", cfg.someFlag === true);
  check("claude: keeps projects tree", cfg.projects["E:\\AI Testing\\FASEA"].allowedTools.length === 2);
  check("claude: preserved existing bytes", read(".claude.json").includes('"numStartups": 42'));
}

// codex: TOML table append
{
  const t = read(".codex/config.toml");
  check("codex: keeps comment", t.includes("# keep me"));
  check("codex: keeps model line", t.includes('model = "gpt-5"'));
  check("codex: keeps other server", t.includes("[mcp_servers.other]"));
  check("codex: adds scrapling table", t.includes("[mcp_servers.scrapling]"));
  check("codex: adds command", t.includes('command = "scrapling-mcp"'));
  const parsed = spawnSync("python", ["-c", "import tomllib,sys;d=tomllib.load(open(sys.argv[1],'rb'));print(sorted(d['mcp_servers']))", join(home, ".codex/config.toml")], { encoding: "utf8" });
  if (parsed.status === 0) eq("codex: TOML parses", parsed.stdout.trim(), "['other', 'scrapling']");
  else console.log("  \x1b[2m· skipped TOML parse check (no python tomllib)\x1b[0m");
}

// cursor: plain JSON map
{
  const cfg = json(".cursor/mcp.json");
  check("cursor: adds scrapling", cfg.mcpServers.scrapling.command === "scrapling-mcp");
  check("cursor: keeps other", cfg.mcpServers.other.command === "other-mcp");
}

// opencode: uses its own `mcp` key and `local` type
{
  const cfg = json(".config/opencode/opencode.json");
  check("opencode: uses mcp key", !!cfg.mcp.scrapling);
  eq("opencode: type local", cfg.mcp.scrapling.type, "local");
  eq("opencode: command is array", cfg.mcp.scrapling.command, ["scrapling-mcp"]);
  check("opencode: keeps $schema", cfg.$schema === "https://opencode.ai/config.json");
}

console.log("\n\x1b[1m2. skill + command install\x1b[0m");
{
  check("claude skill dir", exists(".claude/skills/scrapling/SKILL.md"));
  check("claude upstream skill", exists(".claude/skills/scrapling-official/SKILL.md"));
  check("claude slash command", exists(".claude/commands/scrape.md"));
  check("codex prompt", exists(".codex/prompts/scrape.md"));
  check("opencode command", exists(".config/opencode/commands/scrape.md"));
  const skill = read(".claude/skills/scrapling/SKILL.md");
  check("skill has frontmatter name", skill.replace(/\r\n/g, "\n").startsWith("---\nname: scrapling"));
}

console.log("\n\x1b[1m3. idempotency\x1b[0m");
const afterFirst = read(".claude.json");
r = run(["--agent", "claude-code,codex,cursor,opencode"]);
check("second run exits 0", r.code === 0);
check("claude config unchanged on rerun", read(".claude.json") === afterFirst);
check("rerun reports nothing to do", /Nothing to do|0 change/.test(r.out) || r.out.includes("already up to date"));

console.log("\n\x1b[1m4. project scope\x1b[0m");
const proj = join(home, "proj");
mkdirSync(proj, { recursive: true });
r = run(["--scope", "project", "--dir", proj, "--agent", "vscode,claude-code,gemini,agent-skills,amp,crush,kiro,amazon-q"]);
check("project install exits 0", r.code === 0, r.err);
{
  const p = join(proj, ".vscode/mcp.json");
  check("vscode project config written", existsSync(p));
  if (existsSync(p)) {
    const cfg = JSON.parse(readFileSync(p, "utf8"));
    eq("vscode uses servers key", cfg.servers.scrapling.type, "stdio");
    eq("vscode command", cfg.servers.scrapling.command, "scrapling-mcp");
  }
  check("project .mcp.json for claude", existsSync(join(proj, ".mcp.json")));
  check("gemini project command (toml)", existsSync(join(proj, ".gemini/commands/scrape.toml")));
  check("agents cross-tool skill", existsSync(join(proj, ".agents/skills/scrapling/SKILL.md")));
  for (const [id, rel, key] of [["amp", ".amp/settings.json", "amp.mcpServers"], ["kiro", ".kiro/settings/mcp.json", "mcpServers"], ["amazon-q", ".amazonq/mcp.json", "mcpServers"], ["crush", "crush.json", "mcp"]]) {
    const p = join(proj, rel);
    check(`${id} project config`, existsSync(p), rel);
    if (existsSync(p)) {
      try {
        const cfg = JSON.parse(readFileSync(p, "utf8"));
        eq(`${id} server under ${key}`, cfg[key].scrapling.command, "scrapling-mcp");
      } catch (e) { check(`${id} project config parses`, false, e.message); }
    }
  }
}

console.log("\n\x1b[1m5. uninstall\x1b[0m");
r = run(["--agent", "claude-code,codex,cursor,opencode", "--uninstall"]);
check("uninstall exits 0", r.code === 0, r.err || r.out);
{
  const cfg = json(".claude.json");
  check("claude: scrapling removed", !cfg.mcpServers || !cfg.mcpServers.scrapling);
  check("claude: existing server survives", cfg.mcpServers["existing-server"].command === "existing-mcp");
  check("claude: numStartups survives", cfg.numStartups === 42);
  check("claude: projects survive", !!cfg.projects["E:\\AI Testing\\FASEA"]);
  const t = read(".codex/config.toml");
  check("codex: scrapling removed", !t.includes("[mcp_servers.scrapling]"));
  check("codex: other survives", t.includes("[mcp_servers.other]"));
}

console.log("\n\x1b[1m6. fresh HOME (no configs)\x1b[0m");
{
  const fresh = mkdtempSync(join(tmpdir(), "scrapling-fresh-"));
  const r2 = spawnSync(process.execPath, [INSTALL, "--agent", "cursor,claude-code"], { env: { ...process.env, HOME: fresh, USERPROFILE: fresh }, encoding: "utf8", cwd: fresh });
  check("fresh install exits 0", r2.status === 0, r2.stderr);
  const p = join(fresh, ".cursor/mcp.json");
  check("fresh config created", existsSync(p));
  if (existsSync(p)) { try { eq("fresh config valid JSON", JSON.parse(readFileSync(p, "utf8")).mcpServers.scrapling.command, "scrapling-mcp"); } catch (e) { check("fresh config valid JSON", false, e.message); } }
  rmSync(fresh, { recursive: true, force: true });
}

// ---------------------------------------------------------------- teardown

rmSync(home, { recursive: true, force: true });

console.log(`\n\x1b[1m${pass} passed, ${failures.length} failed\x1b[0m`);
if (failures.length) { for (const f of failures) console.log(`  \x1b[31m✗\x1b[0m ${f}`); process.exit(1); }
console.log("\x1b[32mAll installer checks passed.\x1b[0m\n");
