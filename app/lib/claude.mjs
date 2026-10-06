// Claude Desktop integration: find its config files, merge/remove our entries safely, back up, restore, restart.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { KEY_PREFIX } from "./registry.mjs";

export { KEY_PREFIX };

/** Returns a new config with our entries replaced and everything else untouched. */
export function mergeServers(config, entries) {
  const servers = { ...(config.mcpServers ?? {}) };
  for (const k of Object.keys(servers)) if (k.startsWith(KEY_PREFIX)) delete servers[k]; // drop stale ones
  return { ...config, mcpServers: { ...servers, ...entries } };
}

export function removeServers(config) {
  if (!config.mcpServers) return config;
  return { ...config, mcpServers: Object.fromEntries(Object.entries(config.mcpServers).filter(([k]) => !k.startsWith(KEY_PREFIX))) };
}

/** Classic installer path + every Microsoft Store (MSIX) package path, which Claude reads instead. */
export function claudeConfigPaths(ctx) {
  const paths = [join(ctx.appData, "Claude", "claude_desktop_config.json")];
  const pk = join(ctx.localAppData, "Packages");
  if (existsSync(pk)) {
    for (const d of readdirSync(pk).filter((n) => /^(Claude|AnthropicPBC\.Claude)/i.test(n))) {
      paths.push(join(pk, d, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"));
    }
  }
  return paths;
}

/** Heuristic: is Claude Desktop installed for this user? */
export function claudeInstalled(ctx) {
  return existsSync(join(ctx.appData, "Claude")) || claudeConfigPaths(ctx).length > 1 ||
    existsSync(join(ctx.localAppData, "AnthropicClaude")) || existsSync(join(ctx.localAppData, "Programs", "Claude"));
}

const readJson = (path) => {
  const raw = readFileSync(path, "utf8").replace(/^﻿/, "").trim();
  return raw ? JSON.parse(raw) : {};
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/**
 * Applies `transform(config) -> config` to every Claude config file. Backs up first, writes atomically, never
 * touches a file that is not valid JSON.
 * @returns {{path:string, ok:boolean, error?:string, created?:boolean}[]}
 */
export function updateClaudeConfigs(ctx, transform, { create, extra = "" } = {}, log = () => {}) {
  const paths = [...claudeConfigPaths(ctx), ...(extra ? [extra] : [])];
  const results = [];
  for (const path of paths) {
    const exists = existsSync(path);
    if (!exists && !create) continue; // uninstall never creates files
    let cfg = {};
    try {
      if (exists) {
        cfg = readJson(path);
        copyFileSync(path, `${path}.archmcp-backup-${stamp()}`);
      } else mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.archmcp-tmp`;
      writeFileSync(tmp, JSON.stringify(transform(cfg), null, 2) + "\n", "utf8");
      renameSync(tmp, path); // atomic swap so Claude never reads a half-written file
      log(`ok Claude config updated: ${path}`);
      results.push({ path, ok: true, created: !exists });
    } catch (e) {
      log(`!! ${path}: ${e.message} - left untouched`);
      results.push({ path, ok: false, error: e instanceof SyntaxError ? `not valid JSON (${e.message})` : e.message });
    }
  }
  return results;
}

/** Which archmcp-* servers are currently registered (union over all config files), with their entries. */
export function registeredServers(ctx, extra = "") {
  const found = {};
  for (const path of [...claudeConfigPaths(ctx), ...(extra ? [extra] : [])]) {
    try {
      for (const [k, v] of Object.entries(readJson(path).mcpServers ?? {})) if (k.startsWith(KEY_PREFIX)) found[k] = v;
    } catch { /* unreadable config: reported by updateClaudeConfigs */ }
  }
  return found;
}

export function configFilesState(ctx, extra = "") {
  return [...claudeConfigPaths(ctx), ...(extra ? [extra] : [])].map((path) => {
    if (!existsSync(path)) return { path, exists: false, valid: null };
    try { readJson(path); return { path, exists: true, valid: true }; } catch (e) { return { path, exists: true, valid: false, error: e.message }; }
  });
}

// ------------------------------------------------------------------ backups

const BACKUP_RE = /\.archmcp-backup-.+$/;

export function listBackups(ctx, extra = "") {
  const out = [];
  for (const cfg of [...claudeConfigPaths(ctx), ...(extra ? [extra] : [])]) {
    const dir = dirname(cfg);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.startsWith(basename(cfg)) && BACKUP_RE.test(n))) {
      const full = join(dir, f);
      out.push({ path: full, target: cfg, file: f, time: statSync(full).mtime.toISOString(), size: statSync(full).size });
    }
  }
  return out.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 50);
}

/** Restores one of OUR backups over its config (after backing up the current file). */
export function restoreBackup(ctx, backupPath, extra = "") {
  const b = listBackups(ctx, extra).find((x) => x.path === backupPath);
  if (!b) throw new Error("not a known ArchMCP backup");
  readJson(b.path); // refuse to restore a file that is itself broken
  if (existsSync(b.target)) copyFileSync(b.target, `${b.target}.archmcp-backup-${stamp()}`);
  copyFileSync(b.path, b.target);
  return b.target;
}

// ------------------------------------------------------------------ process control (Windows)

const isWin = process.platform === "win32";

export function claudeRunning() {
  if (!isWin) return false;
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq claude.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
  return /claude\.exe/i.test(r.stdout ?? "");
}

/** Closes every Claude process (incl. the tray one) and starts it again through its claude:// protocol handler. */
export async function restartClaude() {
  if (!isWin) return { ok: false, message: "only supported on Windows" };
  const wasRunning = claudeRunning();
  if (wasRunning) {
    spawnSync("taskkill", ["/IM", "claude.exe", "/F", "/T"], { windowsHide: true });
    for (let i = 0; i < 20 && claudeRunning(); i++) await new Promise((r) => setTimeout(r, 250));
  }
  const r = spawnSync("cmd", ["/c", "start", "", "claude://"], { windowsHide: true });
  return { ok: r.status === 0, wasRunning, message: r.status === 0 ? "" : "could not start Claude Desktop" };
}
