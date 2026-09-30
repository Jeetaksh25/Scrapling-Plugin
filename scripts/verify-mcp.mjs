#!/usr/bin/env node
/**
 * Verify the MCP server this plugin registers actually works.
 *
 * Speaks the MCP stdio protocol (newline-delimited JSON-RPC) to `scrapling-mcp`:
 * initialize -> tools/list -> tools/call. Proves the command the installer
 * writes into every agent's config is live and correct.
 *
 * Run: node scripts/verify-mcp.mjs [--command scrapling-mcp]
 */

import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const cmdIdx = argv.indexOf("--command");
const COMMAND = cmdIdx !== -1 ? argv[cmdIdx + 1] : "scrapling-mcp";

const EXPECTED_TOOLS = [
  "make_request", "bulk_get",
  "fetch", "bulk_fetch",
  "stealthy_fetch", "bulk_stealthy_fetch",
  "open_session", "open_request_session", "close_session", "list_sessions",
  "session_fetch", "session_make_request",
  "screenshot",
];

let pass = 0;
const failures = [];
const check = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { failures.push(label); console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ""}`); }
};

console.log(`\n\x1b[1mMCP verification\x1b[0m  \x1b[2mcommand=${COMMAND}\x1b[0m\n`);

const child = spawn(COMMAND, [], { stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });

const pending = new Map();
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

let stderrTail = "";
child.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-600); });

child.on("error", (e) => { console.log(`  \x1b[31m✗\x1b[0m could not spawn ${COMMAND}: ${e.message}`); process.exit(1); });

function send(method, params, id) {
  const msg = id === undefined
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", id, method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
  if (id === undefined) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); } }, 90000);
  });
}

const timer = setTimeout(() => {
  console.log(`  \x1b[31m✗\x1b[0m overall timeout`);
  if (stderrTail) console.log(`      stderr: ${stderrTail.split("\n").slice(-4).join("\n      ")}`);
  child.kill();
  process.exit(1);
}, 180000);

try {
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "scrapling-plugin-verify", version: "1.0.0" },
  }, 1);
  check("initialize handshake", !!init?.result, stderrTail || JSON.stringify(init));
  const serverName = init?.result?.serverInfo?.name;
  console.log(`  \x1b[2m·\x1b[0m \x1b[2mserver: ${serverName} v${init?.result?.serverInfo?.version}\x1b[0m`);

  await send("notifications/initialized", {});

  const list = await send("tools/list", {}, 2);
  const names = (list?.result?.tools || []).map((t) => t.name);
  check(`tools/list returns ${EXPECTED_TOOLS.length} tools`, names.length >= EXPECTED_TOOLS.length, `got ${names.length}: ${names.join(", ")}`);
  const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));
  check("all expected tools present", missing.length === 0, `missing: ${missing.join(", ")}`);

  const tools = list?.result?.tools || [];
  check("tools carry JSON schemas", tools.every((t) => t.inputSchema && t.inputSchema.type === "object"));
  check("make_request accepts a css_selector param", JSON.stringify(tools.find((t) => t.name === "make_request")?.inputSchema || {}).includes("css_selector"));

  if (argv.includes("--live")) {
    // Exercise the default path exactly as an agent would: no args but the url.
    const call = await send("tools/call", {
      name: "make_request",
      arguments: { url: "https://example.com" },
    }, 3);
    const sc = call?.result?.structuredContent || {};
    const body = JSON.stringify(sc.content ?? call?.result ?? "");
    check("live make_request returns status 200", sc.status === 200 || /status["\s:]+200/.test(JSON.stringify(call?.result ?? "")));
    check("live make_request returns content", body.length > 40 && /documentation examples|Example Domain/i.test(body), body.slice(0, 200));
  } else {
    console.log("  \x1b[2m· skipped live scrape (pass --live to fetch example.com)\x1b[0m");
  }
} catch (err) {
  check("MCP exchange", false, err.message);
} finally {
  clearTimeout(timer);
  child.kill();
}

console.log(`\n\x1b[1m${pass} passed, ${failures.length} failed\x1b[0m`);
if (failures.length) process.exit(1);
console.log("\x1b[32mMCP server verified.\x1b[0m\n");
