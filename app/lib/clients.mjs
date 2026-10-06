// The AI apps ("clients") ArchMCP can wire its servers into. Claude Desktop is the original target; Codex, Antigravity and
// OpenCode read the same kind of stdio server definition in their own files and formats:
//   claude       JSON  %APPDATA%\Claude\claude_desktop_config.json (+ Microsoft Store copies)   { mcpServers: { name: {command,args,env} } }
//   codex        TOML  %USERPROFILE%\.codex\config.toml  (CODEX_HOME)                          [mcp_servers.name] command/args/env
//   antigravity  JSON  %USERPROFILE%\.gemini\config\mcp_config.json (older: .gemini\antigravity\) { mcpServers: { name: {command,args,env} } }
//   opencode     JSON  %USERPROFILE%\.config\opencode\opencode.json (XDG_CONFIG_HOME)           { mcp: { name: {type:"local",command:[..],environment:{..}} } }
// We only ever touch entries whose name starts with "archmcp-"; everything else in those files is left exactly as it is.
// Every write is backed up first, atomic, and refused for files we cannot parse.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { claudeConfigPaths, claudeInstalled, mergeServers, removeServers } from "./claude.mjs";
import { KEY_PREFIX } from "./registry-util.mjs";

export const CLIENT_IDS = ["claude", "codex", "antigravity", "opencode"];

export const CLIENT_INFO = {
  claude: { name: "Claude Desktop", restart: true },
  codex: { name: "Codex", restart: false },
  antigravity: { name: "Antigravity", restart: false },
  opencode: { name: "OpenCode", restart: false },
};

