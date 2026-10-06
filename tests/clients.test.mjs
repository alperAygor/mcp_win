import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseClients } from "../app/cli/setup.mjs";
import { applySettings } from "../app/lib/apply.mjs";
import { CLIENT_IDS, clientDetected, clientPaths, clientRegistered, clientsState, codexBlock, listAllBackups, mergeCodex, restoreAnyBackup, stripCodex, tomlString, updateClient } from "../app/lib/clients.mjs";
import { KEY_PREFIX, buildEntries } from "../app/lib/registry.mjs";
import { defaultSettings, normalizeSettings, updateSettings } from "../app/lib/settings.mjs";
import { fakePc } from "./helpers.mjs";

// A real TOML parser (Python's tomllib) checks what we write for Codex. Skipped where no Python >= 3.11 exists.
const PY = [process.env.PYTHON, "python3.13", "python3.12", "python3.11", "python3", "python"].filter(Boolean).find((p) => spawnSync(p, ["-c", "import tomllib"]).status === 0);
const parseToml = (text) => {
  // PYTHONUTF8: on Windows Python would otherwise read stdin as cp1252 and mangle non-ASCII characters
  const r = spawnSync(PY, ["-c", "import sys,tomllib,json;print(json.dumps(tomllib.loads(sys.stdin.read())))"], { input: text, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } });
  assert.equal(r.status, 0, `tomllib rejected the file:\n${r.stderr}\n${text}`);
  return JSON.parse(r.stdout);
};

const E = {
  [`${KEY_PREFIX}revit`]: { command: "C:\\Users\\Ayşe Öz\\AppData\\Local\\Programs\\ArchMCP\\runtime\\node\\node.exe", args: ["C:\\a b\\server.js", "--flag=\"x\""], env: { REVIT_VERSIONS: "2025,2026", WEIRD: "it's \"quoted\"", EMPTY_OK: "1" } },
  [`${KEY_PREFIX}ifc`]: { command: "py", args: [], env: {} },
};

test("clients: settings default to Claude only; patches and garbage are sanitised", () => {
  const d = defaultSettings();
  assert.deepEqual(Object.entries(d.clients).filter(([, c]) => c.enabled).map(([id]) => id), ["claude"]);
  const n = updateSettings(d, { clients: { codex: { enabled: true }, nope: { enabled: true }, opencode: { enabled: "yes" } } });
  assert.equal(n.clients.codex.enabled, true);
  assert.equal(n.clients.opencode.enabled, false);
  assert.equal("nope" in n.clients, false);
  assert.equal(normalizeSettings({ clients: "x" }).clients.claude.enabled, true);
  assert.deepEqual(parseClients("claude, CODEX,bogus,codex"), ["claude", "codex"]);
  assert.equal(parseClients(undefined), undefined);
});

test("codex: TOML strings are valid for Windows paths, quotes and non-ASCII", { skip: !PY }, () => {
  const out = parseToml(`v = ${tomlString("C:\\Users\\Ayşe\\x")}\nw = ${tomlString("it's \"q\" \\ \n tab\t")}`);
  assert.equal(out.v, "C:\\Users\\Ayşe\\x");
  assert.equal(out.w, "it's \"q\" \\ \n tab\t");
});

test("codex: managed block is valid TOML and round-trips env, args and odd characters", { skip: !PY }, () => {
  const t = parseToml(mergeCodex("", E));
  const s = t.mcp_servers[`${KEY_PREFIX}revit`];
  assert.equal(s.command, E[`${KEY_PREFIX}revit`].command);
  assert.deepEqual(s.args, E[`${KEY_PREFIX}revit`].args);
  assert.deepEqual(s.env, E[`${KEY_PREFIX}revit`].env);
  assert.equal(s.startup_timeout_sec, 90);
  assert.deepEqual(t.mcp_servers[`${KEY_PREFIX}ifc`].args, []);
});

