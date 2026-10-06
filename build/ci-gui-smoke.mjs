#!/usr/bin/env node
// End-to-end check of an INSTALLED ArchMCP: starts the control panel exactly as the shortcut does, enables every
// installed MCP, starts each real server and speaks MCP to it, applies to Claude's config and verifies the result.
//   node build/ci-gui-smoke.mjs --app-dir <install dir> [--node <node.exe>]
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const appDir = arg("app-dir");
if (!appDir) { console.error("--app-dir required"); process.exit(2); }
const node = arg("node", process.execPath);
const launcher = join(appDir, existsSync(join(appDir, "app")) ? "app/gui/launcher.mjs" : "gui/launcher.mjs");

const child = spawn(node, [existsSync(launcher) ? launcher : fileURLToPath(new URL("../app/gui/launcher.mjs", import.meta.url)), "--app-dir", appDir, "--no-open", "--keep-alive"], { stdio: ["ignore", "pipe", "inherit"] });
const url = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("control panel did not start")), 20_000);
  child.stdout.on("data", (d) => { const m = /(http:\/\/127\.0\.0\.1:\d+)\/#t=(\w+)/.exec(String(d)); if (m) { clearTimeout(t); resolve({ base: m[1], token: m[2] }); } });
  child.on("exit", (c) => reject(new Error(`launcher exited (${c})`)));
});
const call = async (method, path, body) => {
  const r = await fetch(url.base + path, { method, headers: { "x-archmcp-token": url.token, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${j.error}`);
  return j;
};

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : " FAIL "} ${msg}`); if (!ok) failed++; };
try {
  const st = await call("GET", "/api/state");
  const local = st.mcps.filter((m) => m.kind === "local" && m.installed);
  console.log(`control panel up; ${st.mcps.length} integrations, ${local.length} installed: ${local.map((m) => m.id).join(", ")}`);
  check(st.mcps.length >= 9, `${st.mcps.length} integrations are listed`);
  check(local.length > 0, "at least one integration installed");

  const enable = Object.fromEntries(local.map((m) => [m.id, { enabled: true }]));
  const after = (await call("POST", "/api/settings", { mcps: enable })).state;
  for (const m of local) {
    const res = await call("POST", `/api/mcp/${m.id}/test`, {});
    check(res.servers.length > 0 && res.servers.every((s) => s.ok), `${m.id}: ${res.servers.map((s) => (s.ok ? `${s.message} (${s.tools} tools)` : s.message)).join("; ")}`);
  }
  const applied = await call("POST", "/api/apply", {});
  check(applied.results.some((r) => r.ok), "applied to Claude's config");
  const cfgPath = applied.results.find((r) => r.ok)?.path;
  if (cfgPath) {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8").replace(/^﻿/, ""));
    const keys = Object.keys(cfg.mcpServers).filter((k) => k.startsWith("archmcp-"));
    check(keys.length >= local.length, `Claude config has ${keys.length} archmcp servers: ${keys.join(", ")}`);
  }
  void after;
  await call("POST", "/api/shutdown", {});
} catch (e) {
  console.error(e.stack ?? e);
  failed++;
}
child.kill();
process.exit(failed ? 1 : 0);
