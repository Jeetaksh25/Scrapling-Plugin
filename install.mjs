#!/usr/bin/env node
/**
 * Scrapling-Plugin universal installer.
 *
 * Registers the Scrapling MCP server and/or skill into any supported coding
 * agent. Pure Node, no dependencies, cross-platform.
 *
 *   node install.mjs                 install into every detected agent
 *   node install.mjs --agent cursor  install into one agent
 *   node install.mjs --list          show agents and detection status
 *   node install.mjs --dry-run       show the edits without writing
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve, normalize, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REG = JSON.parse(readFileSync(join(ROOT, "agents.json"), "utf8"));
const PLATFORM = process.platform; // win32 | darwin | linux
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version; } catch { return "0.0.0"; }
})();

// ---------------------------------------------------------------- utilities

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

/** Expand `~`, `%VAR%` and `$VAR`, then normalise separators for this OS. */
function expand(p) {
  let s = p;
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = join(homedir(), s.slice(1));
  s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, k) => process.env[k] ?? "");
  s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => process.env[k] ?? "");
  return normalize(s);
}

function ensureDir(dir) { mkdirSync(dir, { recursive: true }); }

function readText(path) { try { return readFileSync(path, "utf8"); } catch { return ""; } }

function backup(path) {
  if (!existsSync(path)) return null;
  const dest = path + ".bak-scrapling-plugin";
  copyFileSync(path, dest);
  return dest;
}

function writeText(path, text, dryRun) {
  if (dryRun) return;
  ensureDir(dirname(path));
  writeFileSync(path, text, "utf8");
}

// ------------------------------------------------------- surgical JSON edit
//
// A large config such as ~/.claude.json holds unrelated state; re-serialising
// it would be destructive. Instead we rebuild only the object we touch, from
// the raw text of its other members, so everything else survives byte-for-byte.

function skipWs(t, i) {
  while (i < t.length && (t[i] === " " || t[i] === "\t" || t[i] === "\r" || t[i] === "\n")) i++;
  return i;
}

function skipString(t, i) {
  i++; // opening quote
  while (i < t.length) {
    const ch = t[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === '"') return i + 1;
    i++;
  }
  throw new Error("unterminated string");
}

function skipValueAt(t, i) {
  i = skipWs(t, i);
  const ch = t[i];
  if (ch === '"') return skipString(t, i);
  if (ch === "{" || ch === "[") {
    const open = ch, close = ch === "{" ? "}" : "]";
    let depth = 0;
    while (i < t.length) {
      const cur = t[i];
      if (cur === '"') { i = skipString(t, i); continue; }
      if (cur === open) depth++;
      else if (cur === close) { depth--; if (depth === 0) return i + 1; }
      i++;
    }
    throw new Error(`unterminated ${open}`);
  }
  while (i < t.length && !",}] \t\r\n".includes(t[i])) i++;
  return i;
}

/** Members of the object whose `{` is at `start`, preserving each member's raw text. */
function parseObject(t, start) {
  if (t[start] !== "{") throw new Error(`expected { at offset ${start}`);
  const members = [];
  let i = start + 1;
  for (;;) {
    i = skipWs(t, i);
    if (t[i] === "}") return { members, start, end: i + 1 };
    if (t[i] === ",") { i++; continue; }
    if (t[i] !== '"') throw new Error(`expected a key at offset ${i}`);
    const ks = i;
    const ke = skipString(t, i);
    const key = JSON.parse(t.slice(ks, ke));
    i = skipWs(t, ke);
    if (t[i] !== ":") throw new Error(`expected : at offset ${i}`);
    i++;
    const vs = skipWs(t, i);
    const ve = skipValueAt(t, i);
    members.push({ key, raw: t.slice(ks, ve), ks, ke, vs, ve });
    i = ve;
  }
}

/** Validate text that may use JSONC (comments), returning the parsed value. */
function parseLoose(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:"'\\\s])\s*\/\/.*$/gm, "$1");
  return JSON.parse(stripped);
}

/**
 * Insert or replace `<key>.<name>` with `valueLiteral`, editing only that object.
 * Returns the new file text.
 */
