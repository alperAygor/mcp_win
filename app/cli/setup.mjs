#!/usr/bin/env node
// Runs at install/uninstall time with the bundled Node (no PowerShell quirks, no system Node needed).
//   node setup.mjs --action install   --app-dir <dir> --components revit:2025+2026,photoshop,autocad:unsafe,blender,freecad,openscad,godot,unity [--clients claude,codex,antigravity,opencode] [--consent]
//   node setup.mjs --action uninstall --app-dir <dir>
// Exit codes: 0 ok, 1 usage/hard failure, 2 finished but something needs manual follow-up.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { addonRun, hasAddon } from "../lib/addons.mjs";
import { applySettings } from "../lib/apply.mjs";
import { CLIENT_IDS, updateClient } from "../lib/clients.mjs";
import { makeContext } from "../lib/context.mjs";
import { REGISTRY, byId } from "../lib/registry.mjs";
import { loadSettings, saveSettings, updateSettings } from "../lib/settings.mjs";
import { appendFileSync } from "node:fs";

/** "revit:2025+2026,photoshop,autocad:unsafe,blender" -> { revit:{versions:[..]}, photoshop:{}, autocad:{unsafe:true}, ... } */
export function parseComponents(arg = "") {
  const out = {};
  for (const part of arg.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [id, rest = ""] = part.split(":");
    if (!byId(id)) continue;
    out[id] = {};
    if (id === "revit") out[id].versions = rest.split("+").map(Number).filter(Boolean);
    if (rest === "unsafe") out[id].unsafe = true;
  }
  return out;
}

/** "claude,codex" -> ["claude","codex"] (unknown names dropped). `undefined` when the flag was not given: keep the current choice. */
export function parseClients(arg) {
  if (arg === undefined) return undefined;
  return [...new Set(arg.split(",").map((s) => s.trim().toLowerCase()).filter((id) => CLIENT_IDS.includes(id)))];
}

/** Turns the installer's component choice into a settings patch. */
export function componentsToPatch(comps) {
  const mcps = {};
  for (const [id, c] of Object.entries(comps)) {
    mcps[id] = { enabled: true };
    if (id === "revit") mcps[id].options = { versions: c.versions ?? [] };
    if (id === "autocad" && c.unsafe) mcps[id].options = { rawCommands: true };
  }
  return { mcps };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const action = arg("action");
  const appDir = arg("app-dir");
  if (!["install", "uninstall"].includes(action) || !appDir) {
    console.error("usage: setup.mjs --action install|uninstall --app-dir <dir> [--components ...] [--consent]");
    process.exit(1);
  }
  const ctx = makeContext({ appDir });
  mkdirSync(join(appDir, "logs"), { recursive: true });
  const logFile = join(appDir, "logs", `setup-${action}.log`);
  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { appendFileSync(logFile, line + "\n"); } catch { /* logging must never fail setup */ }
  };
  let manual = false;
  const step = (label, fn) => { try { if (fn() === false) manual = true; } catch (e) { log(`!! ${label} failed: ${e.stack ?? e}`); manual = true; } };
  const report = (results, { ignoreEmpty = true } = {}) => {
    let allOk = true;
    for (const r of results) {
      if (ignoreEmpty && !r.ok && /^nothing to install/.test(r.message)) { log(`-- ${r.target}: ${r.message}`); continue; }
      log(`${r.ok ? "ok" : "!!"} ${r.target}${r.message ? `: ${r.message}` : ""}`);
      if (!r.ok) allOk = false;
    }
    return allOk;
  };

  if (action === "install") {
    const comps = parseComponents(arg("components"));
    step("record components", () => {
      // downloaded packs were installed after the main setup: re-running (or upgrading) the installer must not forget them
      let kept = [];
      try { kept = JSON.parse(readFileSync(ctx.fs("components.json"), "utf8")).components.filter((id) => byId(id)?.pack); } catch { /* first install */ }
      writeFileSync(ctx.fs("components.json"), JSON.stringify({ components: [...new Set([...Object.keys(comps), ...kept])].sort() }, null, 2));
    });
    let settings = updateSettings(loadSettings(ctx), componentsToPatch(comps));
    const clients = parseClients(arg("clients"));
    if (clients) settings = updateSettings(settings, { clients: Object.fromEntries(CLIENT_IDS.map((id) => [id, { enabled: clients.includes(id) }])) });
    if (argv.includes("--consent")) settings.consentAcceptedAt = new Date().toISOString();
    step("save settings", () => { saveSettings(ctx, settings); });
    try { mkdirSync(ctx.fs("servers", "photoshop", "extensions"), { recursive: true }); } catch { /* only with Photoshop */ }
    for (const id of Object.keys(comps)) {
      const def = byId(id);
      if (!hasAddon(def)) continue;
      step(`${id} add-on`, () => report(addonRun(ctx, def, "install", settings.mcps[id].options)));
    }
    step("AI app configs", () => {
      const { clients: done } = applySettings(ctx, settings, log);
      let allOk = true;
      for (const id of CLIENT_IDS) {
        if (!settings.clients[id].enabled) continue;
        if (!done[id].some((r) => r.ok)) log(`!! no ${id} config written - is it installed?`);
        if (!done[id].length || !done[id].every((r) => r.ok)) allOk = false;
      }
      return allOk;
    });
  } else {
    const settings = loadSettings(ctx);
    // every step runs even if an earlier one fails, so nothing of ours is left behind needlessly
    // our entries are removed from EVERY supported AI app, whether or not it is currently enabled
    for (const id of CLIENT_IDS) step(`${id} config`, () => updateClient(ctx, id, settings, "strip", {}, log).every((r) => r.ok));
    for (const def of REGISTRY) {
      // Unity packages live inside the user's own projects (maybe under version control): never removed behind their back.
      if (!hasAddon(def) || def.id === "unity") continue;
      step(`${def.id} add-on`, () => report(addonRun(ctx, def, "uninstall", settings.mcps[def.id].options), { ignoreEmpty: true }));
    }
  }
  process.exit(manual ? 2 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
