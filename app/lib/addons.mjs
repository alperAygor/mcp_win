// The "other half" of each integration: the bit that lives inside the host application (Revit add-in, Photoshop
// plugin, Blender/FreeCAD add-ons, Unity package). Every operation returns [{target, ok, message}] and never throws.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectBlender, detectFreecad, detectRevit, findUpia } from "./detect.mjs";

const PS_PLUGIN_NAME = "Photoshop MCP";
export const REVIT_FILES = ["RevitMCPAddin.dll", "RevitMCP.Core.dll", "RevitMCPAddin.addin",
  "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.Wpf.dll", "WebView2Loader.dll",
  "revit-mcp-token.txt"]; // the token file is created by the add-in at runtime

const ok = (target, message = "") => ({ target, ok: true, message });
const fail = (target, message) => ({ target, ok: false, message });
const attempt = (target, fn) => { try { return fn() ?? ok(target); } catch (e) { return fail(target, e.message); } };

const revitDir = (ctx, y) => join(ctx.appData, "Autodesk", "Revit", "Addins", String(y));

/** Folder names for FreeCAD >= 1.0 are versioned (v1-1); older releases use a plain Mod folder. */
export function freecadModDirs(ctx) {
  const base = join(ctx.appData, "FreeCAD");
  const dirs = new Set();
  for (const v of detectFreecad(ctx).versions) {
    const m = /^(\d+)\.(\d+)/.exec(v);
    if (!m) continue;
    dirs.add(Number(m[1]) >= 1 ? join(base, `v${m[1]}-${m[2]}`, "Mod") : join(base, "Mod"));
  }
  try { for (const d of readdirSync(base).filter((n) => /^v\d+-\d+$/.test(n))) dirs.add(join(base, d, "Mod")); } catch { /* none yet */ }
  if (!dirs.size) dirs.add(join(base, "v1-1", "Mod")); // FreeCAD not seen yet: current release layout
  return [...dirs];
}

export function blenderAddonDirs(ctx) {
  return detectBlender(ctx).versions.map((v) => ({ version: v, dir: join(ctx.appData, "Blender Foundation", "Blender", v, "scripts", "addons") }));
}

export const isUnityProject = (dir) => existsSync(join(dir, "Assets")) && existsSync(join(dir, "ProjectSettings"));

function runPython(ctx, code, env = {}, timeout = 240_000) {
  return spawnSync(ctx.fs("runtime", "python", "python.exe"), ["-I", "-c", code], {
    encoding: "utf8", windowsHide: true, timeout, env: { ...process.env, PYTHONUTF8: "1", ...env },
  });
}

const BLENDER_INSTALL_CODE = `
import json, os
from pathlib import Path
from blender_mcp.addon_manager import install_addon
r = install_addon(Path(os.environ['ARCHMCP_ADDONS_DIR']))
out = {'success': bool(r.success), 'message': r.message}
exe = os.environ.get('ARCHMCP_BLENDER_EXE')
if r.success and exe:
    from blender_mcp.setup_cli import enable_addon_headless
    ok, msg = enable_addon_headless(exe, 'blender_mcp')
    out['enabled'], out['enable_message'] = ok, msg
print('ARCHMCP_RESULT ' + json.dumps(out))
`;

const pyResult = (r) => {
  const line = (r.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("ARCHMCP_RESULT "));
  return line ? JSON.parse(line.slice("ARCHMCP_RESULT ".length)) : null;
};

// ------------------------------------------------------------------ per-integration operations