function jsonUpsert(text, key, name, valueLiteral) {
  if (!text.trim()) {
    return `{\n  "${key}": {\n    "${name}": ${valueLiteral}\n  }\n}\n`;
  }
  const rootStart = skipWs(text, 0);
  const root = parseObject(text, rootStart);
  const existing = root.members.find((m) => m.key === key);
  const innerIndent = "    ";

  if (existing) {
    const keyObjStart = skipWs(text, existing.vs);
    const keyObj = parseObject(text, keyObjStart);
    const kept = keyObj.members.filter((m) => m.key !== name).map((m) => m.raw);
    kept.push(`"${name}": ${valueLiteral}`);
    const rebuilt = `{\n${innerIndent}${kept.join(`,\n${innerIndent}`)}\n  }`;
    return text.slice(0, existing.vs) + rebuilt + text.slice(existing.ve);
  }

  const members = root.members.map((m) => m.raw);
  members.push(`"${key}": {\n    "${name}": ${valueLiteral}\n  }`);
  return text.slice(0, rootStart) + `{\n  ${members.join(",\n  ")}\n}` + text.slice(root.end);
}

/** Remove `<key>.<name>`; returns { text, removed }. */
function jsonRemove(text, key, name) {
  if (!text.trim()) return { text, removed: false };
  let root;
  try { root = parseObject(text, skipWs(text, 0)); } catch { return { text, removed: false }; }
  const existing = root.members.find((m) => m.key === key);
  if (!existing) return { text, removed: false };
  const keyObj = parseObject(text, skipWs(text, existing.vs));
  if (!keyObj.members.some((m) => m.key === name)) return { text, removed: false };
  const kept = keyObj.members.filter((m) => m.key !== name);
  if (!kept.length) {
    // drop the now-empty key object as well
    const others = root.members.filter((m) => m.key !== key).map((m) => m.raw);
    const rebuilt = others.length ? `{\n  ${others.join(",\n  ")}\n}\n` : "{}\n";
    return { text: rebuilt, removed: true };
  }
  const rebuilt = `{\n    ${kept.map((m) => m.raw).join(",\n    ")}\n  }`;
  return { text: text.slice(0, existing.vs) + rebuilt + text.slice(existing.ve), removed: true };
}

// --------------------------------------------------------------- TOML edit

function tomlUpsert(text, table, name, kvLines) {
  const header = `[${table}.${name}]`;
  const block = `${header}\n${kvLines.join("\n")}`;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === header);
  if (start !== -1) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*\[/.test(lines[i])) { end = i; break; }
    }
    // swallow the blank line the replaced block may have left behind
    while (end - 1 > start && lines[end - 1].trim() === "") end--;
    const next = [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end)];
    return next.join("\n");
  }
  const trimmed = text.replace(/\s*$/, "");
  return (trimmed ? trimmed + "\n\n" : "") + block + "\n";
}

function tomlRemove(text, table, name) {
  const header = `[${table}.${name}]`;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return { text, removed: false };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  while (end - 1 > start && lines[end - 1].trim() === "") end--;
  const next = [...lines.slice(0, start), ...lines.slice(end)];
  return { text: next.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, ""), removed: true };
}

// --------------------------------------------------------------- YAML edit
// Continue and Goose are YAML. Both are edited as text blocks (append or
// replace one entry) so unrelated YAML in the file is never re-serialised.

function blockEnd(lines, startIdx, indent) {
  let end = startIdx + 1;
  for (; end < lines.length; end++) {
    const l = lines[end];
    if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
    if (l.length - l.trimStart().length <= indent) break;
  }
  return end;
}

function indentOf(l) { return l.length - l.trimStart().length; }

function yamlItemText(itemLines) {
  if (!Array.isArray(itemLines)) return itemLines;
  return itemLines;
}

/** continue: top-level `mcpServers:` holds a list of `- name: …` items. */
function yamlListUpsert(text, topKey, name, itemLines) {
  const lines = text.split(/\r?\n/);
  const header = new RegExp(`^${topKey}\\s*:\\s*$`);
  const h = lines.findIndex((l) => header.test(l));
  const marker = new RegExp(`^\\s*-\\s*name\\s*:\\s*["']?${name}["']?\\s*$`);
  if (h !== -1) {
    const end = blockEnd(lines, h, 0);
    for (let i = h + 1; i < end; i++) {
      if (marker.test(lines[i])) {
        const iEnd = blockEnd(lines, i, indentOf(lines[i]));
        return [...lines.slice(0, i), ...itemLines, ...lines.slice(iEnd)].join("\n");
      }
    }
    while (end - 1 > h && lines[end - 1].trim() === "") end--;
    return [...lines.slice(0, end), ...itemLines, ...lines.slice(end)].join("\n");
  }
  const trimmed = text.replace(/\s*$/, "");
  return (trimmed ? trimmed + "\n" : "") + `${topKey}:\n${itemLines.join("\n")}\n`;
}