const MARK_BEGIN = "# >>> ArchMCP managed block: ArchMCP rewrites everything between these two lines >>>";
const MARK_END = "# <<< ArchMCP managed block <<<";
/** A backup name that never overwrites an earlier backup (two writes within the same millisecond get -1, -2, ...). */
function backupName(path) {
  const base = `${path}.archmcp-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let name = base;
  for (let i = 1; exists(name); i++) name = `${base}-${i}`;
  return name;
}
const readText = (path) => readFileSync(path, "utf8").replace(/^﻿/, "");
const SLOW_START_MS = 90_000; // first start of a Python server can take a while on a cold disk / antivirus scan

// ------------------------------------------------------------------ TOML (Codex): a managed block, no TOML library needed

/** TOML string: literal ('...') when possible so Windows backslashes stay readable, otherwise a basic escaped string. */
export function tomlString(s) {
  const v = String(s);
  if (!/['\u0000-\u001f\u007f]/.test(v)) return `'${v}'`;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
}
const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k));

/** The managed block for a set of Claude-shaped entries ({name:{command,args,env}}). */
export function codexBlock(entries) {
  const lines = [MARK_BEGIN];
  for (const [name, e] of Object.entries(entries)) {
    lines.push("", `[mcp_servers.${tomlKey(name)}]`, `command = ${tomlString(e.command)}`);
    lines.push(`args = [${(e.args ?? []).map(tomlString).join(", ")}]`, `startup_timeout_sec = ${SLOW_START_MS / 1000}`);
    const env = Object.entries(e.env ?? {});
    if (env.length) {
      lines.push(`[mcp_servers.${tomlKey(name)}.env]`);
      for (const [k, v] of env) lines.push(`${tomlKey(k)} = ${tomlString(v)}`);
    }
  }
  lines.push(MARK_END);
  return lines.join("\n");
}

const HEADER = /^\s*\[\[?\s*([^\]]*?)\s*\]\]?\s*(#.*)?$/;
const OURS = /^mcp_servers\s*\.\s*"?archmcp-/;

/** Removes our managed block and any stray [mcp_servers.archmcp-*] tables (a duplicate table would make Codex reject the whole file). */
export function stripCodex(text) {
  const out = [];
  let inBlock = false, skipping = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === MARK_BEGIN) { inBlock = true; continue; }
    if (inBlock) { if (line.trim() === MARK_END) inBlock = false; continue; }
    const h = HEADER.exec(line);
    if (h) skipping = OURS.test(h[1]);
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}

export function mergeCodex(text, entries) {
  const base = stripCodex(text ?? "");
  const block = Object.keys(entries).length ? codexBlock(entries) : "";
  return `${base}${base && block ? "\n\n" : ""}${block}${base || block ? "\n" : ""}`;
}

export const keysCodex = (text) => [...new Set([...text.matchAll(/^\s*\[\s*mcp_servers\s*\.\s*"?(archmcp-[A-Za-z0-9_-]+)"?\s*\]/gm)].map((m) => m[1]))];

// ------------------------------------------------------------------ JSON clients

const parseJson = (text) => { const t = text.trim(); return t ? JSON.parse(t) : {}; };

const OPENCODE_SCHEMA = "https://opencode.ai/config.json";
const toOpenCode = (e) => ({ type: "local", command: [e.command, ...(e.args ?? [])], ...(e.env && Object.keys(e.env).length ? { environment: e.env } : {}), enabled: true, timeout: SLOW_START_MS });

function mergeJson(container, map) {
  return (text, entries) => {
    const cfg = parseJson(text ?? "");
    const next = { ...cfg };
    if (container === "mcp" && !next.$schema) next.$schema = OPENCODE_SCHEMA;
    const servers = Object.fromEntries(Object.entries(cfg[container] ?? {}).filter(([k]) => !k.startsWith(KEY_PREFIX)));
    next[container] = { ...servers, ...Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, map(e)])) };
    return JSON.stringify(next, null, 2) + "\n";
  };
}
function stripJson(container) {
  return (text) => {
    const cfg = parseJson(text ?? "");
    if (!cfg[container]) return text;
    const next = { ...cfg, [container]: Object.fromEntries(Object.entries(cfg[container]).filter(([k]) => !k.startsWith(KEY_PREFIX))) };
    return JSON.stringify(next, null, 2) + "\n";
  };
}
const keysJson = (container) => (text) => Object.keys(parseJson(text)[container] ?? {}).filter((k) => k.startsWith(KEY_PREFIX));

// ------------------------------------------------------------------ per-client definitions

const exists = (p) => { try { return existsSync(p); } catch { return false; } };
const anyDirMatch = (dir, re) => { try { return readdirSync(dir).some((n) => re.test(n)); } catch { return false; } };

const FORMATS = {
  json: (container, map = (e) => e) => ({ merge: mergeJson(container, map), strip: stripJson(container), keys: keysJson(container), validate: (t) => { parseJson(t); } }),
  toml: () => ({ merge: mergeCodex, strip: stripCodex, keys: keysCodex, validate: () => {} }),
};

const DEFS = {
  claude: {
    ...FORMATS.json("mcpServers"),
    paths: (ctx, extra = "") => [...claudeConfigPaths(ctx), ...(extra ? [extra] : [])],
    detected: (ctx) => claudeInstalled(ctx),
  },
  codex: {
    ...FORMATS.toml(),
    paths: (ctx) => [join(ctx.env.CODEX_HOME || join(ctx.userProfile, ".codex"), "config.toml")],
    detected: (ctx) => exists(ctx.env.CODEX_HOME || join(ctx.userProfile, ".codex")) || exists(join(ctx.appData, "npm", "codex.cmd")),
  },
  antigravity: {
    ...FORMATS.json("mcpServers"),
    // current location first; the older one is kept in sync only if the user already has it
    paths: (ctx) => [join(ctx.userProfile, ".gemini", "config", "mcp_config.json"), ...[join(ctx.userProfile, ".gemini", "antigravity", "mcp_config.json")].filter(exists)],
    detected: (ctx) => exists(join(ctx.userProfile, ".gemini")) || anyDirMatch(join(ctx.localAppData, "Programs"), /antigravity/i),
  },
  opencode: {
    ...FORMATS.json("mcp", toOpenCode),
    paths: (ctx) => [join(ctx.env.XDG_CONFIG_HOME || join(ctx.userProfile, ".config"), "opencode", "opencode.json")],
    detected: (ctx) => exists(join(ctx.env.XDG_CONFIG_HOME || join(ctx.userProfile, ".config"), "opencode")) || exists(join(ctx.appData, "npm", "opencode.cmd")) || exists(join(ctx.userProfile, ".opencode")),
  },
};

export const clientPaths = (ctx, id, settings) => DEFS[id].paths(ctx, id === "claude" ? settings?.extraClaudeConfig : "");
export const clientDetected = (ctx, id) => { try { return !!DEFS[id].detected(ctx); } catch { return false; } };

/**
 * Applies `mode` ("merge" with entries, or "strip") to every config file of one client.
 * Backs up first, writes atomically, never touches a file that does not parse; "strip" never creates files.
 * @returns {{path:string, ok:boolean, error?:string, created?:boolean}[]}
 */
export function updateClient(ctx, id, settings, mode, entries = {}, log = () => {}) {
  const def = DEFS[id];
  const results = [];
  for (const path of clientPaths(ctx, id, settings)) {
    const has = exists(path);
    if (!has && mode === "strip") continue;
    try {
      let text = null;
      if (has) { text = readText(path); def.validate(text); } else mkdirSync(dirname(path), { recursive: true });
      const out = mode === "merge" ? def.merge(text, entries) : def.strip(text);
      if (out !== text) {
        if (has) copyFileSync(path, backupName(path)); // only when something actually changes
        const tmp = `${path}.archmcp-tmp`;
        writeFileSync(tmp, out, "utf8");
        renameSync(tmp, path); // atomic swap: the AI app never reads a half-written file
      }
      log(`ok ${CLIENT_INFO[id].name} config ${mode === "merge" ? "updated" : "cleaned"}: ${path}`);
      results.push({ path, ok: true, created: !has });
    } catch (e) {
      log(`!! ${path}: ${e.message} - left untouched`);
      results.push({ path, ok: false, error: e instanceof SyntaxError ? `not valid JSON (${e.message})` : e.message });
    }
  }
  return results;
}

/** Our archmcp-* server names currently present in one client's files. */
export function clientRegistered(ctx, id, settings) {
  const found = new Set();
  for (const path of clientPaths(ctx, id, settings)) {
    try { if (exists(path)) for (const k of DEFS[id].keys(readText(path))) found.add(k); } catch { /* unreadable: reported as invalid in the file state */ }
  }
  return [...found].sort();
}

export function clientFiles(ctx, id, settings) {
  return clientPaths(ctx, id, settings).map((path) => {
    if (!exists(path)) return { path, exists: false, valid: null };
    try { DEFS[id].validate(readText(path)); return { path, exists: true, valid: true }; } catch (e) { return { path, exists: true, valid: false, error: e.message }; }
  });
}

/**
 * Settings -> every client: enabled ones get our entries, disabled ones get them removed.
 * Claude's result keeps the shape the installer expects ({results}); the rest is in `clients`.
 */
export function applyClients(ctx, settings, entries, log = () => {}) {
  const clients = {};
  for (const id of CLIENT_IDS) {
    const on = settings.clients?.[id]?.enabled ?? id === "claude";
    clients[id] = on ? updateClient(ctx, id, settings, "merge", entries, log) : updateClient(ctx, id, settings, "strip", {}, log);
  }
  return clients;
}

/** UI/state view of every client. `wanted` = archmcp-* keys that the current settings would register. */
export function clientsState(ctx, settings, wantedKeys) {
  const want = [...wantedKeys].sort();
  return CLIENT_IDS.map((id) => {
    const enabled = settings.clients?.[id]?.enabled ?? id === "claude";
    const registered = clientRegistered(ctx, id, settings);
    const inSync = enabled ? want.length === registered.length && want.every((k, i) => k === registered[i]) : registered.length === 0;
    return { id, name: CLIENT_INFO[id].name, enabled, detected: clientDetected(ctx, id), restart: CLIENT_INFO[id].restart, files: clientFiles(ctx, id, settings), registered: registered.length, inSync };
  });
}

// ------------------------------------------------------------------ backups across all clients

const BACKUP_RE = /\.archmcp-backup-.+$/;

export function listAllBackups(ctx, settings) {
  const out = [];
  for (const id of CLIENT_IDS) {
    for (const cfg of clientPaths(ctx, id, settings)) {
      const dir = dirname(cfg);
      if (!exists(dir)) continue;
      for (const f of readdirSync(dir).filter((n) => n.startsWith(`${basename(cfg)}.`) && BACKUP_RE.test(n))) {
        const full = join(dir, f);
        out.push({ client: id, path: full, target: cfg, file: f, time: statSync(full).mtime.toISOString(), size: statSync(full).size });
      }
    }
  }
  return out.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 80);
}

/** Restores one of OUR backups over its config (after backing up the current file). */
export function restoreAnyBackup(ctx, settings, backupPath) {
  const b = listAllBackups(ctx, settings).find((x) => x.path === backupPath);
  if (!b) throw new Error("not a known ArchMCP backup");
  DEFS[b.client].validate(readText(b.path)); // refuse to restore a file that is itself broken
  if (exists(b.target)) copyFileSync(b.target, backupName(b.target));
  copyFileSync(b.path, b.target);
  return b.target;
}

export { mergeServers, removeServers };
