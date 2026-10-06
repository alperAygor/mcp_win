// Finds the host applications on this PC (plain file checks - no registry, no admin rights).
// Every function returns { found, exe, versions, ... } and never throws.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dirs = (base) => { try { return readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
const firstExisting = (paths) => paths.find((p) => existsSync(p)) ?? null;
const roots = (ctx, ...sub) => ctx.programFiles.map((pf) => join(pf, ...sub));
const versionSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });

export function detectRevit(ctx) {
  const versions = [];
  let exe = null;
  for (const y of [2025, 2026, 2027]) {
    const p = firstExisting(roots(ctx, "Autodesk", `Revit ${y}`).map((d) => join(d, "Revit.exe")));
    if (p) { versions.push(y); exe = p; }
  }
  return { found: versions.length > 0, versions, exe };
}

export function detectAutocad(ctx) {
  const exe = firstExisting(roots(ctx, "Autodesk", "AutoCAD 2026").map((d) => join(d, "acad.exe")));
  return { found: !!exe, exe, versions: exe ? [2026] : [] };
}

export function detectPhotoshop(ctx) {
  for (const base of roots(ctx, "Adobe")) {
    for (const d of dirs(base).filter((n) => /^Adobe Photoshop/i.test(n)).sort(versionSort).reverse()) {
      const exe = join(base, d, "Photoshop.exe");
      if (existsSync(exe)) return { found: true, exe, versions: [d.replace(/^Adobe Photoshop\s*/i, "")] };
    }
  }
  return { found: false, exe: null, versions: [] };
}

export function detectSketchup(ctx) {
  for (const base of roots(ctx, "SketchUp")) {
    for (const d of dirs(base).filter((n) => /^SketchUp/i.test(n)).sort(versionSort).reverse()) {
      const exe = join(base, d, "SketchUp.exe");
      if (existsSync(exe)) return { found: true, exe, versions: [d.replace(/^SketchUp\s*/i, "")] };
    }
  }
  return { found: false, exe: null, versions: [] };
}

export function detectBlender(ctx) {
  const versions = [];
  let exe = null;
  for (const base of roots(ctx, "Blender Foundation")) {
    for (const d of dirs(base).filter((n) => /^Blender \d/.test(n)).sort(versionSort)) {
      const p = join(base, d, "blender.exe");
      if (existsSync(p)) { versions.push(d.replace("Blender ", "")); exe = p; }
    }
  }
  // versions Blender already created a profile for (covers portable/Store installs we cannot see)
  const profile = join(ctx.appData, "Blender Foundation", "Blender");
  for (const v of dirs(profile).filter((n) => /^\d+\.\d+$/.test(n))) if (!versions.includes(v)) versions.push(v);
  versions.sort(versionSort);
  return { found: versions.length > 0, exe, versions };
}

export function detectFreecad(ctx) {
  const versions = [];
  let exe = null;
  const bases = [...ctx.programFiles, join(ctx.localAppData, "Programs")];
  for (const base of bases) {
    for (const d of dirs(base).filter((n) => /^FreeCAD/i.test(n)).sort(versionSort)) {
      const p = join(base, d, "bin", "FreeCAD.exe");
      if (existsSync(p)) { versions.push(d.replace(/^FreeCAD\s*/i, "") || "?"); exe = p; }
    }
  }
  return { found: versions.length > 0, exe, versions };
}

export function detectOpenscad(ctx) {
  const cand = [];
  for (const base of [...ctx.programFiles, join(ctx.localAppData, "Programs")]) {
    for (const d of dirs(base).filter((n) => /^OpenSCAD/i.test(n)).sort(versionSort)) {
      cand.push(join(base, d, "openscad.exe"), join(base, d, "openscad.com"));
    }
  }
  const exe = firstExisting(cand);
  return { found: !!exe, exe, versions: [] };
}