function yamlListRemove(text, topKey, name) {
  const lines = text.split(/\r?\n/);
  const header = new RegExp(`^${topKey}\\s*:\\s*$`);
  const h = lines.findIndex((l) => header.test(l));
  if (h === -1) return { text, removed: false };
  const end = blockEnd(lines, h, 0);
  const marker = new RegExp(`^\\s*-\\s*name\\s*:\\s*["']?${name}["']?\\s*$`);
  for (let i = h + 1; i < end; i++) {
    if (marker.test(lines[i])) {
      const iEnd = blockEnd(lines, i, indentOf(lines[i]));
      const next = [...lines.slice(0, i), ...lines.slice(iEnd)];
      return { text: next.join("\n"), removed: true };
    }
  }
  return { text, removed: false };
}

/** goose: `extensions:` holds a map keyed by extension name. */
function yamlMapUpsert(text, topKey, name, blockLines) {
  const lines = text.split(/\r?\n/);
  const header = new RegExp(`^${topKey}\\s*:\\s*$`);
  const h = lines.findIndex((l) => header.test(l));
  const keyRe = new RegExp(`^\\s+${name}\\s*:\\s*$`);
  if (h !== -1) {
    const end = blockEnd(lines, h, 0);
    for (let i = h + 1; i < end; i++) {
      if (keyRe.test(lines[i])) {
        const kEnd = blockEnd(lines, i, indentOf(lines[i]));
        return [...lines.slice(0, i), ...blockLines, ...lines.slice(kEnd)].join("\n");
      }
    }
    while (end - 1 > h && lines[end - 1].trim() === "") end--;
    return [...lines.slice(0, end), ...blockLines, ...lines.slice(end)].join("\n");
  }
  const trimmed = text.replace(/\s*$/, "");
  return (trimmed ? trimmed + "\n" : "") + `${topKey}:\n${blockLines.join("\n")}\n`;
}

function yamlMapRemove(text, topKey, name) {
  const lines = text.split(/\r?\n/);
  const header = new RegExp(`^${topKey}\\s*:\\s*$`);
  const h = lines.findIndex((l) => header.test(l));
  if (h === -1) return { text, removed: false };
  const end = blockEnd(lines, h, 0);
  const keyRe = new RegExp(`^\\s+${name}\\s*:\\s*$`);
  for (let i = h + 1; i < end; i++) {
    if (keyRe.test(lines[i])) {
      const kEnd = blockEnd(lines, i, indentOf(lines[i]));
      const next = [...lines.slice(0, i), ...lines.slice(kEnd)];
      return { text: next.join("\n").replace(/\n{3,}/g, "\n\n"), removed: true };
    }
  }
  return { text, removed: false };
}

// ------------------------------------------------------------ registry glue

function serverEntry(agent, opts) {
  const base = opts.python
    ? { command: opts.python, args: ["-m", "scrapling.cli", "mcp"] }
    : { command: REG.server.command, args: REG.server.args.slice() };
  switch (agent.shape) {
    case "typed":
      return { type: "stdio", command: base.command, args: base.args };
    case "opencode":
      return { type: "local", command: [base.command, ...base.args], enabled: true };
    case "toml":
      return base;
    default:
      return { command: base.command, args: base.args };
  }
}

function agentPaths(agent, scope, projectDir) {
  const table = scope === "project" ? agent.project : agent.user;
  if (!table) return [];
  const list = table[PLATFORM] || table.linux || [];
  return list.map((p) => (scope === "project" ? resolve(projectDir, p) : expand(p)));
}

function detectAgent(agent) {
  for (const p of agent.detect || []) {
    try { if (existsSync(expand(p))) return true; } catch { /* ignore */ }
  }
  return false;
}

