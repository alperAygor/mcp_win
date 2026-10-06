import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakePc } from "./helpers.mjs";
import { createApp } from "../app/gui/server.mjs";
import { DICT } from "../app/gui/ui/i18n.js";
import { REGISTRY } from "../app/lib/registry.mjs";

const UI = fileURLToPath(new URL("../app/gui/ui/", import.meta.url));

// ------------------------------------------------------------------ i18n

test("i18n: Turkish and English define exactly the same keys", () => {
  assert.deepEqual(Object.keys(DICT.tr).sort(), Object.keys(DICT.en).sort());
  for (const lang of ["tr", "en"]) for (const [k, v] of Object.entries(DICT[lang])) assert.ok(String(v).trim(), `${lang}.${k} is empty`);
});

test("i18n: every key used by the UI code exists (static and generated families)", () => {
  const js = readFileSync(join(UI, "app.js"), "utf8");
  const used = new Set([...js.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]));
  for (const m of js.matchAll(/t\(`([a-z.]+)\$\{/g)) { /* families handled below */ void m; }
  for (const k of used) assert.ok(k in DICT.tr, `missing i18n key: ${k}`);
  for (const k of ["active", "pending", "disabled", "not-installed", "needs-setup", "cloud"]) assert.ok(`status.${k}` in DICT.tr, k);
  for (const k of ["all", "archcad", "visual", "game"]) assert.ok(`cat.${k}` in DICT.tr, k);
  for (const k of ["app-missing", "path-missing", "no-versions", "no-projects", "addon-missing"]) assert.ok(`warn.${k}` in DICT.tr, k);
});

test("ui: every registry id has a tile and a category the filter knows", () => {
  const js = readFileSync(join(UI, "app.js"), "utf8");
  for (const d of REGISTRY) { assert.match(js, new RegExp(`${d.id}: \\["`), `tile for ${d.id}`); assert.ok(["bim", "cad", "mech", "analysis", "electronics", "audio", "gis", "image", "3d", "game"].includes(d.category), d.id); }
});

test("ui: no inline event handlers, no eval, no external requests (CSP-friendly)", () => {
  for (const f of ["index.html", "app.js", "guides.js", "illustrations.js", "guides-data.js"]) {
    const s = readFileSync(join(UI, f), "utf8");
    assert.ok(!/\son(click|change|load|error)=/.test(s), `${f} has inline handler`);
    assert.ok(!/\beval\(|new Function\(/.test(s), `${f} uses eval`);
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(s.replace(/http:\/\/www\.w3\.org\/\d+\/svg/g, "")), `${f} references an external URL`);
  }
});

// ------------------------------------------------------------------ API

async function boot(opts = {}) {
  const pc = fakePc(opts);
  const token = "t".repeat(48);
  const app = createApp({ ctx: pc.ctx, token, versions: { app: { version: "9.9.9" } } });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const port = app.server.address().port;
  app.setPort(port);
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "x-archmcp-token": token, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null), res };
  };
  return { pc, app, port, token, call, close: () => app.server.close() };
}

test("api: token, Host and Origin are enforced; only whitelisted static files are served", async () => {
  const g = await boot();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${g.port}/api/state`)).status, 401);
    assert.equal((await g.call("GET", "/api/state", undefined, { "x-archmcp-token": "wrong" })).status, 401);
    assert.equal((await g.call("GET", "/api/state")).status, 200);
    // Host header spoofing needs raw http (fetch forbids setting Host)
    const { request } = await import("node:http");
    const status = await new Promise((resolve) => {
      const r = request({ host: "127.0.0.1", port: g.port, path: "/api/state", headers: { host: "evil.example.com", "x-archmcp-token": g.token } }, (res) => resolve(res.statusCode));
      r.end();
    });
    assert.equal(status, 403);
    assert.equal((await g.call("POST", "/api/apply", {}, { origin: "http://evil.example.com" })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${g.port}/app.js`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${g.port}/server.mjs`)).status, 404);
    assert.equal((await g.call("POST", "/api/open", { what: "C:/Windows/system32/calc.exe" })).status, 400);
    assert.equal((await g.call("POST", "/api/mcp/evil/test", {})).status, 404);
    const csp = (await fetch(`http://127.0.0.1:${g.port}/`)).headers.get("content-security-policy");
    assert.match(csp, /default-src 'self'/);
  } finally { g.close(); }
});

test("api: enabling an MCP picks detected Revit versions, installs the add-on, and Apply writes Claude's config", async () => {
  const g = await boot({ apps: { "Autodesk/Revit 2026/Revit.exe": 1 } });
  try {
    writeFileSync(g.pc.claudeCfg, JSON.stringify({ mcpServers: { mine: { command: "x" } } }));
    const r = await g.call("POST", "/api/settings", { mcps: { revit: { enabled: true } } });
    assert.equal(r.status, 200);
    const revit = r.json.state.mcps.find((m) => m.id === "revit");
    assert.deepEqual(revit.options.versions, [2026]);
    assert.equal(revit.status, "pending");
    assert.ok(existsSync(join(g.pc.env.APPDATA, "Autodesk", "Revit", "Addins", "2026", "RevitMCPAddin.dll")));
    assert.deepEqual(r.json.state.pending, ["revit"]);

    const a = await g.call("POST", "/api/apply", {});
    assert.equal(a.json.results[0].ok, true);
    assert.equal(a.json.state.mcps.find((m) => m.id === "revit").status, "active");
    const cfg = JSON.parse(readFileSync(g.pc.claudeCfg, "utf8"));
    assert.deepEqual(Object.keys(cfg.mcpServers).sort(), ["archmcp-revit-2026", "mine"]);

    // switching it off marks it pending (still registered) until applied again, then it is removed
    const off = await g.call("POST", "/api/settings", { mcps: { revit: { enabled: false } } });
    assert.equal(off.json.state.mcps.find((m) => m.id === "revit").status, "pending");
    await g.call("POST", "/api/apply", {});
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(g.pc.claudeCfg, "utf8")).mcpServers), ["mine"]);
  } finally { g.close(); }
});

