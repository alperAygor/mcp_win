#!/usr/bin/env node
// Installs EVERY pack of a build through the control panel's own API (offline import path: the zip must match the signed
// catalog) and starts each server with a real MCP handshake.
//   node build/ci-packs-smoke.mjs --app-dir <install dir> --packs <dir with catalog.json + zips> [--node <node>] [--skip id,id]
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const appDir = resolve(arg("app-dir")), packsDir = resolve(arg("packs"));
const strict = argv.includes("--strict");
const resultsFile = arg("results");
const results = {};
const skip = new Set((arg("skip", "") || "").split(",").filter(Boolean));
const node = arg("node", process.execPath);
const catalog = JSON.parse(readFileSync(join(packsDir, "catalog.json"), "utf8"));

// the installed app ships a (signed) catalog; make sure this build's one is the one in place
mkdirSync(join(appDir, "catalog"), { recursive: true });
cpSync(join(packsDir, "catalog.json"), join(appDir, "catalog", "catalog.json"));
cpSync(join(packsDir, "catalog.sig"), join(appDir, "catalog", "catalog.sig"));

const launcher = existsSync(join(appDir, "app", "gui", "launcher.mjs")) ? join(appDir, "app", "gui", "launcher.mjs") : fileURLToPath(new URL("../app/gui/launcher.mjs", import.meta.url));
const child = spawn(node, [launcher, "--app-dir", appDir, "--no-open", "--keep-alive"], { stdio: ["ignore", "pipe", "inherit"] });
const url = await new Promise((resolveUrl, reject) => {
  const t = setTimeout(() => reject(new Error("control panel did not start")), 20_000);
  child.stdout.on("data", (d) => { const m = /(http:\/\/127\.0\.0\.1:\d+)\/#t=(\w+)/.exec(String(d)); if (m) { clearTimeout(t); resolveUrl({ base: m[1], token: m[2] }); } });
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
  for (const [id, p] of Object.entries(catalog.packs)) {
    if (skip.has(id)) { console.log(` skip  ${id}`); continue; }
    const t0 = Date.now();
    const { job } = await call("POST", "/api/packs/import", { path: join(packsDir, p.file) });
    let j = job;
    while (j.state === "running") { await new Promise((r) => setTimeout(r, 300)); j = await call("GET", `/api/jobs/${job.id}`); }
    if (j.state !== "done") { check(false, `${id}: install failed: ${j.message}`); results[id] = { ok: false, message: j.message }; continue; }
    await call("POST", "/api/settings", { mcps: { [id]: { enabled: true } } });
    const res = await call("POST", `/api/mcp/${id}/test`, {});
    const s = res.servers[0];
    check(!!s?.ok, `${id.padEnd(10)} ${s?.ok ? `${s.message} - ${s.tools} tools, starts in ${s.ms} ms (install ${Date.now() - t0 - s.ms} ms)` : s?.message?.slice(0, 200)}`);
    results[id] = { ok: !!s?.ok, message: s?.ok ? s.message : s?.message?.slice(0, 300), tools: s?.tools, ms: s?.ms };
  }
  const st = await call("GET", "/api/state");
  check(st.mcps.filter((m) => m.isPack && m.installed).length === Object.keys(catalog.packs).length - skip.size, "every pack shows as installed in the panel");
  await call("POST", "/api/shutdown", {});
} catch (e) { console.error(e.stack ?? e); failed++; }
child.kill();
if (resultsFile) writeFileSync(resolve(resultsFile), JSON.stringify(results, null, 2));
const passed = Object.values(results).filter((r) => r.ok).length;
// a single broken upstream pack must not fail the build (it is simply left out of the catalog); nothing working at all must
process.exit(strict ? (failed ? 1 : 0) : (passed === 0 ? 1 : 0));
