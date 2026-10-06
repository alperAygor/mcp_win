import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { childEnv, fakePc } from "./helpers.mjs";
import { KEY_PREFIX, REGISTRY, buildEntries, byId, isInstalled, keysOf } from "../app/lib/registry.mjs";
import { defaultSettings, normalizeSettings, sanitizeOption, updateSettings } from "../app/lib/settings.mjs";
import { DETECTORS } from "../app/lib/detect.mjs";
import { claudeConfigPaths, listBackups, mergeServers, removeServers, restoreBackup, updateClaudeConfigs } from "../app/lib/claude.mjs";
import { addonRun, addonStatus, freecadModDirs } from "../app/lib/addons.mjs";
import { componentsToPatch, parseComponents } from "../app/cli/setup.mjs";

const SETUP = fileURLToPath(new URL("../app/cli/setup.mjs", import.meta.url));
const enabledAll = (extra = {}) => {
  const s = defaultSettings();
  for (const d of REGISTRY) s.mcps[d.id].enabled = true;
  s.mcps.revit.options.versions = [2025, 2027];
  return updateSettings(s, extra);
};

// ------------------------------------------------------------------ registry

test("registry has the 9 core integrations first, then the downloadable packs, each with a unique id and a bilingual name", () => {
  assert.deepEqual(REGISTRY.slice(0, 9).map((d) => d.id), ["revit", "autocad", "photoshop", "sketchup", "blender", "freecad", "openscad", "godot", "unity"]);
  assert.ok(REGISTRY.length >= 9 + 20, "20 packs + manual guides");
  assert.equal(new Set(REGISTRY.map((d) => d.id)).size, REGISTRY.length);
  for (const d of REGISTRY) { assert.ok(d.name.tr && d.name.en && d.desc.tr && d.desc.en, d.id); }
});

test("every local MCP launches only bundled runtimes (no PATH, no uvx/npx) and keeps the archmcp- prefix", () => {
  const { ctx } = fakePc();
  const entries = buildEntries(ctx, enabledAll());
  for (const [k, e] of Object.entries(entries)) {
    assert.ok(k.startsWith(KEY_PREFIX), k);
    assert.match(e.command, /^.*\\(runtime\\(node\\node|python\\python)|servers\\matlab\\bin\\matlab-mcp-server)\.exe$/, `${k}: ${e.command}`);
    assert.ok(!/uvx|npx|npm/.test(e.command + e.args.join(" ")), k);
  }
  const core = ["archmcp-autocad", "archmcp-blender", "archmcp-freecad", "archmcp-godot", "archmcp-openscad", "archmcp-photoshop", "archmcp-revit-2025", "archmcp-revit-2027", "archmcp-unity"];
  for (const k of core) assert.ok(entries[k], k);
  assert.ok(Object.keys(entries).length >= core.length + 18);
});

test("python servers run in isolated mode; generically-named ones get their own site folder; packs bring their own everything", () => {
  const { ctx } = fakePc();
  const e = buildEntries(ctx, enabledAll());
  for (const k of ["archmcp-autocad", "archmcp-blender", "archmcp-freecad", "archmcp-openscad", "archmcp-unity"]) assert.equal(e[k].args[0], "-I", k);
  for (const k of ["archmcp-ableton", "archmcp-rhino", "archmcp-nx", "archmcp-abaqus"]) {
    assert.deepEqual(e[k].args.slice(0, 2), ["-I", "-S"], k);                    // -S: not even the interpreter's own site-packages
    assert.match(e[k].args[2], /app\\py\\bootstrap\.py$/, k);
    assert.match(e[k].env.ARCHMCP_SITE, new RegExp(`servers\\\\${k.slice(8)}\\\\site$`), k);
    assert.ok(e[k].env.ARCHMCP_MODULE || e[k].env.ARCHMCP_SCRIPT, k);
  }
  assert.match(e["archmcp-autocad"].env.ARCHMCP_SITE, /servers\\autocad\\site$/);
  assert.match(e["archmcp-unity"].env.ARCHMCP_SITE, /servers\\unity\\site$/);
  assert.equal(e["archmcp-blender"].env.ARCHMCP_SITE, undefined);
});