test("api: AI apps (Codex, OpenCode, Antigravity) can be added and removed from the panel; a card is active only when every enabled app has it", async () => {
  const g = await boot();
  try {
    const home = g.pc.env.USERPROFILE;
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "x"\n');
    let r = await g.call("POST", "/api/settings", { mcps: { blender: { enabled: true } }, clients: { codex: { enabled: true }, opencode: { enabled: true } } });
    const byId = (st) => Object.fromEntries(st.clients.map((c) => [c.id, c]));
    assert.equal(byId(r.json.state).codex.detected, true);
    assert.equal(byId(r.json.state).codex.inSync, false);
    assert.equal(byId(r.json.state).antigravity.enabled, false);
    const a = await g.call("POST", "/api/apply", {});
    assert.ok(a.json.clients.codex[0].ok && a.json.clients.opencode[0].ok && a.json.clients.claude[0].ok);
    assert.deepEqual(a.json.clients.antigravity, [], "a disabled app that has no file is not touched");
    assert.equal(a.json.state.mcps.find((m) => m.id === "blender").status, "active");
    assert.match(readFileSync(join(home, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.archmcp-blender\]/);
    assert.equal(JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8")).mcp["archmcp-blender"].type, "local");
    // Codex off: it is out of sync until applied, and then our entries are gone while the user's line stays
    r = await g.call("POST", "/api/settings", { clients: { codex: { enabled: false } } });
    assert.equal(byId(r.json.state).codex.inSync, false);
    await g.call("POST", "/api/apply", {});
    const toml = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    assert.ok(!toml.includes("archmcp") && toml.includes('model = "x"'));
    const b = await g.call("GET", "/api/backups");
    assert.ok(b.json.backups.some((x) => x.client === "codex"));
    assert.equal((await g.call("POST", "/api/settings", { clients: { bogus: { enabled: true } } })).status, 200);
  } finally { g.close(); }
});

test("api: autoApply writes Claude's config immediately", async () => {
  const g = await boot();
  try {
    await g.call("POST", "/api/settings", { autoApply: true });
    const r = await g.call("POST", "/api/settings", { mcps: { blender: { enabled: true, options: { port: 9001 } } } });
    assert.equal(r.json.apply[0].ok, true);
    assert.equal(JSON.parse(readFileSync(g.pc.claudeCfg, "utf8")).mcpServers["archmcp-blender"].env.BLENDER_PORT, "9001");
  } finally { g.close(); }
});

test("api: invalid input is sanitised, not stored", async () => {
  const g = await boot();
  try {
    const r = await g.call("POST", "/api/settings", { language: "klingon", mcps: { blender: { options: { port: "abc", rm: 1 } }, nope: { enabled: true } } });
    assert.equal(r.json.state.settings.language, "tr");
    assert.equal(r.json.state.mcps.find((m) => m.id === "blender").options.port, 9876);
    assert.ok(!r.json.state.mcps.some((m) => m.id === "nope"));
    assert.equal((await g.call("POST", "/api/settings", "not json-object")).status, 200);
  } finally { g.close(); }
});

test("api: test endpoint really starts the server (revit handshake) or explains why not", async () => {
  const g = await boot({ installed: [] });
  try {
    const r = await g.call("POST", "/api/mcp/revit/test", {});
    assert.equal(r.json.ok, false);
    assert.match(r.json.servers[0].message, /not installed/);
  } finally { g.close(); }
});

test("api: add-on endpoint refuses targets we did not discover", async () => {
  const g = await boot({ apps: { "Autodesk/Revit 2026/Revit.exe": 1 } });
  try {
    const bad = await g.call("POST", "/api/mcp/freecad/addon", { action: "install", target: "C:\\Windows\\System32" });
    assert.equal(bad.json.results[0].ok, false);
    assert.equal((await g.call("POST", "/api/mcp/revit/addon", { action: "format-disk" })).status, 400);
    assert.equal((await g.call("POST", "/api/mcp/sketchup/addon", { action: "install" })).status, 400);
  } finally { g.close(); }
});

test("api: backups can be listed and restored, but only our own files", async () => {
  const g = await boot();
  try {
    writeFileSync(g.pc.claudeCfg, JSON.stringify({ mcpServers: { original: {} } }));
    await g.call("POST", "/api/settings", { mcps: { blender: { enabled: true } } });
    await g.call("POST", "/api/apply", {});
    const list = (await g.call("GET", "/api/backups")).json.backups;
    assert.equal(list.length, 1);
    assert.equal((await g.call("POST", "/api/backups/restore", { path: join(g.pc.root, "evil.json") })).status, 500);
    await g.call("POST", "/api/backups/restore", { path: list[0].path });
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(g.pc.claudeCfg, "utf8")).mcpServers), ["original"]);
  } finally { g.close(); }
});

test("api: logs endpoint only reads whitelisted logs", async () => {
  const g = await boot();
  try {
    mkdirSync(join(g.pc.ctx.dataDir, "logs"), { recursive: true });
    const r = await g.call("GET", "/api/logs?name=../../etc/passwd");
    assert.equal(r.json.name, "gui");
  } finally { g.close(); }
});