test("codex: the user's own file is preserved; our block is replaced in place and removable", { skip: !PY }, () => {
  const mine = `model = "gpt-5"\n\n[mcp_servers.mine]\ncommand = "npx"\nargs = ["-y", "thing"]\n\n[mcp_servers.mine.env]\nTOKEN = "s3cret"\n\n[profiles.fast]\nmodel = "x"\n`;
  const once = mergeCodex(mine, E);
  const twice = mergeCodex(once, { [`${KEY_PREFIX}ifc`]: E[`${KEY_PREFIX}ifc`] });
  const t = parseToml(twice);
  assert.equal(t.model, "gpt-5");
  assert.equal(t.mcp_servers.mine.env.TOKEN, "s3cret");
  assert.equal(t.profiles.fast.model, "x");
  assert.deepEqual(Object.keys(t.mcp_servers).sort(), [`${KEY_PREFIX}ifc`, "mine"].sort());
  assert.equal(twice.split("ArchMCP managed block:").length, 2, "exactly one managed block");
  const gone = stripCodex(twice);
  assert.equal(gone.trim(), mine.trim());
  assert.equal(stripCodex(mergeCodex("", E)), "");
});

test("codex: a stray [mcp_servers.archmcp-*] table outside the block cannot cause a duplicate-table error", { skip: !PY }, () => {
  const stray = `[mcp_servers.archmcp-revit]\ncommand = "old"\n\n[mcp_servers.archmcp-revit.env]\nA = "1"\n\n[other]\nx = 1\n`;
  const t = parseToml(mergeCodex(stray, E));
  assert.notEqual(t.mcp_servers[`${KEY_PREFIX}revit`].command, "old");
  assert.equal(t.other.x, 1);
});

test("antigravity and opencode: formats, preserved user data, timeouts", () => {
  const pc = fakePc();
  const s = defaultSettings();
  const [ag] = clientPaths(pc.ctx, "antigravity", s);
  const [oc] = clientPaths(pc.ctx, "opencode", s);
  assert.match(ag, /\.gemini[\\/]config[\\/]mcp_config\.json$/);
  assert.match(oc, /\.config[\\/]opencode[\\/]opencode\.json$/);
  mkdirSync(join(pc.env.USERPROFILE, ".config", "opencode"), { recursive: true });
  writeFileSync(oc, JSON.stringify({ theme: "x", mcp: { mine: { type: "remote", url: "https://x" } } }));
  assert.ok(updateClient(pc.ctx, "antigravity", s, "merge", E).every((r) => r.ok && r.created));
  assert.ok(updateClient(pc.ctx, "opencode", s, "merge", E).every((r) => r.ok && !r.created));
  const a = JSON.parse(readFileSync(ag, "utf8"));
  assert.deepEqual(a.mcpServers[`${KEY_PREFIX}revit`], E[`${KEY_PREFIX}revit`]);
  const o = JSON.parse(readFileSync(oc, "utf8"));
  assert.equal(o.theme, "x");
  assert.equal(o.mcp.mine.url, "https://x");
  const r = o.mcp[`${KEY_PREFIX}revit`];
  assert.equal(r.type, "local");
  assert.deepEqual(r.command, [E[`${KEY_PREFIX}revit`].command, ...E[`${KEY_PREFIX}revit`].args]);
  assert.equal(r.environment.REVIT_VERSIONS, "2025,2026");
  assert.equal(r.enabled, true);
  assert.ok(r.timeout >= 60_000, "first start of a Python server is slow: OpenCode's 5 s default would time it out");
  assert.equal(o.mcp[`${KEY_PREFIX}ifc`].environment, undefined);
  assert.deepEqual(clientRegistered(pc.ctx, "opencode", s), [`${KEY_PREFIX}ifc`, `${KEY_PREFIX}revit`]);
  // remove only ours
  assert.ok(updateClient(pc.ctx, "opencode", s, "strip").every((r) => r.ok));
  const after = JSON.parse(readFileSync(oc, "utf8"));
  assert.deepEqual(Object.keys(after.mcp), ["mine"]);
  assert.deepEqual(clientRegistered(pc.ctx, "opencode", s), []);
});

test("antigravity: the older mcp_config.json is kept in sync only when it already exists", () => {
  const pc = fakePc();
  const s = defaultSettings();
  assert.equal(clientPaths(pc.ctx, "antigravity", s).length, 1);
  const legacy = join(pc.env.USERPROFILE, ".gemini", "antigravity", "mcp_config.json");
  pc.touch(legacy, "{}");
  assert.equal(clientPaths(pc.ctx, "antigravity", s).length, 2);
  updateClient(pc.ctx, "antigravity", s, "merge", E);
  assert.ok(JSON.parse(readFileSync(legacy, "utf8")).mcpServers[`${KEY_PREFIX}ifc`]);
});