function whichOnPath(cmd) {
  const dirs = (process.env.PATH || "").split(PLATFORM === "win32" ? ";" : ":");
  const exts = PLATFORM === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const d of dirs) {
    if (!d) continue;
    for (const ext of exts) {
      const candidate = join(d, cmd + ext.toLowerCase()) ;
      const candidate2 = join(d, cmd + ext);
      try { if (existsSync(candidate) || existsSync(candidate2)) return join(d, cmd + ext); } catch { /* ignore */ }
    }
  }
  return null;
}

/** Resolve a skill/command directory spec for the active scope. */
function scopeDir(dirSpec, opts) {
  return opts.scope === "project" ? resolve(opts.dir, dirSpec) : expand(dirSpec);
}

/** Install the slash commands for an agent, in its native format. */
function installCommands(agent, opts, report) {
  const dirs = opts.scope === "project" ? agent.projectCommandDirs : agent.commandDirs;
  if (!dirs || !dirs.length) return;
  const format = agent.commandFormat || "md";
  const src = join(ROOT, "commands", `scrape.${format}`);
  if (!existsSync(src)) return;
  const name = `scrape.${format}`;
  for (const dirSpec of dirs) {
    const dir = scopeDir(dirSpec, opts);
    const dest = join(dir, name);
    if (opts.uninstall) {
      if (existsSync(dest)) { if (!opts.dryRun) rmSync(dest, { force: true }); report.commands.push(`removed ${dest}`); }
      continue;
    }
    if (opts.dryRun) { report.commands.push(`${dest}  ${c.dim("(would write)")}`); continue; }
    ensureDir(dir);
    copyFileSync(src, dest);
    report.commands.push(dest);
  }
}

/** Install the skill folders next to an agent's skills directory. */
function installSkills(dirs, opts, report) {
  if (opts.noSkills || !dirs.length) return;
  const sources = [
    { src: join(ROOT, REG.skill.source), name: REG.skill.name },
    { src: join(ROOT, "skills/scrapling-official"), name: "scrapling-official" },
  ];
  for (const dirSpec of dirs) {
    const dir = scopeDir(dirSpec, opts);
    for (const s of sources) {
      if (!existsSync(s.src)) continue;
      const dest = join(dir, s.name);
      if (opts.dryRun) { report.skills.push(`${dest}  ${c.dim("(would write)")}`); continue; }
      ensureDir(dir);
      rmSync(dest, { recursive: true, force: true });
      cpSync(s.src, dest, { recursive: true });
      report.skills.push(dest);
    }
  }
}

/** Probe the server once so a broken install is caught now, not at first use. */
function preflight(command, opts) {
  if (opts.onlySkills) return null;
  const probe = `
import json,subprocess,sys
cmd = sys.argv[1:]
p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
def send(o):
    p.stdin.write((json.dumps(o)+"\\n").encode()); p.stdin.flush()
def recv(i):
    while True:
        l = p.stdout.readline()
        if not l: return None
        try: m = json.loads(l)
        except Exception: continue
        if m.get("id") == i: return m
try:
    send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"preflight","version":"1"}}})
    if not recv(1): print("NOHANDSHAKE"); sys.exit(0)
    send({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
    r = recv(2) or {}
    n = len(r.get("result",{}).get("tools",[]))
    print(n if n else "NOTOOLS")
finally:
    try: p.kill()
    except Exception: pass
`;
  const interpreter = opts.python || "python";
  try {
    const r = spawnSync(interpreter, ["-c", probe, command, ...(opts.python ? ["-m", "scrapling.cli", "mcp"] : [])], { encoding: "utf8", timeout: 45000 });
    const out = (r.stdout || "").trim();
    const n = Number(out);
    if (Number.isFinite(n) && n > 0) return { ok: true, tools: n };
    if (out.includes("NOHANDSHAKE")) return { ok: false, reason: "the server did not answer the MCP handshake" };
    if (out.includes("NOTOOLS")) return { ok: false, reason: "the server started but exposed no tools" };
    return { ok: false, reason: "the server could not be probed", detail: (r.stderr || "").trim().split("\n").slice(-3).join("\n") };
  } catch {
    return null; // no interpreter to run the probe; not fatal
  }
}

// ------------------------------------------------------------------- report

const report = { configs: [], skills: [], commands: [], skipped: [], errors: [], docs: [] };

function humanPath(p) { return p.replace(homedir(), "~"); }

