#!/usr/bin/env node
// Builds the downloadable MCP packs + the signed catalog.
//   node build/build-packs.mjs [--only id,id] [--out dist/packs] [--key <private.pem>] [--pin]
//
// A pack is a zip: pack.json (id, version, launch, sha256 of EVERY file) + the files that extract to servers/<id>/.
// Supply chain: Python packs install only hash-locked wheels (build/locks/*.txt, `pip --require-hashes --no-deps`), npm packs
// `npm ci` from an integrity-pinned lockfile, git sources are pinned to a full commit, release binaries to a SHA-256.
// The catalog (catalog.json) lists every pack with its SHA-256 and is signed with Ed25519 (catalog.sig); the app refuses
// anything whose signature or hash does not match.

import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign } from "node:crypto";
import {
  copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS = JSON.parse(readFileSync(join(ROOT, "build", "packs.json"), "utf8"));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(ROOT, flag("out", "dist/packs"));
const CACHE = join(ROOT, "build", ".cache", "packs");
const only = flag("only") ? new Set(flag("only").split(",")) : null;
const isWin = process.platform === "win32";
const PIN = argv.includes("--pin");
// --native-test: install wheels for THIS machine (no hashes, no Windows-only packages) so a pack can be started locally.
// Never used for releases - only to exercise the install/launch pipeline on a developer Mac/Linux box.
const NATIVE = argv.includes("--native-test");

const step = (m) => console.log(`\n==> ${m}`);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: isWin && /^(npm|npx)$/.test(cmd), ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full)); else if (e.isFile()) out.push(full);
  }
  return out;
}

function cloneAt(repo, commit) {
  const name = repo.replace(/^.*github\.com\//, "").replace(/\.git$/, "").replace("/", "__");
  const src = join(CACHE, "git", name);
  if (!existsSync(join(src, ".git"))) {
    rmSync(src, { recursive: true, force: true });
    mkdirSync(dirname(src), { recursive: true });
    run("git", ["clone", "--filter=blob:none", "--no-checkout", repo, src]);
  }
  run("git", ["fetch", "origin", commit], { cwd: src, stdio: "ignore" });
  run("git", ["checkout", "--force", commit], { cwd: src, stdio: "ignore" });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: src, encoding: "utf8" }).stdout.trim();
  if (head !== commit) throw new Error(`pinned commit ${commit} resolved to ${head}`);
  return src;
}

function pipInstallLocked(id, site) {
  const lock = join(ROOT, "build", "locks", `${id}.txt`);
  if (!existsSync(lock)) throw new Error(`missing lock file ${lock} - run: python build/lock_packs.py ${id}`);
  mkdirSync(site, { recursive: true });
  if (NATIVE) {
    const names = readFileSync(lock, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split(" --hash")[0]).filter((l) => !/^(pywin32|pywin32-ctypes|openseespywin|comtypes)==/.test(l));
    const tmp = join(CACHE, `native-${id}.txt`);
    writeFileSync(tmp, names.join("\n") + "\n");
    run(process.env.PYTHON ?? "python3", ["-m", "pip", "install", "--disable-pip-version-check", "--no-compile", "--no-deps", "--target", site, "-r", tmp]);
    return;
  }
  const base = ["-m", "pip", "install", "--disable-pip-version-check", "--no-compile", "--only-binary=:all:", "--require-hashes", "--no-deps", "-r", lock];
  if (isWin) {
    const py = process.env.ARCHMCP_BUILD_PYTHON ?? "python";
    run(py, [...base, "--target", site]);
  } else {
    run(process.env.PYTHON ?? "python3", [...base, "--platform", "win_amd64", "--implementation", "cp", "--python-version", "3.12", "--ignore-requires-python", "--target", site]);
  }
}

function applyPatches(stage, patches = []) {
  for (const p of patches) {
    const file = join(stage, p.file);
    let text = readFileSync(file, "utf8");
    if (!text.includes(p.from)) throw new Error(`patch for ${p.file} no longer matches upstream (looking for: ${p.from.slice(0, 60)})`);
    text = p.all ? text.split(p.from).join(p.to) : text.replace(p.from, p.to);
    writeFileSync(file, text);
    console.log(`  patched ${p.file}`);
  }
}