const ADDONS = {
  revit: {
    // uninstall sweeps every supported year, even if that Revit was removed since (stale add-in files would remain)
    targets: (ctx, _o, action) => (action === "uninstall" ? ["2025", "2026", "2027"] : detectRevit(ctx).versions.map(String)),
    status: (ctx, t) => existsSync(join(revitDir(ctx, t), "RevitMCPAddin.dll")),
    install: (ctx, t) => attempt(`Revit ${t}`, () => {
      const src = ctx.fs("servers", "revit-addin", String(t));
      if (!existsSync(src)) throw new Error(`no add-in binaries for Revit ${t} in this install`);
      mkdirSync(revitDir(ctx, t), { recursive: true });
      try { cpSync(src, revitDir(ctx, t), { recursive: true, force: true }); }
      catch (e) { throw new Error(`copy failed - close Revit and retry (${e.message})`); }
    }),
    uninstall: (ctx, t) => attempt(`Revit ${t}`, () => {
      for (const f of REVIT_FILES) rmSync(join(revitDir(ctx, t), f), { force: true }); // each file on its own: a locked DLL reports, never aborts
    }),
  },

  photoshop: {
    targets: () => ["Photoshop"],
    status: (ctx) => {
      for (const base of [join(ctx.appData, "Adobe", "UXP", "Plugins", "External"), ...ctx.commonProgramFiles.map((r) => join(r, "Adobe", "UXP", "extensions"))]) {
        try { if (readdirSync(base).some((n) => /photoshopmcp|photoshop-mcp/i.test(n))) return true; } catch { /* next */ }
      }
      return false;
    },
    install: (ctx) => runUpia(ctx, "/install", ctx.fs("servers", "photoshop-plugin", "photoshop-mcp.ccx")),
    uninstall: (ctx) => runUpia(ctx, "/remove", PS_PLUGIN_NAME),
  },

  blender: {
    targets: (ctx) => blenderAddonDirs(ctx).map((b) => b.version),
    status: (ctx, t) => { const b = blenderAddonDirs(ctx).find((x) => x.version === t); return !!b && existsSync(join(b.dir, "blender_mcp.py")); },
    install: (ctx, t) => attempt(`Blender ${t}`, () => {
      const b = blenderAddonDirs(ctx).find((x) => x.version === t);
      if (!b) throw new Error("Blender version not found");
      mkdirSync(b.dir, { recursive: true });
      const exe = detectBlender(ctx).exe;
      const r = runPython(ctx, BLENDER_INSTALL_CODE, { ARCHMCP_ADDONS_DIR: b.dir, ARCHMCP_BLENDER_EXE: exe ?? "", BLENDERMCP_NO_UPDATE_CHECK: "1" });
      const res = pyResult(r);
      if (!res?.success) throw new Error(res?.message ?? (r.stderr || "add-on install failed").slice(-300));
      return ok(`Blender ${t}`, res.enabled ? "installed and enabled"
        : "installed - enable it in Blender: Edit > Preferences > Add-ons > 'MCP for Blender'");
    }),
    uninstall: (ctx, t) => attempt(`Blender ${t}`, () => {
      const b = blenderAddonDirs(ctx).find((x) => x.version === t);
      if (b) for (const f of ["blender_mcp.py", "blender_mcp.py.bak"]) rmSync(join(b.dir, f), { force: true });
    }),
  },

  freecad: {
    targets: (ctx) => freecadModDirs(ctx),
    status: (ctx, t) => existsSync(join(t, "FreeCADMCP", "InitGui.py")),
    install: (ctx, t) => attempt(t, () => {
      const src = ctx.fs("servers", "freecad-addon", "FreeCADMCP");
      if (!existsSync(src)) throw new Error("add-on files missing from this install");
      mkdirSync(t, { recursive: true });
      rmSync(join(t, "FreeCADMCP"), { recursive: true, force: true }); // never leave a half-merged old version behind
      cpSync(src, join(t, "FreeCADMCP"), { recursive: true });
      return ok(t, "installed - restart FreeCAD, pick the 'MCP Addon' workbench and press 'Start RPC Server'");
    }),
    uninstall: (ctx, t) => attempt(t, () => rmSync(join(t, "FreeCADMCP"), { recursive: true, force: true })),
  },

  unity: {
    targets: (ctx, opts) => opts?.projects ?? [],
    status: (ctx, t) => existsSync(join(t, "Packages", "com.coplaydev.unity-mcp", "package.json")),
    install: (ctx, t) => attempt(t, () => {
      if (!isUnityProject(t)) throw new Error("not a Unity project folder (needs Assets and ProjectSettings)");
      const src = ctx.fs("servers", "unity-package", "com.coplaydev.unity-mcp");
      if (!existsSync(src)) throw new Error("package files missing from this install");
      const dest = join(t, "Packages", "com.coplaydev.unity-mcp");
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true }); // embedded package: no git or registry needed
      return ok(t, "package added - open the project in Unity (first import downloads Unity's own dependencies)");
    }),
    uninstall: (ctx, t) => attempt(t, () => rmSync(join(t, "Packages", "com.coplaydev.unity-mcp"), { recursive: true, force: true })),
  },
};

function runUpia(ctx, verb, arg) {
  const upia = findUpia(ctx);
  if (!upia) return fail("Photoshop", "Adobe plugin installer not found (is Creative Cloud installed?). Double-click servers\\photoshop-plugin\\photoshop-mcp.ccx instead.");
  const r = spawnSync(upia, [verb, arg], { encoding: "utf8", timeout: 120_000, windowsHide: true });
  const text = (r.stdout || r.stderr || "").trim().slice(0, 300);
  return r.status === 0 ? ok("Photoshop", "installed - restart Photoshop and open Plugins > Photoshop MCP")
    : fail("Photoshop", `installer exit ${r.status}${text ? `: ${text}` : ""}. Double-click servers\\photoshop-plugin\\photoshop-mcp.ccx instead.`);
}


