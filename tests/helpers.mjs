import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeContext } from "../app/lib/context.mjs";
import { REGISTRY } from "../app/lib/registry.mjs";

const PACK_SPECS = JSON.parse(readFileSync(new URL("../build/packs.json", import.meta.url), "utf8"));

/** A fake Windows profile + install folder in a temp dir. */
export function fakePc({ installed = REGISTRY.map((d) => d.id), apps = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "am-"));
  const env = {
    APPDATA: join(root, "Roaming"), LOCALAPPDATA: join(root, "Local"), USERPROFILE: join(root, "User"),
    ProgramFiles: join(root, "PF"), CommonProgramFiles: join(root, "CPF"),
  };
  const appDir = join(root, "app");
  const touch = (p, body = "x") => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };
  for (const def of REGISTRY) {
    if (!installed.includes(def.id) || !def.probe) continue;
    // downloadable packs carry a manifest with their launch spec; core integrations just need their probe file
    if (def.pack && PACK_SPECS[def.id]) touch(join(appDir, ...def.probe), JSON.stringify({ format: 1, id: def.id, version: PACK_SPECS[def.id].version, launch: PACK_SPECS[def.id].launch }));
    else touch(join(appDir, ...def.probe));
  }
  for (const y of [2025, 2026, 2027]) {
    touch(join(appDir, "servers", "revit-addin", String(y), "RevitMCPAddin.dll"));
    touch(join(appDir, "servers", "revit-addin", String(y), "RevitMCP.Core.dll"));
  }
  touch(join(appDir, "servers", "freecad-addon", "FreeCADMCP", "InitGui.py"));
  touch(join(appDir, "servers", "unity-package", "com.coplaydev.unity-mcp", "package.json"), "{}");
  mkdirSync(join(env.APPDATA, "Claude"), { recursive: true });
  const ctx = makeContext({ appDir, env, sep: "\\" }); // Windows-style paths even when the tests run on macOS
  const app = (...parts) => touch(join(env.ProgramFiles, ...parts));
  for (const [k, v] of Object.entries(apps)) if (v) app(...k.split("/"));
  return { root, env, appDir, ctx, touch, claudeCfg: join(env.APPDATA, "Claude", "claude_desktop_config.json") };
}

/** Environment for a child process on a fake profile. Windows variable names are case-insensitive, so a real `PROGRAMFILES` would
 *  silently compete with the fake `ProgramFiles`: drop every real variable the fake profile redefines, whatever its spelling. */
export function childEnv(fake) {
  const fakeKeys = new Set(Object.keys(fake).map((k) => k.toLowerCase()));
  const real = Object.fromEntries(Object.entries(process.env).filter(([k]) => !fakeKeys.has(k.toLowerCase())));
  return { ...real, ...fake };
}
