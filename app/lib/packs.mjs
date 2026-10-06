// Downloadable MCP packs: signed catalog, hash-verified download, safe extraction, install / update / remove.
//
// Trust chain: public key built into the app -> catalog.json (Ed25519 signature) -> every pack's SHA-256 -> every file's
// SHA-256 listed inside pack.json. A pack that fails ANY check is deleted and never touches servers/.
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify as edVerify, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { CATALOG_KEYS } from "./catalog-key.mjs";

const isWin = process.platform === "win32";
const tarExe = () => (isWin ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar");
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const MAX_ENTRIES = 40_000;

export const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// ------------------------------------------------------------------ catalog

/** True when `sig` (base64) is a valid signature of `bytes` by any trusted key. */
export function verifyCatalog(bytes, sigB64, keys = CATALOG_KEYS) {
  let sig;
  try { sig = Buffer.from(String(sigB64).trim(), "base64"); } catch { return false; }
  if (sig.length !== 64) return false;
  return keys.some((k) => { try { return edVerify(null, bytes, createPublicKey(k.pem), sig); } catch { return false; } });
}

export function parseCatalog(bytes) {
  const c = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (c?.format !== 1 || typeof c.packs !== "object") throw new Error("unsupported catalog format");
  for (const [id, p] of Object.entries(c.packs)) {
    if (!ID_RE.test(id)) throw new Error(`bad pack id in catalog: ${id}`);
    if (!/^[0-9a-f]{64}$/.test(p.sha256) || !/^[A-Za-z0-9._-]+\.zip$/.test(p.file)) throw new Error(`bad catalog entry: ${id}`);
  }
  return c;
}

const catalogDirs = (ctx) => ({ embedded: ctx.fs("catalog"), cache: join(ctx.dataDir, "catalog") });

function readSigned(dir, keys) {
  const cj = join(dir, "catalog.json"), cs = join(dir, "catalog.sig");
  if (!existsSync(cj) || !existsSync(cs)) return null;
  const bytes = readFileSync(cj);
  try { return verifyCatalog(bytes, readFileSync(cs, "utf8"), keys) ? { bytes, catalog: parseCatalog(bytes) } : null; } catch { return null; }
}

/**
 * Newest trusted catalog: the shipped one, the cached download, or (when `refresh`) a fresh one from `baseUrl`.
 * Never returns anything that failed signature verification.
 * @returns {{catalog:any, source:'embedded'|'cache'|'network', baseUrl:string, error?:string}|null}
 */
export async function loadCatalog(ctx, { baseUrl = "", refresh = false, fetchImpl = fetch, keys = CATALOG_KEYS } = {}) {
  const dirs = catalogDirs(ctx);
  let best = null;
  for (const [source, dir] of [["embedded", dirs.embedded], ["cache", dirs.cache]]) {
    const r = readSigned(dir, keys);
    if (r && (!best || r.catalog.generated > best.catalog.generated)) best = { catalog: r.catalog, source };
  }
  let error;
  if (refresh && baseUrl) {
    try {
      const [cj, cs] = await Promise.all(["catalog.json", "catalog.sig"].map(async (n) => {
        const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/${n}`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${n}`);
        return Buffer.from(await res.arrayBuffer());
      }));
      if (!verifyCatalog(cj, cs.toString("utf8"), keys)) throw new Error("catalog signature is NOT valid - ignored");
      const parsed = parseCatalog(cj);
      if (!best || parsed.generated >= best.catalog.generated) {
        mkdirSync(dirs.cache, { recursive: true });
        writeFileSync(join(dirs.cache, "catalog.json"), cj);
        writeFileSync(join(dirs.cache, "catalog.sig"), cs);
        best = { catalog: parsed, source: "network" };
      }
    } catch (e) { error = e.message; }
  }
  return best ? { ...best, baseUrl, ...(error ? { error } : {}) } : (error ? { catalog: null, source: "none", baseUrl, error } : null);
}

// ------------------------------------------------------------------ installed packs

export const packDir = (ctx, id) => ctx.fs("servers", id);
export function readManifest(ctx, id) {
  try { return JSON.parse(readFileSync(join(packDir(ctx, id), "pack.json"), "utf8")); } catch { return null; }
}
export function installedPacks(ctx) {
  const out = {};
  try {
    for (const d of readdirSync(ctx.fs("servers"))) {
      if (!ID_RE.test(d)) continue;
      const m = readManifest(ctx, d);
      if (m?.id === d) out[d] = m;
    }
  } catch { /* no servers folder yet */ }
  return out;
}

const cmpVersion = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
export function packUpdates(ctx, catalog) {
  const have = installedPacks(ctx);
  return Object.entries(have).filter(([id, m]) => catalog.packs[id] && cmpVersion(catalog.packs[id].version, m.version) > 0)
    .map(([id, m]) => ({ id, installed: m.version, available: catalog.packs[id].version }));
}

/** components.json bookkeeping. If it does not exist yet (development layout) it is seeded with what is physically present. */
export function setComponent(ctx, id, present, knownIds = []) {
  const file = ctx.fs("components.json");
  let list;
  try { list = new Set(JSON.parse(readFileSync(file, "utf8")).components); } catch { list = new Set(knownIds); }
  present ? list.add(id) : list.delete(id);
  writeFileSync(file, JSON.stringify({ components: [...list].sort() }, null, 2));
}

// ------------------------------------------------------------------ safe extraction

