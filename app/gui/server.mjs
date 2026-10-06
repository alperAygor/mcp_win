// ArchMCP's local control panel: a tiny HTTP server on 127.0.0.1 that serves the UI and a JSON API.
// It can rewrite Claude's config, install add-ons and download packs, so every request must prove it comes from our own
// window: random per-launch token, Host/Origin checks (DNS-rebinding / cross-site protection), validated input only.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addonRun, addonStatus, hasAddon } from "../lib/addons.mjs";
import { applySettings } from "../lib/apply.mjs";
import { claudeInstalled, claudeRunning, restartClaude } from "../lib/claude.mjs";
import { clientRegistered, clientsState, listAllBackups, restoreAnyBackup } from "../lib/clients.mjs";
import { testMcp } from "../lib/health.mjs";
import { LOG_NAMES, makeLogger, readLog } from "../lib/log.mjs";
import { installPack, installedPacks, loadCatalog, packUpdates, removePack, sha256File } from "../lib/packs.mjs";
import { analyzePorts, listening, planPorts } from "../lib/ports.mjs";
import { HOW_TO, REGISTRY, buildEntries, byId, detectApp, isInstalled, keysOf } from "../lib/registry.mjs";
import { applyProfile, defaultSettings, deleteProfile, loadSettings, saveProfile, saveSettings, updateSettings } from "../lib/settings.mjs";
import { overall, systemCheck } from "../lib/syscheck.mjs";

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "ui");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png" };
const STATIC = new Set(["index.html", "app.js", "app.css", "i18n.js", "logo.svg", "guides.js", "guides-data.js", "illustrations.js"]);
const isWin = process.platform === "win32";
const MAX_BODY = 64 * 1024;

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Opens a file/folder/URL with the OS default handler. Targets are always chosen by us, never by the client. */
export function openWithOs(target) {
  const [cmd, args] = isWin ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

const PICK_PS = (kind, title) => kind === "folder"
  ? `Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='${title}'; $o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; if($d.ShowDialog($o) -eq 'OK'){ $d.SelectedPath }`
  : `Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='${title}'; $d.Filter='All files (*.*)|*.*'; $o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; if($d.ShowDialog($o) -eq 'OK'){ $d.FileName }`;

/** @param {{ctx:any, token:string, versions?:any, onShutdown?:()=>void, fetchImpl?:typeof fetch}} o */
export function createApp({ ctx, token, versions = {}, onShutdown = () => {}, fetchImpl = fetch }) {
  const log = makeLogger(ctx, "gui");
  let lastBeat = Date.now();
  let port = 0;
  const appCache = new Map();           // detection hits the disk a lot; 4 s is plenty fresh for a UI
  const jobs = new Map();               // pack downloads/installs run in the background; the UI polls /api/jobs/<id>
  let catalogInfo = null;               // last loaded catalog { catalog, source, baseUrl, error? }

  const detect = (def) => {
    const hit = appCache.get(def.id);
    if (hit && Date.now() - hit.t < 4000) return hit.v;
    const v = detectApp(ctx, def);
    appCache.set(def.id, { t: Date.now(), v });
    return v;
  };

  const baseUrl = (settings) => settings.catalogUrl || versions.catalog?.baseUrl || "";
  const knownIds = () => REGISTRY.filter((d) => d.kind === "local" && d.probe && ctx.has(...d.probe)).map((d) => d.id);

  async function ensureCatalog(settings, refresh = false) {
    if (!catalogInfo || refresh) catalogInfo = await loadCatalog(ctx, { baseUrl: baseUrl(settings), refresh, fetchImpl });
    return catalogInfo;
  }

  // ------------------------------------------------------------------ state

  function mcpState(def, settings, wanted, registered, registeredAll, ports) {
    const s = settings.mcps[def.id];
    const installed = isInstalled(ctx, def);
    const app = detect(def);
    const keys = keysOf(def, wanted), regKeys = keysOf(def, registered);
    const warnings = [];
    let status;
    if (def.kind === "cloud") status = "cloud";
    else if (def.kind === "manual") status = "manual";
    else if (!installed) status = "not-installed";
    else if (!s.enabled) status = regKeys.length ? "pending" : "disabled";
    else if (!keys.length) status = "needs-setup";
    else status = keys.every((k) => registeredAll[k]) && regKeys.length === keys.length ? "active" : "pending";
    if (def.kind === "local" && installed && s.enabled) {
      if (!app.found) warnings.push("app-missing");
      if (["godot", "openscad", "matlab", "ansys", "comsol"].includes(def.id) && def.options.some((o) => o.autoDetect)) {
        const k = def.options.find((o) => o.autoDetect).key;
        if (!s.options[k] && !app.exe) warnings.push("path-missing");
      }
      if (def.id === "revit" && !(s.options.versions ?? []).length) warnings.push("no-versions");
      if (def.id === "unity" && !(s.options.projects ?? []).length) warnings.push("no-projects");
      if (ports.some((p) => p.id === def.id && (p.status === "duplicate" || p.status === "foreign"))) warnings.push("port-conflict");
    }
    const addons = hasAddon(def) && installed ? addonStatus(ctx, def, s.options) : [];
    if (s.enabled && addons.some((a) => !a.installed)) warnings.push("addon-missing");
    if (s.enabled && addons.some((a) => a.stale)) warnings.push("addon-stale");
    const pack = installedPacks(ctx)[def.id];
    return {
      id: def.id, kind: def.kind, runtime: def.runtime, category: def.category, tier: def.tier ?? "stable", name: def.name, desc: def.desc, appNote: def.appNote,
      howTo: def.howTo ?? HOW_TO[def.id], cloud: def.cloud, homepage: def.homepage, hasAddon: hasAddon(def), addonKind: def.addonKind ?? null, isPack: !!def.pack,
      packVersion: pack?.version ?? null,
      installed, enabled: s.enabled, options: s.options, schema: def.options, status, warnings,
      app: { found: app.found, exe: app.exe, versions: app.versions }, addons,
    };
  }

  function state() {
    const settings = loadSettings(ctx);
    const wanted = buildEntries(ctx, settings);
    // an integration counts as "applied" when every enabled AI app has it (a disabled app is not expected to)
    const targets = Object.entries(settings.clients).filter(([, c]) => c.enabled).map(([id]) => id);
    const perClient = targets.map((id) => new Set(clientRegistered(ctx, id, settings)));
    const everywhere = [...new Set(perClient.flatMap((x) => [...x]))];
    const registered = Object.fromEntries(everywhere.map((k) => [k, true]));                                              // present in at least one enabled app
    const registeredAll = Object.fromEntries(everywhere.filter((k) => perClient.every((x) => x.has(k))).map((k) => [k, true])); // present in all of them
    const ports = analyzePorts(ctx, settings, listening());
    const mcps = REGISTRY.map((d) => mcpState(d, settings, wanted, registered, registeredAll, ports));
    const cat = catalogInfo?.catalog;
    return {
      version: versions.app?.version ?? "dev", versions, appDir: ctx.appDir, dataDir: ctx.dataDir, platform: process.platform,
      settings: { language: settings.language, theme: settings.theme, autoApply: settings.autoApply, confirmRestart: settings.confirmRestart,
        extraClaudeConfig: settings.extraClaudeConfig, catalogUrl: settings.catalogUrl, consentAcceptedAt: settings.consentAcceptedAt, profiles: settings.profiles, clients: settings.clients },
      claude: { installed: claudeInstalled(ctx), running: claudeRunning(), files: clientsState(ctx, settings, Object.keys(wanted)).find((c) => c.id === "claude").files },
      clients: clientsState(ctx, settings, Object.keys(wanted)),
      mcps,
      pending: mcps.filter((m) => m.status === "pending").map((m) => m.id),
      ports,
      catalog: cat ? { source: catalogInfo.source, generated: cat.generated, error: catalogInfo.error ?? null, baseUrl: baseUrl(settings),
        packs: Object.fromEntries(Object.entries(cat.packs).map(([id, p]) => [id, { version: p.version, size: p.size, installedSize: p.installedSize, tier: p.tier, license: p.license }])),
        updates: packUpdates(ctx, cat) } : { source: "none", error: catalogInfo?.error ?? null, baseUrl: baseUrl(settings), packs: {}, updates: [] },
    };
  }

  function report() {
    const st = state();
    const lines = [`ArchMCP ${st.version} (${st.platform})`, `install: ${st.appDir}`, `claude installed: ${st.claude.installed}, running: ${st.claude.running}`];
    for (const f of st.claude.files) lines.push(`config: ${f.path} exists=${f.exists} valid=${f.valid}`);
    for (const m of st.mcps) if (m.installed || m.kind === "local") lines.push(`${m.id.padEnd(10)} installed=${m.installed} enabled=${m.enabled} status=${m.status}${m.packVersion ? ` pack=${m.packVersion}` : ""}${m.warnings.length ? ` warnings=${m.warnings.join(",")}` : ""}`);
    for (const p of st.ports) lines.push(`port ${p.port} ${p.id} ${p.status}${p.owner ? ` (${p.owner.name})` : ""}`);
    for (const c of systemCheck(ctx)) lines.push(`system ${c.id}: ${c.status}`);
    return lines.join("\n");
  }

  // ------------------------------------------------------------------ settings changes with the follow-up work

  /**
   * Saves a settings change. When an MCP was just switched on, finish what the user obviously wants: pick the detected Revit
   * versions, install the host-application add-on where it is missing, and move to a free port when it would clash.
   */
  const withAll = (patchFn) => {
    const before = loadSettings(ctx);
    const next = patchFn(before);
    const addonResults = [];
    const justEnabled = REGISTRY.filter((d) => d.kind === "local" && isInstalled(ctx, d) && next.mcps[d.id].enabled && !before.mcps[d.id].enabled);
    for (const def of justEnabled) {
      if (def.id === "revit" && !(next.mcps.revit.options.versions ?? []).length) {
        next.mcps.revit.options.versions = detectApp(ctx, def).versions.filter((v) => [2025, 2026, 2027].includes(v));
      }
    }
    // ports first, so a rewritten add-on already carries the final port
    const plan = justEnabled.length || Object.keys(patchFnPorts(before, next)).length ? planPorts(ctx, next, listening({ force: true })) : { changes: {}, notes: [] };
    for (const [id, opts] of Object.entries(plan.changes)) Object.assign(next.mcps[id].options, opts);
    for (const def of REGISTRY) {
      if (def.kind !== "local" || !isInstalled(ctx, def) || !next.mcps[def.id].enabled || !hasAddon(def) || def.id === "unity") continue;
      const justOn = justEnabled.includes(def), portMoved = !!plan.changes[def.id];
      for (const a of addonStatus(ctx, def, next.mcps[def.id].options).filter((x) => !x.installed || x.stale || (portMoved && x.installed))) {
        if (!justOn && !a.stale && !portMoved) continue;
        const r = addonRun(ctx, def, "install", next.mcps[def.id].options, a.target);
        log(`auto add-on ${def.id} ${a.target}: ${r.map((x) => (x.ok ? "ok" : x.message)).join("; ")}`);
        addonResults.push(...r);
      }
    }
    saveSettings(ctx, next);
    appCache.clear();
    let apply = null;
    if (next.autoApply) apply = applySettings(ctx, next, log).results;
    return { state: state(), apply, addonResults, portNotes: plan.notes };
  };
  const patchFnPorts = (a, b) => {
    const out = {};
    for (const def of REGISTRY) if (a.mcps[def.id].options.port !== b.mcps[def.id].options.port) out[def.id] = true;
    return out;
  };

  function startJob(label, work) {
    const id = randomBytes(6).toString("hex");
    const job = { id, label, state: "running", got: 0, total: 0, message: "" };
    jobs.set(id, job);
    work(job).then((r) => { job.state = "done"; job.message = r?.message ?? ""; }, (e) => { job.state = "error"; job.message = e.message; log(`job ${label} failed: ${e.message}`); });
    return job;
  }

  // ------------------------------------------------------------------ actions

  async function action(method, path, body, query) {
    const r = path.split("/").filter(Boolean).slice(1);
    if (method === "GET") {
      if (r[0] === "state") { await ensureCatalog(loadSettings(ctx)); return state(); }
      if (r[0] === "report") return { text: report() };
      if (r[0] === "system") { const checks = systemCheck(ctx); return { overall: overall(checks), checks }; }
      if (r[0] === "ports") { const settings = loadSettings(ctx); const listen = listening({ force: true }); return { rows: analyzePorts(ctx, settings, listen), plan: planPorts(ctx, settings, listen) }; }
      if (r[0] === "jobs" && r[1]) { const j = jobs.get(r[1]); if (!j) throw httpError(404, "unknown job"); return j; }
      if (r[0] === "logs") {
        const name = LOG_NAMES.includes(query.get("name")) ? query.get("name") : "gui";
        return { name, names: LOG_NAMES, text: readLog(ctx, name) };
      }
      if (r[0] === "backups") return { backups: listAllBackups(ctx, loadSettings(ctx)) };
    }
    if (method === "POST") {
      if (r[0] === "heartbeat") { lastBeat = Date.now(); return { ok: true }; }
      if (r[0] === "shutdown") { setTimeout(onShutdown, 100); return { ok: true }; }

      if (r[0] === "settings") {
        log(`settings update: ${Object.keys(body ?? {}).join(",")}`);
        return withAll((cur) => updateSettings(cur, body ?? {}));
      }
      if (r[0] === "reset") { saveSettings(ctx, { ...defaultSettings(), language: loadSettings(ctx).language }); return { state: state() }; }
      if (r[0] === "apply") {
        const res = applySettings(ctx, loadSettings(ctx), log);
        return { results: res.results, clients: res.clients, state: state() };
      }
      if (r[0] === "restart-claude") { log("restart Claude Desktop"); return restartClaude(); }
      if (r[0] === "backups" && r[1] === "restore") {
        const target = restoreAnyBackup(ctx, loadSettings(ctx), String(body?.path ?? ""));
        log(`restored backup -> ${target}`);
        return { ok: true, target, state: state() };
      }

      // ---- profiles
      if (r[0] === "profiles") {
        const settings = loadSettings(ctx);
        const name = String(body?.name ?? "").trim();
        if (r[1] === "save") {
          const ids = REGISTRY.filter((d) => settings.mcps[d.id].enabled).map((d) => d.id);
          saveSettings(ctx, saveProfile(settings, name, ids));
          return { state: state() };
        }
        if (r[1] === "delete") { saveSettings(ctx, deleteProfile(settings, name)); return { state: state() }; }
        if (r[1] === "apply") {
          if (!settings.profiles[name]) throw httpError(404, "unknown profile");
          return withAll((cur) => applyProfile(cur, name));
        }
      }

      // ---- catalog / packs
      if (r[0] === "catalog" && r[1] === "refresh") { const info = await ensureCatalog(loadSettings(ctx), true); return { error: info?.error ?? null, state: state() }; }
      if (r[0] === "packs" && r[1] === "import") {
        const file = String(body?.path ?? "");
        if (!file || !existsSync(file)) throw httpError(400, "file not found");
        const info = await ensureCatalog(loadSettings(ctx));
        const hash = sha256File(file);
        const id = Object.entries(info?.catalog?.packs ?? {}).find(([, p]) => p.sha256 === hash)?.[0];
        if (!id) throw httpError(400, "this file does not match any pack in the signed catalog");
        return { job: startJob(`import ${id}`, () => installPack(ctx, id, { catalog: info.catalog, file, log, knownIds: knownIds() }).then((x) => ({ message: `${x.id} ${x.version}` }))) };
      }
      if (r[0] === "packs" && r[1]) {
        const id = r[1], act = r[2];
        const def = byId(id);
        if (!def || !def.pack) throw httpError(404, "unknown pack");
        if (act === "install") {
          const settings = loadSettings(ctx);
          const info = await ensureCatalog(settings);
          if (!info?.catalog?.packs?.[id]) throw httpError(404, "pack is not in the verified catalog");
          const job = startJob(`install ${id}`, async (j) => {
            const res = await installPack(ctx, id, { catalog: info.catalog, baseUrl: baseUrl(settings), fetchImpl, log, knownIds: knownIds(),
              onProgress: (got, total) => { j.got = got; j.total = total; } });
            appCache.clear();
            return { message: `${res.id} ${res.version}` };
          });
          return { job };
        }
        if (act === "remove") {
          const settings = loadSettings(ctx);
          if (hasAddon(def)) addonRun(ctx, def, "uninstall", settings.mcps[id].options);
          const removed = removePack(ctx, id, knownIds());
          if (settings.mcps[id].enabled) { settings.mcps[id].enabled = false; saveSettings(ctx, settings); }
          appCache.clear();
          log(`removed pack ${id}: ${removed}`);
          return { ok: removed, state: state() };
        }
      }

      // ---- ports
      if (r[0] === "ports" && r[1] === "auto") {
        const settings = loadSettings(ctx);
        const plan = planPorts(ctx, settings, listening({ force: true }));
        const addonResults = [];
        if (Object.keys(plan.changes).length) {
          const out = withAll((cur) => { const n = structuredClone(cur); for (const [id, o] of Object.entries(plan.changes)) Object.assign(n.mcps[id].options, o); return n; });
          for (const id of Object.keys(plan.changes)) {
            const def = byId(id), opts = loadSettings(ctx).mcps[id].options;
            if (hasAddon(def) && addonStatus(ctx, def, opts).some((a) => a.installed)) addonResults.push(...addonRun(ctx, def, "install", opts));
          }
          return { notes: plan.notes, unresolved: plan.unresolved.map((u) => ({ id: u.id, port: u.port, status: u.status })), addonResults, state: out.state };
        }
        return { notes: [], unresolved: plan.unresolved.map((u) => ({ id: u.id, port: u.port, status: u.status })), addonResults, state: state() };
      }

      if (r[0] === "mcp" && r[1]) {
        const def = byId(r[1]);
        if (!def) throw httpError(404, "unknown MCP");
        const settings = loadSettings(ctx);
        const opts = settings.mcps[def.id].options;
        if (r[2] === "test") {
          if (def.kind !== "local") throw httpError(400, "nothing to test");
          const forced = updateSettings(settings, { mcps: { [def.id]: { enabled: true } } }); // test even while disabled
          const all = buildEntries(ctx, forced);
          const keys = keysOf(def, all);
          const entries = Object.fromEntries(Object.entries(all).filter(([k]) => keys.includes(k)));
          if (!isInstalled(ctx, def)) return { ok: false, servers: [{ key: def.id, ok: false, message: "not installed" }], ports: [] };
          if (!Object.keys(entries).length) return { ok: false, servers: [{ key: def.id, ok: false, message: "nothing to start - finish the settings first" }], ports: [] };
          const res = await testMcp(def, entries, opts);
          log(`test ${def.id}: ${res.ok ? "ok" : "FAILED"} ${res.servers.map((s) => `${s.key}=${s.ok ? `${s.tools} tools ${s.ms}ms` : s.message}`).join("; ")}`);
          return res;
        }
        if (r[2] === "addon") {
          if (!hasAddon(def)) throw httpError(400, "no add-on");
          if (!["install", "uninstall"].includes(body?.action)) throw httpError(400, "bad action");
          const results = addonRun(ctx, def, body.action, opts, body.target);
          log(`addon ${def.id} ${body.action}: ${results.map((x) => `${x.target}=${x.ok ? "ok" : x.message}`).join("; ")}`);
          return { results, state: state() };
        }
        if (r[2] === "open-app") {
          const app = detect(def);
          if (!app.exe || !existsSync(app.exe)) throw httpError(404, "application not found");
          if (isWin) spawn(app.exe, [], { detached: true, stdio: "ignore" }).unref(); else openWithOs(app.exe);
          return { ok: true };
        }
      }

      if (r[0] === "open") {
        const targets = {
          "sketchup-page": byId("sketchup").cloud.page, "install-dir": ctx.appDir, "data-dir": ctx.dataDir,
          "guide": join(ctx.appDir, "docs", `GUIDE.${loadSettings(ctx).language}.html`),
          "notices": join(ctx.appDir, "THIRD_PARTY_NOTICES.md"), "sbom": join(ctx.appDir, "sbom.json"),
          "pack-folder": join(ctx.dataDir, "packs"),
        };
        const homepage = REGISTRY.find((d) => d.id === body?.id)?.homepage;
        const t = body?.what === "homepage" && homepage?.startsWith("https://") ? homepage : targets[body?.what];
        if (!t) throw httpError(400, "unknown target");
        openWithOs(t);
        return { ok: true };
      }
      if (r[0] === "pick") {
        if (!isWin) throw httpError(501, "file dialogs are only available on Windows");
        const kind = body?.kind === "folder" ? "folder" : "file";
        const title = String(body?.title ?? "").replace(/[^\p{L}\p{N} .,:()\-]/gu, "").slice(0, 80);
        const out = spawnSync("powershell", ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", PICK_PS(kind, title)], { encoding: "utf8", windowsHide: true, timeout: 300_000 });
        return { path: (out.stdout ?? "").trim() || null };
      }
    }
    throw httpError(404, "not found");
  }

  // ------------------------------------------------------------------ http plumbing

  const send = (res, status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, {
      "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(httpError(413, "body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(httpError(400, "bad json")); } });
    req.on("error", reject);
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // DNS-rebinding guard: only our own origin may talk to us
      const host = String(req.headers.host ?? "");
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: "bad host" });

      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET") return send(res, 405, { error: "method" });
        const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (!STATIC.has(name) || !existsSync(join(UI_DIR, name))) return send(res, 404, { error: "not found" });
        return send(res, 200, readFileSync(join(UI_DIR, name)), MIME[extname(name)] ?? "application/octet-stream");
      }

      if (!same(req.headers["x-archmcp-token"] ?? "", token)) return send(res, 401, { error: "unauthorized" });
      if (req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && origin !== `http://127.0.0.1:${port}`) return send(res, 403, { error: "bad origin" });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "json only" });
      }
      const body = req.method === "POST" ? await readBody(req) : undefined;
      return send(res, 200, await action(req.method ?? "GET", url.pathname, body, url.searchParams));
    } catch (e) {
      const status = e.status ?? 500;
      if (status >= 500) log(`ERROR ${req.method} ${req.url}: ${e.stack ?? e}`);
      return send(res, status, { error: e.message ?? String(e) });
    }
  });

  return {
    server, log,
    setPort: (p) => { port = p; },
    idleMs: () => Date.now() - lastBeat,
    touch: () => { lastBeat = Date.now(); },
  };
}