test("a file that does not parse is never touched; stripping never creates files; no-op writes make no backup", () => {
  const pc = fakePc();
  const s = defaultSettings();
  const [oc] = clientPaths(pc.ctx, "opencode", s);
  pc.touch(oc, "{ not json");
  const r = updateClient(pc.ctx, "opencode", s, "merge", E);
  assert.equal(r[0].ok, false);
  assert.equal(readFileSync(oc, "utf8"), "{ not json");
  const [cx] = clientPaths(pc.ctx, "codex", s);
  assert.deepEqual(updateClient(pc.ctx, "codex", s, "strip"), []);
  assert.equal(existsSync(cx), false);
  updateClient(pc.ctx, "codex", s, "merge", E);
  assert.equal(listAllBackups(pc.ctx, s).filter((b) => b.client === "codex").length, 0, "a brand-new file has nothing to back up");
  updateClient(pc.ctx, "codex", s, "merge", E);
  assert.equal(listAllBackups(pc.ctx, s).filter((b) => b.client === "codex").length, 0, "identical content: nothing changed, no backup");
  updateClient(pc.ctx, "codex", s, "merge", { [`${KEY_PREFIX}ifc`]: E[`${KEY_PREFIX}ifc`] });
  assert.equal(listAllBackups(pc.ctx, s).filter((b) => b.client === "codex").length, 1);
});

test("applySettings: enabled apps receive the servers, disabled apps are cleaned, state reports sync", () => {
  const pc = fakePc();
  let s = updateSettings(defaultSettings(), { mcps: { revit: { enabled: true, options: { versions: [2026] } }, blender: { enabled: true } }, clients: { codex: { enabled: true }, opencode: { enabled: true } } });
  const wanted = Object.keys(buildEntries(pc.ctx, s));
  assert.ok(wanted.length >= 2);
  let st = clientsState(pc.ctx, s, wanted);
  assert.equal(st.find((c) => c.id === "codex").inSync, false);
  const res = applySettings(pc.ctx, s);
  assert.ok(res.results.every((r) => r.ok), "claude results keep the installer contract");
  for (const id of ["claude", "codex", "opencode"]) assert.deepEqual(clientRegistered(pc.ctx, id, s), wanted.sort(), id);
  assert.deepEqual(clientRegistered(pc.ctx, "antigravity", s), []);
  st = clientsState(pc.ctx, s, wanted);
  assert.ok(st.filter((c) => c.enabled).every((c) => c.inSync));
  // turn Codex off: out of sync until applied, then clean
  s = updateSettings(s, { clients: { codex: { enabled: false } } });
  assert.equal(clientsState(pc.ctx, s, wanted).find((c) => c.id === "codex").inSync, false);
  applySettings(pc.ctx, s);
  assert.deepEqual(clientRegistered(pc.ctx, "codex", s), []);
  assert.ok(clientsState(pc.ctx, s, wanted).every((c) => c.inSync));
  assert.ok(readFileSync(clientPaths(pc.ctx, "codex", s)[0], "utf8").trim() === "", "nothing but our block was in the file");
});

test("detection and backups across apps", () => {
  const pc = fakePc();
  const s = defaultSettings();
  assert.equal(clientDetected(pc.ctx, "codex"), false);
  mkdirSync(join(pc.env.USERPROFILE, ".codex"), { recursive: true });
  assert.equal(clientDetected(pc.ctx, "codex"), true);
  assert.equal(clientDetected(pc.ctx, "claude"), true); // fakePc creates %APPDATA%\Claude
  const [cx] = clientPaths(pc.ctx, "codex", s);
  pc.touch(cx, `model = "a"\n`);
  updateClient(pc.ctx, "codex", s, "merge", E);
  const [b] = listAllBackups(pc.ctx, s);
  assert.equal(b.client, "codex");
  restoreAnyBackup(pc.ctx, s, b.path);
  assert.equal(readFileSync(cx, "utf8"), `model = "a"\n`);
  assert.throws(() => restoreAnyBackup(pc.ctx, s, join(pc.root, "evil")), /not a known ArchMCP backup/);
  assert.deepEqual(CLIENT_IDS, ["claude", "codex", "antigravity", "opencode"]);
  assert.match(codexBlock({}), /managed block/);
});