test("telemetry is switched off for Blender and Unity (both send usage data by default)", () => {
  const e = buildEntries(fakePc().ctx, enabledAll());
  assert.equal(e["archmcp-blender"].env.DISABLE_TELEMETRY, "true");
  assert.equal(e["archmcp-unity"].env.DISABLE_TELEMETRY, "true");
  assert.equal(e["archmcp-unity"].env.UNITY_MCP_DISABLE_TELEMETRY, "true");
});

test("COMSOL and LTspice: safe defaults, sandbox folders, COMSOL_ROOT derived from comsol.exe, ports", () => {
  const pc = fakePc({ apps: { "COMSOL/COMSOL63/Multiphysics/bin/win64/comsol.exe": true } });
  const e = buildEntries(pc.ctx, enabledAll());
  const lt = e["archmcp-ltspice"].env;
  assert.equal(lt.LTSPICE_MCP_RUN_CODE, "false", "arbitrary-Python tool is opt-in");
  assert.equal(lt.LTSPICE_MCP_WRITE_CONFIG, "false");
  assert.match(lt.LTSPICE_MCP_ALLOWED_PATHS, /Documents\\LTspice$/);
  assert.equal(lt.LTSPICE_MCP_WORKING_DIR, lt.LTSPICE_MCP_ALLOWED_PATHS);
  assert.equal(lt.LTSPICE_MCP_SIMULATOR_EXE, undefined, "auto-detected by the server unless the user picks one");
  let s = enabledAll();
  s.mcps.ltspice.options = { ...s.mcps.ltspice.options, folders: ["D:\\Devre", "E:\\Lab"], runCode: true, exe: "D:\\ngspice\\ngspice.exe" };
  const lt2 = buildEntries(pc.ctx, s)["archmcp-ltspice"].env;
  assert.equal(lt2.LTSPICE_MCP_ALLOWED_PATHS, "D:\\Devre;E:\\Lab");
  assert.equal(lt2.LTSPICE_MCP_RUN_CODE, "true");
  assert.equal(lt2.LTSPICE_MCP_SIMULATOR_EXE, "D:\\ngspice\\ngspice.exe");
  const co = e["archmcp-comsol"].env;
  assert.match(co.COMSOL_ROOT, /COMSOL63[\\/]Multiphysics$/);
  assert.equal(co.COMSOL_SERVER_PORT, "2036");
  s = enabledAll();
  s.mcps.comsol.options = { ...s.mcps.comsol.options, exe: "D:\\C\\COMSOL62\\Multiphysics\\bin\\win64\\comsol.exe", port: 2040 };
  const co2 = buildEntries(pc.ctx, s)["archmcp-comsol"].env;
  assert.equal(co2.COMSOL_ROOT, "D:\\C\\COMSOL62\\Multiphysics");
  assert.equal(co2.COMSOL_SERVER_PORT, "2040");
});

test("telemetry is off for Ableton too, and OpenSees/MATLAB/Ansys options reach their servers", () => {
  const e = buildEntries(fakePc().ctx, enabledAll());
  assert.equal(e["archmcp-ableton"].env.ABLETON_MCP_DISABLE_TELEMETRY, "1");
  assert.equal(e["archmcp-opensees"].env.OPENSEES_MCP_SAFE_MODE, "1");
  assert.ok(e["archmcp-matlab"].command.endsWith("matlab-mcp-server.exe"));
  assert.match(e["archmcp-ansys"].env.ANSYS_WORKBENCH_MCP_HOME, /ArchMCP\\data\\ansys$/);
  assert.equal(e["archmcp-fusion360"].env.FUSION_MCP_PORT, "9876");
  assert.deepEqual(e["archmcp-fusion360"].args.slice(-2), ["--mode", "socket"]);
});

test("manual (guide-only) entries never produce a server entry", () => {
  const s = enabledAll();
  const e = buildEntries(fakePc().ctx, s);
  for (const id of ["kicad", "civil3d", "openfoam", "sap2000"]) assert.equal(Object.keys(e).some((k) => k.includes(id)), false, id);
});