// --------------------------------------------------------------------- main

const HELP = `
${c.bold("Scrapling-Plugin")} — install Scrapling into any coding agent.

${c.bold("Usage")}
  node install.mjs [options]

${c.bold("Options")}
  -a, --agent <id|all>   Agent to install into (repeatable, comma-separated).
                         Default: every detected agent.
  -s, --scope <user|project>
                         Where to write. Config goes to the agent's user
                         config, or into the project directory. Default: user.
      --dir <path>       Project directory for --scope project. Default: cwd.
      --python <exe>     Use a specific interpreter instead of scrapling-mcp
                         (registers: <exe> -m scrapling.cli mcp).
      --no-skills        Register the MCP server only, skip the skill.
      --only-skills      Install the skill only, skip MCP registration.
      --dry-run          Show every change without writing anything.
      --uninstall        Remove what this installer added.
      --list             List agents, detection status and config paths.
      --print-docs <id>  Print manual setup instructions for one agent.
      --json             Machine-readable output.
  -h, --help             This help.
  -v, --version          Version.

${c.bold("Examples")}
  node install.mjs --list
  node install.mjs                        # everything detected
  node install.mjs --agent cursor,claude-code
  node install.mjs --agent codex --scope project --dir .
  node install.mjs --dry-run
  node install.mjs --uninstall
`;

function parseArgs(argv) {
  const opts = {
    agents: [], scope: "user", dir: process.cwd(), dryRun: false, uninstall: false,
    list: false, json: false, noSkills: false, onlySkills: false, python: null,
    printDocs: null, help: false, version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else if (a === "-a" || a === "--agent") opts.agents.push(...String(next()).split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "-s" || a === "--scope") opts.scope = next();
    else if (a === "--dir") opts.dir = resolve(next());
    else if (a === "--python") opts.python = next();
    else if (a === "--no-skills") opts.noSkills = true;
    else if (a === "--only-skills") opts.onlySkills = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--uninstall") opts.uninstall = true;
    else if (a === "--list") opts.list = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--print-docs") opts.printDocs = next();
    else throw new Error(`unknown option: ${a}`);
  }
  if (!["user", "project"].includes(opts.scope)) throw new Error(`--scope must be user or project, got "${opts.scope}"`);
  return opts;
}

function doList(opts) {
  const rows = REG.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    detected: detectAgent(agent),
    config: agentPaths(agent, "user", opts.dir).map(humanPath),
    project: agentPaths(agent, "project", opts.dir).map((p) => p.replace(opts.dir + sep, "")),
    skills: (agent.skillDirs || []).map(humanPath),
  }));
  if (opts.json) { console.log(JSON.stringify({ server: REG.server, agents: rows }, null, 2)); return; }
  console.log(`\n${c.bold("Scrapling-Plugin agents")}  ${c.dim(`v${VERSION} · ${PLATFORM}`)}\n`);
  for (const r of rows) {
    const mark = r.detected ? c.green("detected") : c.dim("not found");
    console.log(`${c.bold(r.id.padEnd(16))} ${mark.padEnd(20)} ${c.dim(r.name)}`);
    if (r.config.length) console.log(`${" ".repeat(17)}${c.dim("config:")} ${r.config.join(", ")}`);
    if (r.skills.length) console.log(`${" ".repeat(17)}${c.dim("skills:")} ${r.skills.join(", ")}`);
  }
  console.log(`\n${c.dim("Install:")} node install.mjs ${c.dim("[--agent <id>]")}\n`);
}

