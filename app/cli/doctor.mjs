#!/usr/bin/env node
// "ArchMCP Doctor" in the terminal: same checks as the GUI's Diagnostics page.
//   node doctor.mjs --app-dir <dir>
import { pathToFileURL } from "node:url";
import { addonStatus, hasAddon } from "../lib/addons.mjs";
import { CLIENT_IDS, CLIENT_INFO, clientDetected, clientFiles, clientRegistered } from "../lib/clients.mjs";
import { makeContext } from "../lib/context.mjs";
import { testMcp } from "../lib/health.mjs";
import { REGISTRY, buildEntries, detectApp, isInstalled, keysOf } from "../lib/registry.mjs";
import { loadSettings } from "../lib/settings.mjs";
import { systemCheck } from "../lib/syscheck.mjs";

const ok = (m) => console.log(`  [ OK ] ${m}`);
let failures = 0;
const bad = (m) => { failures++; console.log(`  [FAIL] ${m}`); };
const warn = (m) => console.log(`  [ !! ] ${m}`);

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--app-dir");
  const ctx = makeContext({ appDir: i >= 0 ? argv[i + 1] : undefined });
  const settings = loadSettings(ctx);
  console.log("\nArchMCP Doctor\n==============\n");

  console.log("System");
  for (const r of systemCheck(ctx)) (r.status === "ok" ? ok : r.status === "fail" ? bad : warn)(`${r.id}${r.data?.out ? ` (${r.data.out})` : ""}${r.status === "skip" ? " - skipped" : ""}`);
  console.log("");
  const wanted = buildEntries(ctx, settings);
  const enabledClients = CLIENT_IDS.filter((id) => settings.clients[id].enabled);
  if (!enabledClients.length) warn("no AI app is enabled - turn one on in ArchMCP > Settings > AI apps");
  for (const id of CLIENT_IDS) {
    const name = CLIENT_INFO[id].name, on = settings.clients[id].enabled;
    if (on && !clientDetected(ctx, id)) bad(`${name} is enabled but was not found - install it (and open it once)`);
    for (const f of clientFiles(ctx, id, settings)) {
      if (!f.exists) continue;
      f.valid ? ok(`${name} config: ${f.path}`) : bad(`${name} config is not valid: ${f.path} (${f.error})`);
    }
    if (on) { const reg = clientRegistered(ctx, id, settings); if (reg.length < Object.keys(wanted).length) warn(`${name}: ${reg.length} of ${Object.keys(wanted).length} servers applied - press 'Apply' in ArchMCP`); }
  }
  const registered = Object.fromEntries(clientRegistered(ctx, enabledClients[0] ?? "claude", settings).map((k) => [k, true]));

  for (const def of REGISTRY) {
    const s = settings.mcps[def.id];
    if (def.kind === "cloud") { console.log(`\n${def.id}`); warn("Cloud connector: add it in Claude > Settings > Connectors."); continue; }
    if (!isInstalled(ctx, def)) continue;
    console.log(`\n${def.id}  (${s.enabled ? "enabled" : "disabled"})`);
    const app = detectApp(ctx, def);
    app.found ? ok(`application found${app.versions.length ? `: ${app.versions.join(", ")}` : ""}`) : warn("application not found on this PC");
    const keys = keysOf(def, wanted);
    if (s.enabled && !keys.every((k) => registered[k])) warn("enabled but not yet applied to your AI app(s) - open ArchMCP and press 'Apply'");
    if (!s.enabled && keysOf(def, registered).length) warn("still registered although disabled - press 'Apply' in ArchMCP");
    if (hasAddon(def)) for (const a of addonStatus(ctx, def, s.options)) a.installed ? ok(`add-on installed: ${a.target}`) : warn(`add-on not installed: ${a.target}`);
    if (!s.enabled) continue;
    const entries = Object.fromEntries(Object.entries(wanted).filter(([k]) => keys.includes(k)));
    const r = await testMcp(def, entries, s.options);
    for (const sv of r.servers) sv.ok ? ok(`server starts: ${sv.message}, ${sv.tools} tools`) : bad(`server did not start: ${sv.message}`);
    for (const p of r.ports) p.open ? ok(`${p.label} bridge is listening (:${p.port})`) : warn(`${p.label} bridge not reachable (:${p.port}) - open the application${def.addonKind ? " and start its MCP add-on" : ""}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
  if (process.argv.includes("--strict")) process.exit(failures ? 1 : 0); // CI: any [FAIL] fails the build
  if (process.stdin.isTTY) {
    process.stdout.write("\nPress Enter to close...");
    await new Promise((r) => process.stdin.once("data", r));
  }
  process.exit(0);
}