// ------------------------------------------------------------------ copy-based add-ons for downloadable packs

const MARKER = "ArchMCP.port";
const readMarker = (dir) => { try { return readFileSync(join(dir, MARKER), "utf8").trim(); } catch { return null; } };

/** Replaces the add-on's built-in default port. Throws when the text is not there (upstream layout changed). */
function patchPort(files, from, to) {
  if (String(from) === String(to)) return;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (!text.includes(String(from))) throw new Error(`port ${from} not found in ${f} (add-on layout changed upstream)`);
    writeFileSync(f, text.split(String(from)).join(String(to)));
  }
}

/** Creates a copy-based add-on definition. `dest(ctx, target)` -> folder or file path the add-on lives in. */
function copyAddon({ pack, targets, src, dest, isFile = false, defaultPort, portFiles = [], after }) {
  const source = (ctx) => ctx.fs("servers", pack, ...src);
  return {
    targets,
    status: (ctx, t, opts) => {
      const d = dest(ctx, t);
      const installed = existsSync(d);
      if (!installed) return { installed: false };
      const marker = readMarker(isFile ? dirname(d) : d);
      return { installed: true, stale: !!defaultPort && !!opts?.port && marker !== null && marker !== String(opts.port) };
    },
    install: (ctx, t, opts) => attempt(String(t), () => {
      const from = source(ctx), d = dest(ctx, t);
      if (!existsSync(from)) throw new Error("add-on files are missing from the installed pack - reinstall the pack");
      mkdirSync(dirname(d), { recursive: true });
      rmSync(d, { recursive: true, force: true });
      cpSync(from, d, { recursive: true });
      const port = opts?.port ?? defaultPort;
      if (defaultPort) {
        const files = portFiles.map((f) => (isFile ? d : join(d, ...f.split("/"))));
        patchPort(files, defaultPort, port);
        writeFileSync(join(isFile ? dirname(d) : d, `${isFile ? `${pack}.` : ""}${MARKER}`), String(port));
      }
      return ok(String(t), after ?? "installed");
    }),
    uninstall: (ctx, t) => attempt(String(t), () => { rmSync(dest(ctx, t), { recursive: true, force: true }); }),
  };
}

const documents = (ctx) => join(ctx.userProfile, "Documents");
ADDONS.maya = copyAddon({
  pack: "maya", src: ["addon", "archmcp_enable_commandport.py"], isFile: true,
  targets: () => ["Maya"], dest: (ctx) => join(documents(ctx), "maya", "scripts", "archmcp_enable_commandport.py"),
  after: "copied - in Maya's Script Editor (Python tab) run:  import archmcp_enable_commandport",
});
const bonsaiTargets = (ctx) => blenderAddonDirs(ctx).map((b) => b.version);
const bonsaiDest = (ctx, v) => join(blenderAddonDirs(ctx).find((b) => b.version === v)?.dir ?? "", "bonsai_mcp_addon.py");

ADDONS.fusion360 = copyAddon({
  pack: "fusion360", src: ["addon"], defaultPort: 9876, portFiles: ["Fusion360MCP.py", "server/socket_server.py"],
  targets: () => ["Fusion"], dest: (ctx) => join(ctx.appData, "Autodesk", "Autodesk Fusion 360", "API", "AddIns", "Fusion360MCP"),
  after: "installed - in Fusion: Utilities > Add-Ins > Scripts and Add-Ins, select Fusion360MCP and press Run",
});
ADDONS.qgis = copyAddon({
  pack: "qgis", src: ["addon", "qgis_mcp_plugin"], defaultPort: 9876, portFiles: ["qgis_mcp_plugin.py"],
  targets: () => ["QGIS"], dest: (ctx) => join(ctx.appData, "QGIS", "QGIS3", "profiles", "default", "python", "plugins", "qgis_mcp_plugin"),
  after: "installed - in QGIS: Plugins > Manage and Install Plugins > Installed, tick 'QGIS MCP', then Plugins > QGIS MCP > Start Server",
});
ADDONS.bonsai = copyAddon({
  pack: "bonsai", src: ["addon", "addon.py"], isFile: true, defaultPort: 9876, portFiles: ["addon.py"],
  targets: bonsaiTargets, dest: bonsaiDest,
  after: "installed - in Blender: Edit > Preferences > Add-ons, enable the Bonsai MCP add-on (Bonsai itself must be installed)",
});
ADDONS.abaqus = {
  targets: () => ["Abaqus"],
  status: (ctx) => existsSync(join(ctx.userProfile, ".abaqus-mcp", "abaqus_mcp_plugin.py")),
  install: (ctx) => attempt("Abaqus", () => {
    const src = ctx.fs("servers", "abaqus", "addon");
    if (!existsSync(src)) throw new Error("add-on files are missing from the installed pack - reinstall the pack");
    const home = join(ctx.userProfile, ".abaqus-mcp");
    mkdirSync(home, { recursive: true });
    cpSync(join(src, "abaqus_mcp_plugin.py"), join(home, "abaqus_mcp_plugin.py"));
    const env = join(ctx.userProfile, "abaqus_v6.env");           // never overwrite the user's own Abaqus environment file
    if (!existsSync(env) && existsSync(join(src, "abaqus_v6.env.example"))) cpSync(join(src, "abaqus_v6.env.example"), env);
    if (existsSync(join(src, "abaqus_plugins"))) cpSync(join(src, "abaqus_plugins"), join(ctx.userProfile, "abaqus_plugins"), { recursive: true });
    return ok("Abaqus", "installed - restart Abaqus/CAE; the plug-in loads from abaqus_v6.env, or use Plug-ins > MCP Control");
  }),
  uninstall: (ctx) => attempt("Abaqus", () => { rmSync(join(ctx.userProfile, ".abaqus-mcp", "abaqus_mcp_plugin.py"), { force: true }); rmSync(join(ctx.userProfile, "abaqus_plugins", "mcp_control"), { recursive: true, force: true }); }),
};