test("disabled or not-installed MCPs produce no entries; cloud MCP never does", () => {
  const { ctx } = fakePc({ installed: ["blender"] });
  const s = enabledAll();
  assert.deepEqual(Object.keys(buildEntries(ctx, s)), ["archmcp-blender"]);
  s.mcps.blender.enabled = false;
  assert.deepEqual(buildEntries(ctx, s), {});
  assert.equal(isInstalled(ctx, byId("sketchup")), true);
});

test("photoshop permissions map to the upstream levels (all / subset / none)", () => {
  const { ctx } = fakePc();
  const env = (perms) => buildEntries(ctx, updateSettings(enabledAll(), { mcps: { photoshop: { options: { permissions: perms } } } }))["archmcp-photoshop"].env;
  assert.equal(env(["read", "edit", "external", "destructive"]).PHOTOSHOP_MCP_ALLOW, "all");
  assert.equal(env(["read", "edit"]).PHOTOSHOP_MCP_ALLOW, "read,edit");
  assert.equal(env([]).PHOTOSHOP_MCP_ALLOW, "none");
  assert.equal(env(["read"]).PHOTOSHOP_MCP_EXTENSIONS_ENABLED, "none");
  assert.match(env(["read"]).PHOTOSHOP_MCP_EXTENSIONS, /servers\\photoshop\\extensions$/);
});

test("autocad: raw-command denylist stays on unless the user opts out; options map to env", () => {
  const { ctx } = fakePc();
  const get = (opts) => buildEntries(ctx, updateSettings(enabledAll(), { mcps: { autocad: { options: opts } } }))["archmcp-autocad"].env;
  assert.equal(get({}).DANGEROUS_COMMANDS_ENABLED, undefined);
  assert.equal(get({ rawCommands: true }).DANGEROUS_COMMANDS_ENABLED, "true");
  assert.equal(get({ toolProfile: "lean", discovery: "search", enable3d: true }).TOOL_PROFILE, "lean");
  assert.equal(get({ discovery: "search" }).DISCOVERY_MODE, "search");
  assert.equal(get({ allowedPaths: ["C:\\a", "D:\\b"] }).ALLOWED_PATHS, "C:\\a,D:\\b");
});

test("blender/freecad/godot/openscad options reach the server (port, safe mode, text-only, paths)", () => {
  const { ctx } = fakePc();
  const s = updateSettings(enabledAll(), { mcps: {
    blender: { options: { port: 9999, safeMode: true } }, freecad: { options: { textOnly: true } },
    godot: { options: { godotPath: "D:\\g\\godot.exe", debug: true } }, openscad: { options: { openscadPath: "D:\\o\\openscad.exe" } } } });
  const e = buildEntries(ctx, s);
  assert.equal(e["archmcp-blender"].env.BLENDER_PORT, "9999");
  assert.equal(e["archmcp-blender"].env.BLENDER_MCP_SAFE_MODE, "1");
  assert.ok(e["archmcp-freecad"].args.includes("--only-text-feedback"));
  assert.equal(e["archmcp-godot"].env.GODOT_PATH, "D:\\g\\godot.exe");
  assert.equal(e["archmcp-openscad"].env.OPENSCAD_PATH, "D:\\o\\openscad.exe");
  assert.deepEqual(e["archmcp-unity"].args.slice(-2), ["--transport", "stdio"]);
});

test("keysOf groups per-version revit keys under revit", () => {
  const e = buildEntries(fakePc().ctx, enabledAll());
  assert.deepEqual(keysOf(byId("revit"), e).sort(), ["archmcp-revit-2025", "archmcp-revit-2027"]);
});

// ------------------------------------------------------------------ settings validation