export function detectGodot(ctx) {
  const cand = [];
  const scan = (base, re, sub = "") => {
    for (const n of dirs(base).filter((x) => re.test(x))) {
      try {
        for (const f of readdirSync(join(base, n, sub))) if (/^godot.*\.exe$/i.test(f) && !/console/i.test(f)) cand.push(join(base, n, sub, f));
      } catch { /* ignore */ }
    }
  };
  for (const pf of ctx.programFiles) {
    scan(pf, /^Godot/i);
    scan(join(pf, "Steam", "steamapps", "common"), /^Godot/i);
  }
  scan(join(ctx.localAppData, "Programs"), /^Godot/i);
  // the engine ships as a single .exe people drop wherever they like: look in the usual places
  for (const base of ["Downloads", "Desktop", "Documents", "Godot", "Tools"].map((d) => join(ctx.userProfile, d))) {
    try {
      for (const f of readdirSync(base)) if (/^Godot.*\.exe$/i.test(f) && !/console/i.test(f)) cand.push(join(base, f));
      scan(base, /^Godot/i);
    } catch { /* ignore */ }
  }
  const exe = firstExisting(cand);
  return { found: !!exe, exe, versions: [] };
}

export function detectUnity(ctx) {
  const versions = [];
  let exe = null;
  for (const base of roots(ctx, "Unity", "Hub", "Editor")) {
    for (const v of dirs(base).sort(versionSort)) {
      const p = join(base, v, "Editor", "Unity.exe");
      if (existsSync(p)) { versions.push(v); exe = p; }
    }
  }
  return { found: versions.length > 0, exe, versions };
}

export const DETECTORS = {
  revit: detectRevit, autocad: detectAutocad, photoshop: detectPhotoshop, sketchup: detectSketchup,
  blender: detectBlender, freecad: detectFreecad, openscad: detectOpenscad, godot: detectGodot, unity: detectUnity,
};

/** Adobe's plugin installer agent (ships with Creative Cloud). */
export function findUpia(ctx) {
  return firstExisting(ctx.commonProgramFiles.map((r) => join(r, "Adobe", "Adobe Desktop Common", "RemoteComponents",
    "UPI", "UnifiedPluginInstallerAgent", "UnifiedPluginInstallerAgent.exe")));
}

// ------------------------------------------------------------------ pattern based detection (the long tail of programs)

// Expands one pattern (wildcards per path segment, e.g. Vendor/Product-star/bin/app.exe) under `base`; returns every existing match, sorted.
function expand(base, segments) {
  let level = [base];
  for (const seg of segments) {
    const next = [];
    const re = seg.includes("*") ? new RegExp(`^${seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i") : null;
    for (const dir of level) {
      if (!re) { const p = join(dir, seg); if (existsSync(p)) next.push(p); continue; }
      try { for (const n of readdirSync(dir)) if (re.test(n)) next.push(join(dir, n)); } catch { /* not there */ }
    }
    level = next;
    if (!level.length) return [];
  }
  return level.sort(versionSort);
}

/**
 * Pattern syntax: "Vendor/Product-star/bin/app.exe" (star = wildcard) is searched under every Program Files root; a "LOCAL:" prefix searches
 * %LOCALAPPDATA%, "APPDATA:" %APPDATA%, "HOME:" the user profile and "DRIVE:" the system drive root.
 */
export function detectByPatterns(ctx, patterns, versionOf = (p) => p) {
  const hits = [];
  for (const pat of patterns) {
    const m = /^(LOCAL|APPDATA|HOME|DRIVE):(.*)$/.exec(pat);
    const bases = m ? [{ LOCAL: ctx.localAppData, APPDATA: ctx.appData, HOME: ctx.userProfile, DRIVE: ctx.env.SystemDrive ? `${ctx.env.SystemDrive}\\` : "C:\\" }[m[1]]] : ctx.programFiles;
    for (const b of bases) hits.push(...expand(b, (m ? m[2] : pat).split("/").filter(Boolean)));
  }
  const unique = [...new Set(hits)];
  return { found: unique.length > 0, exe: unique.at(-1) ?? null, versions: [...new Set(unique.map(versionOf))].filter(Boolean), all: unique };
}

/** Pulls "2025", "R2024b", "1.2" ... out of a path for display. */
export const versionFromPath = (p) => /(R?20\d\d[a-z]?|\d+\.\d+(?:\.\d+)?|\d{2,4})(?=[\\/ ]|$)/i.exec(p.split(/[\\/]/).slice(-4, -1).join(" "))?.[1] ?? "";

/** Programs without an installer-detectable location (pure libraries, cloud) report "found" so they are never flagged. */
export const alwaysPresent = () => ({ found: true, exe: null, versions: [] });