const pyBootstrap = (ctx, pack, module, args, env = {}) => spawnSync(ctx.fs("runtime", "python", "python.exe"),
  ["-I", "-S", ctx.fs("app", "py", "bootstrap.py"), ...args], {
    encoding: "utf8", windowsHide: true, timeout: 120_000,
    env: { ...process.env, PYTHONUTF8: "1", ARCHMCP_SITE: ctx.fs("servers", pack, "site"), ARCHMCP_MODULE: module, ...env },
  });

const abletonScriptDir = (ctx) => join(documents(ctx), "Ableton", "User Library", "Remote Scripts", "AbletonMCP");
ADDONS.ableton = {
  targets: () => ["Ableton Live"],
  status: (ctx, t, opts) => {
    const d = abletonScriptDir(ctx);
    if (!existsSync(d)) return { installed: false };
    const marker = readMarker(d);
    return { installed: true, stale: !!opts?.port && marker !== null && marker !== String(opts.port) };
  },
  install: (ctx, t, opts) => attempt("Ableton Live", () => {
    // upstream's own installer finds Live's User Library; we then set the port it listens on
    const r = pyBootstrap(ctx, "ableton", "MCP_Server.remote_script_install:main", []);
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || "installer failed").trim().slice(-300));
    const d = abletonScriptDir(ctx);
    if (!existsSync(d)) throw new Error("the Remote Script was not found in Live's User Library afterwards");
    const files = readdirSync(d).filter((f) => f.endsWith(".py")).map((f) => join(d, f));
    const port = opts?.port ?? 9877;
    const has = files.filter((f) => /DEFAULT_PORT\s*=\s*9877/.test(readFileSync(f, "utf8")));
    for (const f of has) writeFileSync(f, readFileSync(f, "utf8").replace(/DEFAULT_PORT\s*=\s*9877/, `DEFAULT_PORT = ${port}`));
    writeFileSync(join(d, MARKER), String(port));
    return ok("Ableton Live", "installed - in Live: Settings > Link, Tempo & MIDI > Control Surface, choose AbletonMCP");
  }),
  uninstall: () => attempt("Ableton Live", () => {}),
};

// ------------------------------------------------------------------ public API

export const hasAddon = (def) => !!ADDONS[def.addonKind];

/** [{target, installed}] for every place this integration's add-on could live. */
export function addonStatus(ctx, def, opts) {
  const a = ADDONS[def.addonKind];
  if (!a) return [];
  return a.targets(ctx, opts).map((t) => {
    const s = a.status(ctx, t, opts);
    return typeof s === "object" ? { target: t, installed: s.installed, stale: !!s.stale } : { target: t, installed: s, stale: false };
  });
}

/** @param {'install'|'uninstall'} action @param {string} [only] a single target, otherwise all known targets */
export function addonRun(ctx, def, action, opts, only) {
  const a = ADDONS[def.addonKind];
  if (!a) return [];
  const known = a.targets(ctx, opts, action);
  // the GUI sends the target: only ever act on places we ourselves discovered/were configured with
  if (only && !known.includes(only)) return [fail(String(only).slice(0, 200), "unknown target")];
  const targets = only ? [only] : known;
  const res = targets.map((t) => a[action](ctx, t, opts));
  if (action === "install" && !targets.length) return [fail(def.id, "nothing to install into yet - start the application once (or add a project) and try again")];
  return res;
}