// Direct release-download URL: no GitHub API call, so no rate limit on shared CI runners (the SHA-256 pin verifies the bytes anyway).
async function ghAsset(repo, tag, asset) {
  const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "archmcp-build" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function buildOne(id, spec) {
  step(`${id} ${spec.version} (${spec.runtime}, ${spec.tier})`);
  const stage = join(CACHE, "stage", id);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const source = {};

  if (spec.runtime === "python") {
    pipInstallLocked(id, join(stage, "site"));
    if (spec.local) {
      const dir = join(ROOT, spec.local);
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && existsSync(join(dir, e.name, "__init__.py"))) cpSync(join(dir, e.name), join(stage, "site", e.name), { recursive: true });
      }
      source.local = spec.local;
    }
  } else if (spec.runtime === "node") {
    const lockDir = join(ROOT, "build", "locks", "npm", id);
    copyFileSync(join(lockDir, "package.json"), join(stage, "package.json"));
    copyFileSync(join(lockDir, "package-lock.json"), join(stage, "package-lock.json"));
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage });
    rmSync(join(stage, "node_modules", ".bin"), { recursive: true, force: true }); // symlinks/shims: never needed, and a pack must not contain links
    if (!existsSync(join(stage, spec.launch.path))) throw new Error(`launch file missing after npm ci: ${spec.launch.path}`);
  } else if (spec.runtime === "exe") {
    const bin = await ghAsset(spec.release.repo, spec.release.tag, spec.release.asset);
    const got = createHash("sha256").update(bin).digest("hex");
    if (spec.release.sha256 && spec.release.sha256 !== got) throw new Error(`${id}: release asset hash mismatch\n expected ${spec.release.sha256}\n got      ${got}`);
    if (!spec.release.sha256) {
      if (!PIN) throw new Error(`${id}: release asset is not pinned. Run with --pin once to record sha256 ${got}`);
      spec.release.sha256 = got;
      writeFileSync(join(ROOT, "build", "packs.json"), JSON.stringify(PACKS, null, 2) + "\n");
      console.log(`  pinned ${spec.release.asset} sha256=${got}`);
    }
    mkdirSync(join(stage, dirname(spec.launch.path)), { recursive: true });
    writeFileSync(join(stage, spec.launch.path), bin);
    source.release = { ...spec.release };
  }

  // single files fetched from an immutable URL (a commit-pinned raw.githubusercontent link) and verified against a recorded SHA-256
  for (const f of spec.fetch ?? []) {
    if (!/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.test(f.url)) throw new Error(`${id}: fetch URL must be pinned to a full commit: ${f.url}`);
    const res = await fetch(f.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${f.url}`);
    const data = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(data).digest("hex");
    if (f.sha256 && f.sha256 !== got) throw new Error(`${id}: fetched file hash mismatch for ${f.url}`);
    if (!f.sha256) {
      if (!PIN) throw new Error(`${id}: fetched file is not pinned. Run with --pin once to record sha256 ${got}`);
      f.sha256 = got;
      writeFileSync(join(ROOT, "build", "packs.json"), JSON.stringify(PACKS, null, 2) + "\n");
      console.log(`  pinned ${f.to} sha256=${got}`);
    }
    mkdirSync(dirname(join(stage, f.to)), { recursive: true });
    writeFileSync(join(stage, f.to), data);
  }

  if (spec.git) {
    const src = cloneAt(spec.git.repo, spec.git.commit);
    for (const [from, to] of spec.copy ?? []) {
      const s = join(src, from);
      if (!existsSync(s)) throw new Error(`${id}: upstream path missing: ${from}`);
      mkdirSync(dirname(join(stage, to)), { recursive: true });
      cpSync(s, join(stage, to), { recursive: true });
    }
    applyPatches(stage, spec.patches);
    source.git = spec.git;
  } else if (spec.patches) applyPatches(stage, spec.patches);

  // upstream sources must at least PARSE: one popular repo has a commit with pasted "...truncated..." text in the middle of a file
  if (spec.runtime === "python" && existsSync(join(stage, "app"))) {
    const py = process.env.ARCHMCP_PACK_PYTHON ?? process.env.PYTHON ?? "python3";
    const ver = spawnSync(py, ["-c", "import sys;print(sys.version_info[0]*100+sys.version_info[1])"], { encoding: "utf8" });
    if (Number(ver.stdout) >= 312) {
      const r = spawnSync(py, ["-m", "compileall", "-q", "-f", join(stage, "app")], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`${id}: upstream source does not compile:\n${(r.stdout + r.stderr).slice(0, 600)}`);
      for (const f of walk(join(stage, "app"))) if (f.endsWith(".pyc") || f.includes("__pycache__")) rmSync(f, { force: true });
    } else console.log("  (skipping source syntax check: needs Python >= 3.12 in PYTHON/ARCHMCP_PACK_PYTHON)");
  }

  // byte-compile at build time (Windows only: .pyc must match the bundled interpreter) -> noticeably faster server start
  if (isWin && spec.runtime === "python") {
    const py = process.env.ARCHMCP_PACK_PYTHON;
    if (py) run(py, ["-m", "compileall", "-q", "-j", "0", join(stage, "site"), ...(existsSync(join(stage, "app")) ? [join(stage, "app")] : [])], { stdio: "ignore" });
  }

  const files = {};
  for (const f of walk(stage).sort()) files[relative(stage, f).split(sep).join("/")] = sha256(f);
  const manifest = { format: 1, id, version: spec.version, runtime: spec.runtime, tier: spec.tier, launch: spec.launch, license: spec.license,
    homepage: spec.homepage, source, built: new Date().toISOString(), files };
  writeFileSync(join(stage, "pack.json"), JSON.stringify(manifest, null, 2));

  mkdirSync(OUT, { recursive: true });
  const zip = join(OUT, `${id}-${spec.version}.zip`);
  rmSync(zip, { force: true });
  run("tar", ["-a", "-cf", zip, "-C", stage, ...readdirSync(stage)]);
  const size = statSync(zip).size;
  console.log(`  ${basename(zip)}  ${(size / 1048576).toFixed(1)} MB  ${Object.keys(files).length} files`);
  return {
    version: spec.version, file: basename(zip), sha256: sha256(zip), size,
    installedSize: Object.keys(files).reduce((n, f) => n + statSync(join(stage, f)).size, 0),
    tier: spec.tier, runtime: spec.runtime, license: spec.license, homepage: spec.homepage,
  };
}

let ephemeral = null;
function loadPrivateKey() {
  if (argv.includes("--ephemeral") && !process.env.CATALOG_SIGNING_KEY) {
    // CI without the real signing secret: sign with a throw-away key and publish its public half next to the catalog, so the
    // payload build can embed it. The key is kept for the rest of this run (a re-signed catalog must match the embedded key).
    // The result works end to end but is a DEV build: only the real key may sign a release.
    const keyFile = join(CACHE, "ephemeral-private.pem");
    if (!ephemeral) {
      if (existsSync(keyFile)) ephemeral = createPrivateKey(readFileSync(keyFile, "utf8"));
      else {
        const kp = generateKeyPairSync("ed25519");
        ephemeral = kp.privateKey;
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(keyFile, kp.privateKey.export({ type: "pkcs8", format: "pem" }));
        console.warn("\n!! CATALOG_SIGNING_KEY is not set: signing with a throw-away key (development build only)\n");
      }
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "ephemeral-pubkey.pem"), createPublicKey(ephemeral).export({ type: "spki", format: "pem" }));
    }
    return ephemeral;
  }
  const pem = process.env.CATALOG_SIGNING_KEY ?? (flag("key") ? readFileSync(resolve(flag("key")), "utf8") : null);
  const fallback = join(ROOT, "build", "keys", "catalog-private.pem");
  const text = pem ?? (existsSync(fallback) ? readFileSync(fallback, "utf8") : null);
  if (!text) throw new Error("no signing key: set CATALOG_SIGNING_KEY, pass --key, or run node build/make-keys.mjs");
  return createPrivateKey(text);
}

const indexPath = join(OUT, "packs-index.json");
const catalogPath = join(OUT, "catalog.json");
const prevIndex = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
const exclude = new Set((flag("exclude", "") || "").split(",").filter(Boolean));
if (flag("exclude-from") && existsSync(resolve(flag("exclude-from")))) {
  // results written by ci-packs-smoke: a pack that does not start on Windows is never offered to users
  const res = JSON.parse(readFileSync(resolve(flag("exclude-from")), "utf8"));
  for (const [id, r] of Object.entries(res)) if (!r.ok) exclude.add(id);
}
const built = {};
if (!argv.includes("--catalog-only")) {
  for (const [id, spec] of Object.entries(PACKS)) {
    if (only && !only.has(id)) continue;
    built[id] = await buildOne(id, spec);
  }
}
const index = { ...prevIndex, ...built };           // when building a subset, keep previously built packs
mkdirSync(OUT, { recursive: true });
writeFileSync(indexPath, JSON.stringify(index, null, 2));
const catalog = { format: 1, generated: new Date().toISOString(), packs: Object.fromEntries(Object.entries(index).filter(([id]) => !exclude.has(id))) };
if (exclude.size) console.log(`excluded from the catalog: ${[...exclude].join(", ")}`);
const bytes = Buffer.from(JSON.stringify(catalog, null, 2));
writeFileSync(catalogPath, bytes);
writeFileSync(join(OUT, "catalog.sig"), edSign(null, bytes, loadPrivateKey()).toString("base64"));
console.log(`\ncatalog: ${Object.keys(catalog.packs).length} packs -> ${catalogPath} (signed)`);