test("settings: garbage from the GUI is coerced or ignored, never stored", () => {
  const opt = byId("blender").options.find((o) => o.key === "port");
  assert.equal(sanitizeOption(opt, "99999999", 9876), 65535);
  assert.equal(sanitizeOption(opt, "abc", 9876), 9876);
  const sel = byId("autocad").options.find((o) => o.key === "backend");
  assert.equal(sanitizeOption(sel, "rm -rf", "auto"), "auto");
  const n = normalizeSettings({ language: "xx", theme: "neon", mcps: { blender: { enabled: "yes", options: { port: 5000, evil: 1 } }, nope: {} } });
  assert.equal(n.language, "tr"); assert.equal(n.theme, "auto");
  assert.equal(n.mcps.blender.enabled, false); assert.equal(n.mcps.blender.options.port, 5000);
  assert.equal(n.mcps.blender.options.evil, undefined); assert.equal(n.mcps.nope, undefined);
  const multi = byId("revit").options[0];
  assert.deepEqual(sanitizeOption(multi, [2026, 1999, "x"], []), [2026]);
});

test("settings: strips control characters from paths and dedupes folder lists", () => {
  const f = byId("unity").options[0];
  assert.deepEqual(sanitizeOption(f, ["C:\\a\u0000", "C:\\a", 5], []), ["C:\\a"]);
});

// ------------------------------------------------------------------ detection (fake Windows profile)

test("detectors find installed apps and stay quiet when absent", () => {
  const none = fakePc().ctx;
  for (const [id, fn] of Object.entries(DETECTORS)) assert.equal(fn(none).found, false, id);
  const pc = fakePc({ apps: {
    "Autodesk/Revit 2026/Revit.exe": 1, "Autodesk/AutoCAD 2026/acad.exe": 1, "Adobe/Adobe Photoshop 2026/Photoshop.exe": 1,
    "Blender Foundation/Blender 4.2/blender.exe": 1, "FreeCAD 1.1/bin/FreeCAD.exe": 1, "OpenSCAD/openscad.exe": 1,
    "Godot/Godot_v4.3.exe": 1, "Unity/Hub/Editor/6000.0.1f1/Editor/Unity.exe": 1, "SketchUp/SketchUp 2026/SketchUp.exe": 1 } });
  for (const [id, fn] of Object.entries(DETECTORS)) assert.equal(fn(pc.ctx).found, true, id);
  assert.deepEqual(DETECTORS.revit(pc.ctx).versions, [2026]);
  assert.deepEqual(DETECTORS.blender(pc.ctx).versions, ["4.2"]);
});

test("autocad detection is strictly 2026", () => {
  const pc = fakePc({ apps: { "Autodesk/AutoCAD 2025/acad.exe": 1 } });
  assert.equal(DETECTORS.autocad(pc.ctx).found, false);
});

test("godot is also found as a loose .exe in Downloads (it ships without an installer), console build ignored", () => {
  const pc = fakePc();
  pc.touch(join(pc.env.USERPROFILE, "Downloads", "Godot_v4.3-stable_win64_console.exe"));
  assert.equal(DETECTORS.godot(pc.ctx).found, false);
  pc.touch(join(pc.env.USERPROFILE, "Downloads", "Godot_v4.3-stable_win64.exe"));
  assert.match(DETECTORS.godot(pc.ctx).exe, /Godot_v4\.3-stable_win64\.exe$/);
});

// ------------------------------------------------------------------ claude config

test("claude: merge keeps the user's servers, removes only ours, backups can be restored", () => {
  const pc = fakePc();
  writeFileSync(pc.claudeCfg, "\uFEFF" + JSON.stringify({ theme: "x", mcpServers: { mine: { command: "x" }, [`${KEY_PREFIX}old`]: {} } }));
  const r = updateClaudeConfigs(pc.ctx, (c) => mergeServers(c, { [`${KEY_PREFIX}blender`]: { command: "py" } }), { create: true });
  assert.equal(r[0].ok, true);
  const cfg = JSON.parse(readFileSync(pc.claudeCfg, "utf8"));
  assert.deepEqual(Object.keys(cfg.mcpServers).sort(), [`${KEY_PREFIX}blender`, "mine"].sort());
  assert.equal(cfg.theme, "x");
  const backups = listBackups(pc.ctx);
  assert.equal(backups.length, 1);
  restoreBackup(pc.ctx, backups[0].path);
  // the restored file is the user's original, byte for byte (BOM included)
  assert.ok(JSON.parse(readFileSync(pc.claudeCfg, "utf8").replace(/^\uFEFF/, "")).mcpServers[`${KEY_PREFIX}old`]);
  assert.throws(() => restoreBackup(pc.ctx, join(pc.root, "evil.json")), /not a known ArchMCP backup/);
  assert.deepEqual(Object.keys(removeServers(cfg).mcpServers), ["mine"]);
});

