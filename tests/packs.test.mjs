import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { crc32 } from "node:zlib";
import { join } from "node:path";
import { fakePc } from "./helpers.mjs";
import { installPack, installedPacks, listZip, loadCatalog, packUpdates, parseCatalog, removePack, verifyCatalog } from "../app/lib/packs.mjs";

// ---------------------------------------------------------------- tiny zip writer (so tests need no external tools)
function zipOf(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name), body = Buffer.from(data), crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(body.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** A valid pack zip for `id` plus its catalog entry. */
function makePack(dir, id, { version = "1.0.0", files = { "site/mod.py": "print(1)", "app/x.txt": "hello" }, mutate } = {}) {
  const manifest = { format: 1, id, version, runtime: "python", tier: "stable", launch: { kind: "module", target: "mod:main" },
    files: Object.fromEntries(Object.entries(files).map(([f, c]) => [f, sha(Buffer.from(c))])) };
  if (mutate) mutate(manifest, files);
  const zip = zipOf({ "pack.json": JSON.stringify(manifest), ...files });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}-${version}.zip`);
  writeFileSync(file, zip);
  return { file, zip, entry: { version, file: `${id}-${version}.zip`, sha256: sha(zip), size: zip.length, tier: "stable", runtime: "python", license: "MIT" } };
}
const catalogOf = (packs) => ({ format: 1, generated: new Date().toISOString(), packs });

// ---------------------------------------------------------------- signatures

test("catalog signature: valid passes; any tampering, wrong key or garbage fails", () => {
  const a = generateKeyPairSync("ed25519"), b = generateKeyPairSync("ed25519");
  const pem = (k) => k.publicKey.export({ type: "spki", format: "pem" });
  const bytes = Buffer.from(JSON.stringify(catalogOf({})));
  const sig = sign(null, bytes, a.privateKey).toString("base64");
  assert.equal(verifyCatalog(bytes, sig, [{ id: "a", pem: pem(a) }]), true);
  assert.equal(verifyCatalog(Buffer.concat([bytes, Buffer.from(" ")]), sig, [{ id: "a", pem: pem(a) }]), false, "tampered bytes");
  assert.equal(verifyCatalog(bytes, sig, [{ id: "b", pem: pem(b) }]), false, "wrong key");
  assert.equal(verifyCatalog(bytes, "not base64!!", [{ id: "a", pem: pem(a) }]), false);
  assert.equal(verifyCatalog(bytes, "", [{ id: "a", pem: pem(a) }]), false);
  assert.equal(verifyCatalog(bytes, sig, [{ id: "b", pem: pem(b) }, { id: "a", pem: pem(a) }]), true, "key rotation: any trusted key");
});

test("catalog parsing rejects path-like ids and malformed hashes", () => {
  const ok = { format: 1, generated: "x", packs: { ableton: { version: "1", file: "ableton-1.zip", sha256: "a".repeat(64), size: 1 } } };
  assert.ok(parseCatalog(Buffer.from(JSON.stringify(ok))));
  assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ ...ok, packs: { "../evil": ok.packs.ableton } }))), /bad pack id/);
  assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ ...ok, packs: { x1: { ...ok.packs.ableton, file: "../../x.zip" } } }))), /bad catalog entry/);
  assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ ...ok, packs: { x1: { ...ok.packs.ableton, sha256: "zz" } } }))), /bad catalog entry/);
  assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ format: 2, packs: {} }))), /unsupported/);
});

// ---------------------------------------------------------------- archive safety

test("zip-slip: archives with escaping or absolute paths are rejected before anything is extracted", () => {
  const pc = fakePc();
  for (const bad of ["../evil.txt", "a/../../evil.txt", "/abs/evil.txt", "C:/Windows/evil.txt", "C:\\evil.txt"]) {
    const f = join(pc.root, "bad.zip");
    writeFileSync(f, zipOf({ "pack.json": "{}", [bad]: "x" }));
    assert.throws(() => listZip(f), /unsafe path/, bad);
  }
  const good = join(pc.root, "good.zip");
  writeFileSync(good, zipOf({ "pack.json": "{}", "site/a.py": "x" }));
  assert.deepEqual(listZip(good).sort(), ["pack.json", "site/a.py"]);
});

// ---------------------------------------------------------------- install

test("install: verified pack lands in servers/<id>, is registered as a component, and can be removed", async () => {
  const pc = fakePc({ installed: [] });
  const p = makePack(join(pc.root, "dl"), "ableton");
  const r = await installPack(pc.ctx, "ableton", { catalog: catalogOf({ ableton: p.entry }), file: p.file });
  assert.deepEqual(r, { ok: true, id: "ableton", version: "1.0.0" });
  assert.equal(readFileSync(join(pc.appDir, "servers", "ableton", "app", "x.txt"), "utf8"), "hello");
  assert.deepEqual(Object.keys(installedPacks(pc.ctx)), ["ableton"]);
  assert.ok(JSON.parse(readFileSync(join(pc.appDir, "components.json"), "utf8")).components.includes("ableton"));
  assert.equal(removePack(pc.ctx, "ableton"), true);
  assert.equal(existsSync(join(pc.appDir, "servers", "ableton")), false);
  assert.ok(!JSON.parse(readFileSync(join(pc.appDir, "components.json"), "utf8")).components.includes("ableton"));
});

test("install: every kind of tampering is refused and leaves no trace", async () => {
  const pc = fakePc({ installed: [] });
  const dir = join(pc.root, "dl");
  const cases = {
    "hash differs from catalog": (p) => ({ ...p.entry, sha256: "0".repeat(64) }),
    "size differs from catalog": (p) => ({ ...p.entry, size: p.entry.size + 1 }),
  };
  for (const [label, entryOf] of Object.entries(cases)) {
    const p = makePack(dir, "rhino");
    await assert.rejects(installPack(pc.ctx, "rhino", { catalog: catalogOf({ rhino: entryOf(p) }), file: p.file }), /catalog/, label);
  }
  // file content does not match the hash listed in pack.json
  const bad = makePack(dir, "maya", { mutate: (m) => { m.files["site/mod.py"] = "f".repeat(64); } });
  await assert.rejects(installPack(pc.ctx, "maya", { catalog: catalogOf({ maya: bad.entry }), file: bad.file }), /hash mismatch/);
  // a file that is not declared in pack.json
  const extra = makePack(dir, "qgis", { mutate: (m) => { delete m.files["app/x.txt"]; } });
  await assert.rejects(installPack(pc.ctx, "qgis", { catalog: catalogOf({ qgis: extra.entry }), file: extra.file }), /unexpected file/);
  // a declared file that is missing
  const missing = makePack(dir, "altium", { mutate: (m) => { m.files["site/ghost.py"] = "0".repeat(64); } });
  await assert.rejects(installPack(pc.ctx, "altium", { catalog: catalogOf({ altium: missing.entry }), file: missing.file }), /missing from pack/);
  // manifest of another pack / another version than the catalog says
  const other = makePack(dir, "nx", { mutate: (m) => { m.id = "inventor"; } });
  await assert.rejects(installPack(pc.ctx, "nx", { catalog: catalogOf({ nx: other.entry }), file: other.file }), /does not belong/);
  const ver = makePack(dir, "etabs", { mutate: (m) => { m.version = "9.9.9"; } });
  await assert.rejects(installPack(pc.ctx, "etabs", { catalog: catalogOf({ etabs: ver.entry }), file: ver.file }), /version mismatch/);
  // not in the (verified) catalog at all
  await assert.rejects(installPack(pc.ctx, "ifc", { catalog: catalogOf({}), file: bad.file }), /not in the \(verified\) catalog/);
  assert.deepEqual(Object.keys(installedPacks(pc.ctx)), []);
  const names = existsSync(join(pc.appDir, "servers")) ? (await import("node:fs")).readdirSync(join(pc.appDir, "servers")) : [];
  assert.deepEqual(names.filter((n) => n.startsWith(".") || ["rhino", "maya", "qgis", "altium", "nx", "etabs", "ifc"].includes(n)), [], "no staging folders or half-installed packs left behind");
});

test("update keeps the working version when the new one is bad (atomic swap)", async () => {
  const pc = fakePc({ installed: [] });
  const dir = join(pc.root, "dl");
  const v1 = makePack(dir, "fusion360", { version: "1.0.0" });
  await installPack(pc.ctx, "fusion360", { catalog: catalogOf({ fusion360: v1.entry }), file: v1.file });
  const v2 = makePack(dir, "fusion360", { version: "2.0.0", mutate: (m) => { m.files["site/mod.py"] = "e".repeat(64); } });
  await assert.rejects(installPack(pc.ctx, "fusion360", { catalog: catalogOf({ fusion360: v2.entry }), file: v2.file }));
  assert.equal(installedPacks(pc.ctx).fusion360.version, "1.0.0");
  assert.deepEqual(packUpdates(pc.ctx, catalogOf({ fusion360: { ...v2.entry } })), [{ id: "fusion360", installed: "1.0.0", available: "2.0.0" }]);
});

test("download over HTTP reports progress and refuses a body larger than the catalog says", async () => {
  const pc = fakePc({ installed: [] });
  const p = makePack(join(pc.root, "srv"), "archicad");
  const big = Buffer.concat([p.zip, Buffer.alloc(p.zip.length + 100000)]);
  const server = createServer((req, res) => res.end(req.url.includes("big") ? big : p.zip));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let last = 0;
    const ok = await installPack(pc.ctx, "archicad", { catalog: catalogOf({ archicad: p.entry }), baseUrl: base, onProgress: (g) => { last = g; } });
    assert.equal(ok.ok, true); assert.equal(last, p.zip.length);
    removePack(pc.ctx, "archicad");
    const lying = { ...p.entry, file: "big-archicad.zip" };
    await assert.rejects(installPack(pc.ctx, "archicad", { catalog: catalogOf({ archicad: lying }), baseUrl: base }), /larger than catalog|size differs/);
    assert.deepEqual(Object.keys(installedPacks(pc.ctx)), []);
  } finally { server.close(); }
});

// ---------------------------------------------------------------- catalog loading

test("loadCatalog: shipped catalog is trusted only when signed; a bad network catalog is ignored with a message", async () => {
  const pc = fakePc({ installed: [] });
  const k = generateKeyPairSync("ed25519");
  const keys = [{ id: "t", pem: k.publicKey.export({ type: "spki", format: "pem" }) }];
  const bytes = Buffer.from(JSON.stringify(catalogOf({ ableton: { version: "1", file: "a-1.zip", sha256: "a".repeat(64), size: 5 } })));
  mkdirSync(join(pc.appDir, "catalog"), { recursive: true });
  writeFileSync(join(pc.appDir, "catalog", "catalog.json"), bytes);
  writeFileSync(join(pc.appDir, "catalog", "catalog.sig"), sign(null, bytes, k.privateKey).toString("base64"));
  let r = await loadCatalog(pc.ctx, { keys });
  assert.equal(r.source, "embedded");
  assert.deepEqual(Object.keys(r.catalog.packs), ["ableton"]);
  // an unsigned/forged embedded catalog is not trusted
  assert.equal(await loadCatalog(pc.ctx, { keys: [{ id: "x", pem: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) }] }), null);
  // network: forged signature is ignored, embedded one stays
  const forged = async (url) => ({ ok: true, arrayBuffer: async () => (url.endsWith("sig") ? Buffer.from("A".repeat(86) + "==", "base64") : bytes) });
  r = await loadCatalog(pc.ctx, { keys, baseUrl: "https://x", refresh: true, fetchImpl: forged });
  assert.equal(r.source, "embedded"); assert.match(r.error, /NOT valid/);
  // network: properly signed newer catalog is accepted and cached
  const newer = Buffer.from(JSON.stringify({ ...catalogOf({ rhino: { version: "2", file: "r-2.zip", sha256: "b".repeat(64), size: 5 } }), generated: "2999-01-01T00:00:00Z" }));
  const good = async (url) => ({ ok: true, arrayBuffer: async () => (url.endsWith("sig") ? Buffer.from(sign(null, newer, k.privateKey).toString("base64")) : newer) });
  r = await loadCatalog(pc.ctx, { keys, baseUrl: "https://x", refresh: true, fetchImpl: good });
  assert.equal(r.source, "network"); assert.deepEqual(Object.keys(r.catalog.packs), ["rhino"]);
  assert.equal((await loadCatalog(pc.ctx, { keys })).source, "cache");
});
