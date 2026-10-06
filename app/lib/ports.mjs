// Port manager: several integrations default to the SAME port (Blender, Bonsai, Fusion and QGIS all use 9876), and other
// programs on the PC may already hold the ones we need. This finds the clashes and, where the integration lets us pick a
// port, assigns a free one.
//
// Where a port can be changed (the `side` of each claim):
//   server      the MCP server itself opens it            -> we pick it (env/arg) - fully automatic
//   host-patch  the host app's add-on opens it            -> we pick it AND rewrite the add-on we install (automatic)
//   host-manual the user must also set it in the host app -> we pick it and the guide shows exactly where to type it
//   fixed       hard-coded upstream                       -> only reported
import { spawnSync } from "node:child_process";
import { REGISTRY, isInstalled } from "./registry.mjs";

const isWin = process.platform === "win32";
let cache = { t: 0, v: null };

/** @returns {Map<number,{pid:number,name:string}>} TCP ports currently LISTENING on this PC (cached for 2 s). */
export function listening({ force = false } = {}) {
  if (!force && cache.v && Date.now() - cache.t < 2000) return cache.v;
  const map = new Map();
  try {
    if (isWin) {
      const ns = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true, timeout: 10_000 }).stdout ?? "";
      const names = new Map();
      const tl = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 10_000 }).stdout ?? "";
      for (const line of tl.split(/\r?\n/)) { const m = /^"([^"]+)","(\d+)"/.exec(line); if (m) names.set(Number(m[2]), m[1]); }
      for (const m of parseNetstat(ns)) map.set(m.port, { pid: m.pid, name: names.get(m.pid) ?? "?" });
    } else {
      const out = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], { encoding: "utf8", timeout: 10_000 }).stdout ?? "";
      let pid = 0, name = "";
      for (const l of out.split("\n")) {
        if (l[0] === "p") pid = Number(l.slice(1)); else if (l[0] === "c") name = l.slice(1);
        else if (l[0] === "n") { const m = /:(\d+)$/.exec(l); if (m) map.set(Number(m[1]), { pid, name }); }
      }
    }
  } catch { /* an unreadable port table must never break the app */ }
  cache = { t: Date.now(), v: map };
  return map;
}

/** Parses `netstat -ano -p TCP` output (exported for tests). */
export function parseNetstat(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.trim().split(/\s+/);
    if (c.length < 5 || c[0] !== "TCP" || c[3] !== "LISTENING") continue;
    const i = c[1].lastIndexOf(":");
    const port = Number(c[1].slice(i + 1)), pid = Number(c[4]);
    if (Number.isInteger(port) && Number.isInteger(pid)) out.push({ port, pid, address: c[1].slice(0, i) });
  }
  return out;
}

const norm = (n) => String(n).toLowerCase();

/** The claims (port needs) of one definition with the user's options applied. */
export function claimsOf(def, options) {
  const raw = def.portClaims?.(options) ?? def.ports?.(options) ?? [];
  return raw.map((p) => ({ ...p, range: p.range ?? 1 }));
}

/**
 * Analyses every enabled, installed local integration.
 * status: free | host (held by the expected program: normal) | foreign (another program holds it) | duplicate (another of OUR integrations claims it)
 */
export function analyzePorts(ctx, settings, listen = listening()) {
  const rows = [];
  const claimedBy = new Map();
  for (const def of REGISTRY) {
    const s = settings.mcps[def.id];
    if (!s?.enabled || def.kind !== "local" || !isInstalled(ctx, def)) continue;
    for (const c of claimsOf(def, s.options)) {
      const row = { id: def.id, label: c.label, port: c.port, range: c.range, side: c.side ?? "fixed", option: c.option ?? null, hostProcess: c.hostProcess ?? [], status: "free", owner: null, clash: null };
      for (let p = c.port; p < c.port + c.range; p++) {
        const holder = listen.get(p);
        if (holder) {
          const expected = row.hostProcess.some((h) => norm(holder.name).includes(norm(h).replace(/\.exe$/, "")));
          row.owner = holder; row.status = expected ? "host" : "foreign";
          if (!expected) break;
        }
      }
      const first = claimedBy.get(c.port);
      if (first && first !== def.id) { row.status = "duplicate"; row.clash = first; } else claimedBy.set(c.port, def.id);
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Chooses new ports for clashing claims that can be changed. Returns { changes:{id:{option:value}}, notes:[], unresolved:[] }.
 * The first integration (registry order) keeps its port; later duplicates and ones blocked by foreign programs move.
 */
export function planPorts(ctx, settings, listen = listening()) {
  const rows = analyzePorts(ctx, settings, listen);
  const taken = new Set([...listen.keys()]);
  for (const r of rows) if (r.status === "free" || r.status === "host") for (let p = r.port; p < r.port + r.range; p++) taken.add(p);
  const changes = {}, notes = [], unresolved = [];
  for (const r of rows) {
    if (r.status !== "duplicate" && r.status !== "foreign") continue;
    if (!r.option || r.side === "fixed") { unresolved.push(r); continue; }
    let np = r.port + 1;
    while (taken.has(np) && np < 65000) np++;
    taken.add(np);
    (changes[r.id] ??= {})[r.option] = np;
    notes.push({ id: r.id, label: r.label, from: r.port, to: np, side: r.side, reason: r.status === "duplicate" ? `shares the port with ${r.clash}` : `held by ${r.owner?.name ?? "another program"}` });
  }
  return { changes, notes, unresolved, rows };
}

/** A free TCP port at or above `start` (for tests and manual suggestions). */
export function freePortFrom(start, listen = listening()) { let p = start; while (listen.has(p)) p++; return p; }