test("claude: invalid JSON is never touched; MSIX package config is found too", () => {
  const pc = fakePc();
  writeFileSync(pc.claudeCfg, "{ nope");
  const r = updateClaudeConfigs(pc.ctx, (c) => mergeServers(c, {}), { create: true });
  assert.equal(r[0].ok, false);
  assert.equal(readFileSync(pc.claudeCfg, "utf8"), "{ nope");
  mkdirSync(join(pc.env.LOCALAPPDATA, "Packages", "Claude_abc"), { recursive: true });
  assert.equal(claudeConfigPaths(pc.ctx).length, 2);
});

// ------------------------------------------------------------------ add-ons

test("revit add-on: install, status, uninstall (keeps other vendors' files)", () => {
  const pc = fakePc({ apps: { "Autodesk/Revit 2026/Revit.exe": 1 } });
  const def = byId("revit");
  assert.equal(addonRun(pc.ctx, def, "install", {})[0].ok, true);
  const dir = join(pc.env.APPDATA, "Autodesk", "Revit", "Addins", "2026");
  assert.ok(existsSync(join(dir, "RevitMCPAddin.dll")));
  writeFileSync(join(dir, "Other.addin"), "x"); writeFileSync(join(dir, "revit-mcp-token.txt"), "t");
  assert.equal(addonStatus(pc.ctx, def, {})[0].installed, true);
  addonRun(pc.ctx, def, "uninstall", {});
  assert.deepEqual(readdirSync(dir), ["Other.addin"]);
});

test("freecad add-on goes to the versioned Mod folder for 1.x and the plain one for 0.21", () => {
  const a = fakePc({ apps: { "FreeCAD 1.1/bin/FreeCAD.exe": 1 } });
  assert.deepEqual(freecadModDirs(a.ctx).map((d) => d.split(/[\\/]/).slice(-2).join("/")), ["v1-1/Mod"]);
  const b = fakePc({ apps: { "FreeCAD 0.21/bin/FreeCAD.exe": 1 } });
  assert.deepEqual(freecadModDirs(b.ctx).map((d) => d.split(/[\\/]/).slice(-2).join("/")), ["FreeCAD/Mod"]);
  const r = addonRun(a.ctx, byId("freecad"), "install", {});
  assert.equal(r[0].ok, true);
  assert.ok(existsSync(join(freecadModDirs(a.ctx)[0], "FreeCADMCP", "InitGui.py")));
});

test("unity add-on: only real Unity projects, embedded in Packages, and only for configured projects", () => {
  const pc = fakePc();
  const proj = join(pc.root, "MyGame");
  mkdirSync(join(proj, "Assets"), { recursive: true }); mkdirSync(join(proj, "ProjectSettings"), { recursive: true });
  const def = byId("unity");
  const opts = { projects: [proj, join(pc.root, "NotUnity")] };
  const r = addonRun(pc.ctx, def, "install", opts);
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  assert.ok(existsSync(join(proj, "Packages", "com.coplaydev.unity-mcp", "package.json")));
  assert.equal(addonStatus(pc.ctx, def, opts)[0].installed, true);
  // the GUI sends the target: anything we were not configured with is refused
  assert.equal(addonRun(pc.ctx, def, "install", opts, "C:\\Windows\\System32")[0].ok, false);
  assert.equal(addonRun(pc.ctx, byId("freecad"), "uninstall", {}, "C:\\Windows")[0].ok, false);
});

// ------------------------------------------------------------------ installer CLI end to end