/** Entry names of a zip, rejecting anything that could escape the target folder. Exported for tests. */
export function listZip(file) {
  const r = spawnSync(tarExe(), ["-tf", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`cannot read archive: ${(r.stderr || "").slice(0, 200)}`);
  const names = r.stdout.split(/\r?\n/).filter(Boolean);
  if (names.length > MAX_ENTRIES) throw new Error("archive has too many entries");
  for (const n of names) {
    if (/^([/\\]|[A-Za-z]:)/.test(n) || n.split(/[/\\]/).includes("..") || n.includes("\0")) throw new Error(`unsafe path in archive: ${n.slice(0, 80)}`);
  }
  return names;
}

function extractZip(file, dest) {
  listZip(file);
  mkdirSync(dest, { recursive: true });
  const r = spawnSync(tarExe(), ["-xf", file, "-C", dest], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`extract failed: ${(r.stderr || "").slice(0, 200)}`);
}

function walkFiles(root, dir = root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(root, p, out); else if (e.isFile()) out.push(p.slice(root.length + 1).split(sep).join("/"));
    else throw new Error(`unexpected entry type in pack: ${e.name}`);   // symlinks, devices ...
  }
  return out;
}

/** Verifies an extracted pack against its own manifest: same file set, same hashes, same id/version as the catalog. */
export function verifyExtracted(stage, id, entry) {
  const mf = join(stage, "pack.json");
  if (!existsSync(mf)) throw new Error("pack.json missing");
  const m = JSON.parse(readFileSync(mf, "utf8"));
  if (m.format !== 1 || m.id !== id) throw new Error("pack.json does not belong to this pack");
  if (entry && m.version !== entry.version) throw new Error(`version mismatch: catalog ${entry.version}, pack ${m.version}`);
  const actual = new Set(walkFiles(stage).filter((f) => f !== "pack.json"));
  const listed = new Set(Object.keys(m.files ?? {}));
  for (const f of listed) if (!actual.has(f)) throw new Error(`file missing from pack: ${f}`);
  for (const f of actual) if (!listed.has(f)) throw new Error(`unexpected file in pack: ${f}`);
  for (const [f, h] of Object.entries(m.files)) if (sha256File(join(stage, ...f.split("/"))) !== h) throw new Error(`hash mismatch: ${f}`);
  return m;
}

// ------------------------------------------------------------------ download / install / remove

async function download(url, dest, expectedSize, onProgress, fetchImpl) {
  const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const limit = expectedSize * 1.02 + 4096;
  const out = createWriteStream(dest);
  let got = 0;
  // Plain reader loop with explicit back-pressure. (Readable.fromWeb + pipeline crashed Node's HTTP client with an internal
  // assertion on some runs - a download problem must never take the whole control panel down.)
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > limit) throw new Error("download larger than catalog says");
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
      onProgress?.(got, expectedSize);
    }
    await new Promise((resolve, reject) => { out.once("error", reject); out.end(resolve); });
  } catch (e) {
    out.destroy();
    try { await reader.cancel(); } catch { /* already closed */ }
    throw e;
  }
  return got;
}

/**
 * @param {{catalog:any, baseUrl?:string, file?:string, fetchImpl?:typeof fetch, onProgress?:(got:number,total:number)=>void, log?:(m:string)=>void, knownIds?:string[]}} o
 *   file: install from a local .zip (offline / proxy-blocked PCs) - it must still match the SIGNED catalog hash.
 */
export async function installPack(ctx, id, { catalog, baseUrl = "", file, fetchImpl = fetch, onProgress, log = () => {}, knownIds = [] }) {
  if (!ID_RE.test(id)) throw new Error("bad pack id");
  const entry = catalog?.packs?.[id];
  if (!entry) throw new Error(`"${id}" is not in the (verified) catalog`);
  const tmp = join(ctx.dataDir, "tmp");
  mkdirSync(tmp, { recursive: true });
  const stamp = randomBytes(4).toString("hex");
  const zip = file ?? join(tmp, `${id}-${stamp}.zip`);
  const stage = ctx.fs("servers", `.staging-${id}-${stamp}`);
  const cleanup = () => { rmSync(stage, { recursive: true, force: true }); if (!file) rmSync(zip, { force: true }); };
  try {
    if (!file) {
      if (!baseUrl) throw new Error("no download address configured (versions.json > catalog.baseUrl)");
      log(`download ${entry.file} (${(entry.size / 1048576).toFixed(1)} MB)`);
      await download(`${baseUrl.replace(/\/$/, "")}/${entry.file}`, zip, entry.size, onProgress, fetchImpl);
    }
    if (statSync(zip).size !== entry.size) throw new Error("size differs from the signed catalog");
    if (sha256File(zip) !== entry.sha256) throw new Error("SHA-256 differs from the signed catalog - file rejected");
    mkdirSync(ctx.fs("servers"), { recursive: true });
    extractZip(zip, stage);
    const manifest = verifyExtracted(stage, id, entry);
    const final = packDir(ctx, id), old = ctx.fs("servers", `.old-${id}-${stamp}`);
    if (existsSync(final)) renameSync(final, old);
    try { renameSync(stage, final); } catch (e) { if (existsSync(old)) renameSync(old, final); throw e; }
    rmSync(old, { recursive: true, force: true });
    setComponent(ctx, id, true, knownIds);
    log(`installed ${id} ${manifest.version}`);
    return { ok: true, id, version: manifest.version };
  } finally { cleanup(); }
}

export function removePack(ctx, id, knownIds = []) {
  if (!ID_RE.test(id) || !existsSync(packDir(ctx, id))) return false;
  rmSync(packDir(ctx, id), { recursive: true, force: true });
  setComponent(ctx, id, false, knownIds);
  return true;
}

export { dirname };
