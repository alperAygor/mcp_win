// User settings: <dataDir>/settings.json. The GUI posts arbitrary JSON, so everything is validated against the
// option schema in registry.mjs before it is stored or turned into a Claude config entry.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLIENT_IDS } from "./clients.mjs";
import { REGISTRY, byId, defaultOptions } from "./registry.mjs";

export const SETTINGS_VERSION = 1;
export const LANGS = ["tr", "en"];
export const THEMES = ["auto", "light", "dark"];

export const settingsPath = (ctx) => join(ctx.dataDir, "settings.json");

export function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    language: "tr",
    theme: "auto",
    autoApply: false,           // write Claude's config right after every toggle
    confirmRestart: true,       // ask before closing/reopening Claude Desktop
    extraClaudeConfig: "",      // optional extra claude_desktop_config.json (portable installs)
    catalogUrl: "",             // optional override of where downloadable packs come from
    profiles: {},               // named sets of enabled integrations, e.g. { "Mimari": ["revit","autocad"] }
    clients: Object.fromEntries(CLIENT_IDS.map((id) => [id, { enabled: id === "claude" }])), // AI apps that receive our servers
    consentAcceptedAt: null,
    mcps: Object.fromEntries(REGISTRY.map((d) => [d.id, { enabled: false, options: defaultOptions(d) }])),
  };
}

const str = (v, max = 1024) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").slice(0, max) : "");

/** Coerces one option value to what its schema allows; returns `fallback` for anything invalid. */
export function sanitizeOption(opt, value, fallback) {
  switch (opt.type) {
    case "bool": return typeof value === "boolean" ? value : fallback;
    case "number": { const n = Number(value); return Number.isFinite(n) ? Math.min(opt.max ?? 65535, Math.max(opt.min ?? 0, Math.round(n))) : fallback; }
    case "select": return opt.choices.some((c) => c.value === value) ? value : fallback;
    case "multi": return Array.isArray(value) ? opt.choices.map((c) => c.value).filter((v) => value.includes(v)) : fallback;
    case "text": case "file": case "folder": return typeof value === "string" ? str(value) : fallback;
    case "folders": return Array.isArray(value) ? [...new Set(value.filter((x) => typeof x === "string").map((x) => str(x)).filter(Boolean))].slice(0, 50) : fallback;
    default: return fallback;
  }
}

export function sanitizeOptions(def, input, current = defaultOptions(def)) {
  const out = { ...current };
  for (const opt of def.options) if (input && opt.key in input) out[opt.key] = sanitizeOption(opt, input[opt.key], current[opt.key]);
  return out;
}

/** Merges stored data over defaults, dropping unknown keys and invalid values. */
export function normalizeSettings(raw) {
  const d = defaultSettings();
  const r = raw && typeof raw === "object" ? raw : {};
  const s = { ...d };
  if (LANGS.includes(r.language)) s.language = r.language;
  if (THEMES.includes(r.theme)) s.theme = r.theme;
  for (const k of ["autoApply", "confirmRestart"]) if (typeof r[k] === "boolean") s[k] = r[k];
  s.extraClaudeConfig = str(r.extraClaudeConfig);
  s.catalogUrl = /^https:\/\/[^\s]+$/.test(str(r.catalogUrl)) ? str(r.catalogUrl) : "";
  s.profiles = {};
  for (const [name, ids] of Object.entries(r.profiles && typeof r.profiles === "object" ? r.profiles : {}).slice(0, 20)) {
    const clean = str(name, 40).trim();
    if (clean && Array.isArray(ids)) s.profiles[clean] = [...new Set(ids.filter((i) => typeof i === "string" && byId(i)))];
  }
  for (const id of CLIENT_IDS) if (typeof r.clients?.[id]?.enabled === "boolean") s.clients[id].enabled = r.clients[id].enabled;
  s.consentAcceptedAt = typeof r.consentAcceptedAt === "string" ? str(r.consentAcceptedAt, 40) : null;
  for (const def of REGISTRY) {
    const m = r.mcps?.[def.id] ?? {};
    s.mcps[def.id] = { enabled: m.enabled === true, options: sanitizeOptions(def, m.options) };
  }
  return s;
}

export function loadSettings(ctx) {
  try { return normalizeSettings(JSON.parse(readFileSync(settingsPath(ctx), "utf8").replace(/^﻿/, ""))); }
  catch { return defaultSettings(); }
}

export function saveSettings(ctx, settings) {
  const p = settingsPath(ctx);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(normalizeSettings(settings), null, 2) + "\n", "utf8");
  renameSync(tmp, p);
}

export const settingsExist = (ctx) => existsSync(settingsPath(ctx));

/** Applies a partial update from the GUI ({language, theme, ..., mcps:{id:{enabled, options}}}). */
export function updateSettings(current, patch) {
  const next = structuredClone(current);
  if (LANGS.includes(patch.language)) next.language = patch.language;
  if (THEMES.includes(patch.theme)) next.theme = patch.theme;
  for (const k of ["autoApply", "confirmRestart"]) if (typeof patch[k] === "boolean") next[k] = patch[k];
  if (typeof patch.extraClaudeConfig === "string") next.extraClaudeConfig = str(patch.extraClaudeConfig);
  if (typeof patch.catalogUrl === "string") next.catalogUrl = /^https:\/\/[^\s]+$/.test(patch.catalogUrl.trim()) ? patch.catalogUrl.trim() : "";
  for (const id of CLIENT_IDS) if (typeof patch.clients?.[id]?.enabled === "boolean") next.clients[id].enabled = patch.clients[id].enabled;
  for (const [id, m] of Object.entries(patch.mcps ?? {})) {
    const def = byId(id);
    if (!def || !m || typeof m !== "object") continue;
    if (typeof m.enabled === "boolean") next.mcps[id].enabled = m.enabled;
    if (m.options) next.mcps[id].options = sanitizeOptions(def, m.options, next.mcps[id].options);
  }
  return next;
}

/** Saves the currently enabled set as a named profile. */
export function saveProfile(settings, name, ids) {
  const next = structuredClone(settings);
  const clean = str(name, 40).trim();
  if (!clean) return next;
  next.profiles[clean] = ids.filter((i) => byId(i));
  return next;
}

export function deleteProfile(settings, name) {
  const next = structuredClone(settings);
  delete next.profiles[name];
  return next;
}

/** Enables exactly the integrations of a profile (everything else off). */
export function applyProfile(settings, name) {
  const ids = settings.profiles[name];
  if (!ids) return settings;
  const next = structuredClone(settings);
  for (const def of REGISTRY) next.mcps[def.id].enabled = ids.includes(def.id);
  return next;
}