test("setup CLI: components -> settings patch; install registers + deploys; uninstall removes only ours", () => {
  assert.deepEqual(parseComponents("revit:2025+2026,autocad:unsafe,blender,bogus"), { revit: { versions: [2025, 2026] }, autocad: { unsafe: true }, blender: {} });
  const patch = componentsToPatch(parseComponents("revit:2026,autocad:unsafe"));
  assert.equal(patch.mcps.autocad.options.rawCommands, true);

  const pc = fakePc({ apps: { "Autodesk/Revit 2026/Revit.exe": 1 } });
  writeFileSync(pc.claudeCfg, JSON.stringify({ mcpServers: { mine: { command: "x" } } }));
  const env = childEnv(pc.env);
  const run = (a) => spawnSync(process.execPath, [SETUP, ...a, "--app-dir", pc.appDir], { env, encoding: "utf8" });

  const r = run(["--action", "install", "--components", "revit:2026,blender,freecad,godot,openscad,unity", "--consent"]);
  assert.ok([0, 2].includes(r.status), r.stdout + r.stderr);
  const cfg = JSON.parse(readFileSync(pc.claudeCfg, "utf8"));
  assert.deepEqual(Object.keys(cfg.mcpServers).sort(), ["archmcp-blender", "archmcp-freecad", "archmcp-godot", "archmcp-openscad", "archmcp-revit-2026", "archmcp-unity", "mine"]);
  assert.ok(existsSync(join(pc.env.APPDATA, "Autodesk", "Revit", "Addins", "2026", "RevitMCPAddin.dll")), `add-in not deployed. setup output:\n${r.stdout}${r.stderr}`);
  const saved = JSON.parse(readFileSync(join(pc.env.APPDATA, "ArchMCP", "settings.json"), "utf8"));
  assert.equal(saved.mcps.revit.enabled, true); assert.equal(saved.mcps.autocad.enabled, false); assert.ok(saved.consentAcceptedAt);

  assert.ok([0, 2].includes(run(["--action", "uninstall"]).status));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(pc.claudeCfg, "utf8")).mcpServers), ["mine"]);
  assert.ok(!existsSync(join(pc.env.APPDATA, "Autodesk", "Revit", "Addins", "2026", "RevitMCPAddin.dll")));
  assert.ok(existsSync(join(pc.env.APPDATA, "ArchMCP", "settings.json")), "user settings survive uninstall");

  writeFileSync(pc.claudeCfg, "{ not json");
  assert.equal(run(["--action", "install", "--components", "blender"]).status, 2);
  assert.equal(readFileSync(pc.claudeCfg, "utf8"), "{ not json");
});

test("the installer's component choice gates 'installed' even when the files exist (shared Python runtime)", () => {
  const pc = fakePc();
  assert.equal(isInstalled(pc.ctx, byId("freecad")), true); // no components.json: development layout, everything counts
  const env = childEnv(pc.env);
  const r = spawnSync(process.execPath, [SETUP, "--action", "install", "--app-dir", pc.appDir, "--components", "blender"], { env, encoding: "utf8" });
  assert.ok([0, 2].includes(r.status), r.stdout + r.stderr);
  assert.equal(isInstalled(pc.ctx, byId("blender")), true);
  assert.equal(isInstalled(pc.ctx, byId("freecad")), false);
  assert.equal(isInstalled(pc.ctx, byId("sketchup")), true);
});

test("re-running the installer keeps downloaded packs registered but follows the new core selection", () => {
  const pc = fakePc();
  writeFileSync(join(pc.appDir, "components.json"), JSON.stringify({ components: ["blender", "ableton", "rhino"] }));
  const env = childEnv(pc.env);
  const r = spawnSync(process.execPath, [SETUP, "--action", "install", "--app-dir", pc.appDir, "--components", "revit:2026"], { env, encoding: "utf8" });
  assert.ok([0, 2].includes(r.status), r.stdout + r.stderr);
  const comps = JSON.parse(readFileSync(join(pc.appDir, "components.json"), "utf8")).components;
  assert.deepEqual(comps.sort(), ["ableton", "revit", "rhino"]);   // blender (core) was deselected; the packs survive
});