function doPrintDocs(id, opts) {
  const agent = REG.agents.find((a) => a.id === id);
  if (!agent) throw new Error(`unknown agent "${id}"`);
  const entry = serverEntry(agent, opts);
  const literal = JSON.stringify(entry, null, 2).split("\n").map((l) => "  " + l).join("\n").trimStart();
  const userPaths = agentPaths(agent, "user", opts.dir).map(humanPath);
  const projPaths = agentPaths(agent, "project", opts.dir).map((p) => p.replace(opts.dir + sep, ""));
  const mapKey = agent.key || "mcpServers";
  let snippet;
  if (agent.kind === "toml") {
    snippet = `${c.cyan("[" + agent.table + "." + REG.server.name + "]")}\ncommand = ${JSON.stringify(entry.command)}\nargs = [${entry.args.map((x) => JSON.stringify(x)).join(", ")}]`;
  } else if (agent.shape === "opencode") {
    snippet = `{\n  "${mapKey}": {\n    "${REG.server.name}": ${literal}\n  }\n}`;
  } else {
    snippet = `{\n  "${mapKey}": {\n    "${REG.server.name}": ${literal}\n  }\n}`;
  }
  console.log(`\n${c.bold(agent.name)}  ${c.dim(agent.docs)}\n`);
  console.log(`${c.dim("user config:")}    ${userPaths.join("\n                 ") || c.dim("(none)")}`);
  if (projPaths.length) console.log(`${c.dim("project config:")} ${projPaths.join(", ")}`);
  if (agent.skillDirs?.length) console.log(`${c.dim("skills dir:")}     ${agent.skillDirs.map(humanPath).join(", ")}`);
  console.log(`\n${snippet}\n`);
  if (agent.id === "claude-code") console.log(`${c.dim("or:")} claude mcp add ${REG.server.name} ${REG.server.command}\n`);
  if (agent.id === "codex") console.log(`${c.dim("or:")} codex mcp add ${REG.server.name} ${REG.server.command}\n`);
}

function installAgent(agent, opts) {
  if (agent.kind === "skill-only") {
    const dirs = opts.scope === "project" ? agent.projectSkillDirs : agent.skillDirs;
    installSkills(dirs || [], opts, report);
    if (!opts.noSkills) installCommands(agent, opts, report);
    return;
  }
  const paths = agentPaths(agent, opts.scope, opts.dir);
  if (!paths.length) { report.skipped.push(`${agent.id}: no ${opts.scope}-scope path`); return; }
  const entry = serverEntry(agent, opts);

  if (!opts.onlySkills) {
    for (const path of paths) {
      try {
        const before = readText(path);
        let after;
        const entry = serverEntry(agent, opts);
        if (opts.uninstall) {
          const res = agent.kind === "toml"
            ? tomlRemove(before, agent.table, REG.server.name)
            : agent.kind === "yaml-list"
              ? yamlListRemove(before, agent.key, REG.server.name)
              : agent.kind === "yaml-map"
                ? yamlMapRemove(before, agent.key, REG.server.name)
                : jsonRemove(before, agent.key, REG.server.name);
          if (!res.removed) { report.skipped.push(`${humanPath(path)} (nothing to remove)`); continue; }
          after = res.text;
        } else if (agent.kind === "toml") {
          after = tomlUpsert(before, agent.table, REG.server.name,
            [`command = ${JSON.stringify(entry.command)}`, `args = [${entry.args.map((x) => JSON.stringify(x)).join(", ")}]`]);
        } else if (agent.kind === "yaml-list") {
          const q = (s) => JSON.stringify(s);
          after = yamlListUpsert(before, agent.key, REG.server.name, [
            `  - name: ${REG.server.name}`,
            `    command: ${q(entry.command)}`,
            `    args: [${entry.args.map(q).join(", ")}]`,
          ]);
        } else if (agent.kind === "yaml-map") {
          const q = (s) => JSON.stringify(s);
          after = yamlMapUpsert(before, agent.key, REG.server.name, [
            `  ${REG.server.name}:`,
            `    type: stdio`,
            `    name: ${REG.server.name}`,
            `    enabled: true`,
            `    cmd: ${q(entry.command)}`,
            `    args: [${entry.args.map(q).join(", ")}]`,
            `    timeout: 300`,
          ]);
        } else {
          if (before.trim()) parseLoose(before); // validate; refuse to clobber malformed config
          after = jsonUpsert(before, agent.key, REG.server.name, JSON.stringify(entry));
        }
        if (after === before) { report.skipped.push(`${humanPath(path)} (already up to date)`); continue; }
        const bak = opts.dryRun ? null : backup(path);
        writeText(path, after, opts.dryRun);
        report.configs.push({ agent: agent.id, path, backup: bak });
      } catch (err) {
        report.errors.push(`${agent.id} ${humanPath(path)}: ${err.message}`);
      }
    }
  }
  if (!opts.noSkills) {
    const dirs = opts.scope === "project" ? agent.projectSkillDirs : agent.skillDirs;
    installSkills(dirs || [], opts, report);
    installCommands(agent, opts, report);
  }
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (err) { console.error(c.red(`error: ${err.message}`)); console.error(HELP); process.exit(2); }

  if (opts.help) { console.log(HELP); return; }
  if (opts.version) { console.log(VERSION); return; }
  if (opts.list) { doList(opts); return; }
  if (opts.printDocs) { doPrintDocs(opts.printDocs, opts); return; }

  const action = opts.uninstall ? "Removing" : "Installing";
  const detected = REG.agents.filter(detectAgent);

  let selected;
  if (opts.agents.length && !opts.agents.includes("all")) {
    selected = REG.agents.filter((a) => opts.agents.includes(a.id));
    const unknown = opts.agents.filter((id) => !REG.agents.some((a) => a.id === id));
    for (const id of unknown) report.errors.push(`unknown agent "${id}"`);
  } else if (opts.agents.includes("all")) {
    selected = REG.agents.filter((a) => a.id !== "agent-skills");
  } else if (detected.length) {
    selected = detected;
  } else {
    // Nothing detected: leave a portable project-scoped footprint instead.
    selected = REG.agents.filter((a) => ["claude-code", "cursor", "vscode", "opencode", "agents"].includes(a.id));
    opts.scope = "project";
    console.log(c.yellow("No coding agent detected on this machine."));
    console.log(c.dim("Installing portable project-scoped config into " + opts.dir + " instead.\n"));
  }

  const mcp = whichOnPath(opts.python ? opts.python : REG.server.command);
  if (!opts.uninstall && !opts.onlySkills && !mcp) {
    console.log(c.yellow(`warning: "${REG.server.command}" is not on PATH.`));
    console.log(c.dim('  install it:  pip install "scrapling[all]>=0.4.15" && scrapling install --force'));
    console.log(c.dim("  or point at an interpreter:  node install.mjs --python /path/to/python\n"));
  } else if (!opts.uninstall && !opts.onlySkills && mcp && !opts.dryRun) {
    const pf = preflight(REG.server.command, opts);
    if (pf && !pf.ok) {
      console.log(c.yellow(`warning: "${REG.server.command}" is installed but not working — ${pf.reason}.`));
      if (pf.detail) console.log(c.dim(pf.detail.split("\n").map((l) => "  " + l).join("\n")));
      console.log(c.dim('  usual cause: an old "mcp" package. Fix with:'));
      console.log(c.dim('    pip install -U "mcp>=2.0.0" "scrapling[all]>=0.4.15"'));
      console.log(c.dim("  writing config anyway; the agent will pick the server up once it works.\n"));
    } else if (pf && pf.ok) {
      console.log(c.dim(`preflight: server responds with ${pf.tools} tools\n`));
    }
  }

  console.log(`${c.bold(`${action} Scrapling into ${selected.length} agent(s)`)}  ${c.dim(`scope=${opts.scope}${opts.dryRun ? " · dry-run" : ""}`)}\n`);
  for (const agent of selected) installAgent(agent, opts);

  if (opts.json) {
    console.log(JSON.stringify({ ok: report.errors.length === 0, scope: opts.scope, dryRun: opts.dryRun, ...report }, null, 2));
    return;
  }

  for (const item of report.configs) console.log(`  ${c.green("✓")} ${item.agent.padEnd(14)} ${humanPath(item.path)}${item.backup ? c.dim("  (backup kept)") : ""}`);
  for (const s of report.skills) console.log(`  ${c.green("✓")} skill          ${humanPath(s)}`);
  for (const s of report.commands) console.log(`  ${c.green("✓")} command        ${humanPath(s)}`);
  for (const s of report.skipped) console.log(`  ${c.dim("·")} ${c.dim(s)}`);
  for (const e of report.errors) console.log(`  ${c.red("✗")} ${c.red(e)}`);

  const changed = report.configs.length + report.skills.length + report.commands.length;
  console.log(changed ? `\n${c.green(`${changed} change(s).`)}` : `\n${c.dim("Nothing to do.")}`);
  if (!opts.uninstall && changed) {
    console.log(c.dim("Restart the agent to pick up the new MCP server."));
    console.log(c.dim(`Verify:  ${REG.server.command} --help`) + c.dim(`   ·   Docs: ${REG.server.docs}`));
  }
  process.exit(report.errors.length ? 1 : 0);
}

main();
