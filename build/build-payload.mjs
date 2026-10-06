#!/usr/bin/env node
// Assembles payload/ - everything the Inno Setup script packs into the installer.
// Runs on Windows CI, but is plain Node + system tar/git/npm/python so it also runs on macOS/Linux
// (handy for checking the Revit/Photoshop/AutoCAD steps locally).
//
//   node build/build-payload.mjs [--only node,python,pypackages,revit,photoshop,godot,freecad,unity] [--out payload]
//
// Nothing is fetched at install time: the installer ships offline, with pinned versions from
// versions.json, so a user's existing Node/Python/PATH can never break it.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const V = JSON.parse(readFileSync(join(ROOT, "versions.json"), "utf8"));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(ROOT, flag("out", "payload"));
const ALL = ["node", "python", "pypackages", "revit", "photoshop", "godot", "freecad", "unity"];  // --only none = just refresh app/, catalog and SBOM
const only = new Set((flag("only", ALL.join(",")) || "").split(","));
const CACHE = join(ROOT, "build", ".cache");
const isWin = process.platform === "win32";

function walkAll(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkAll(p, out); else out.push(p);
  }
  return out;
}

const step = (m) => console.log(`\n==> ${m}`);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: isWin && /^(npm|npx)$/.test(cmd), ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function download(url, name) {
  mkdirSync(CACHE, { recursive: true });
  const dest = join(CACHE, name);
  if (existsSync(dest)) return dest;
  console.log(`  download ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}
const fetchText = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.text(); };
function verify(file, expected, label) {
  const got = sha256(file);
  if (got !== expected.toLowerCase()) throw new Error(`${label}: sha256 mismatch\n  expected ${expected}\n  got      ${got}`);
  console.log(`  sha256 ok (${label})`);
}
/** Extract, then flatten a single top-level folder so callers get a predictable layout. */
function extract(archive, dest, stripTop = true) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run("tar", ["-xf", archive, "-C", dest]);
  const entries = readdirSync(dest);
  const inner = join(dest, entries[0] ?? "");
  if (stripTop && entries.length === 1 && statSync(inner).isDirectory()) {
    for (const e of readdirSync(inner)) cpSync(join(inner, e), join(dest, e), { recursive: true });
    rmSync(inner, { recursive: true, force: true });
  }
}

// The Microsoft Visual C++ runtime DLLs python.exe / node.exe may need. Shipping them next to the executables ("app-local")
// means a freshly installed Windows without the VC++ Redistributable still runs everything - no admin rights, no extra installer.
const VC_DLLS = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "msvcp140_1.dll", "concrt140.dll"];
function copyVcRuntime(dir) {
  if (!isWin) return;
  const sys32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  let n = 0;
  for (const f of VC_DLLS) if (existsSync(join(sys32, f))) { copyFileSync(join(sys32, f), join(dir, f)); n++; }
  if (n < 2) throw new Error("VC++ runtime DLLs not found in System32 on the build machine");
  console.log(`  app-local VC++ runtime: ${n} DLLs -> ${dir}`);
}

// ------------------------------------------------------------------ steps

async function buildNode() {
  step(`Node ${V.node.version} (win-x64)`);
  const zip = await download(V.node.url, V.node.fileName);
  const sums = await fetchText(V.node.shasumsUrl);
  const line = sums.split("\n").find((l) => l.endsWith(V.node.fileName));
  if (!line) throw new Error("node SHASUMS256 has no entry for " + V.node.fileName);
  verify(zip, line.split(/\s+/)[0], "node");
  extract(zip, join(OUT, "runtime", "node"));
  if (!isWin && !existsSync(join(OUT, "runtime", "node", "node.exe"))) throw new Error("node.exe missing after extract");
  copyVcRuntime(join(OUT, "runtime", "node"));
}

async function buildPython() {
  step(`Python ${V.python.version} (standalone, win-x64)`);
  const name = decodeURIComponent(basename(V.python.url));
  const tgz = await download(V.python.url, name);
  // astral publishes a .sha256 next to every asset
  try { verify(tgz, (await fetchText(V.python.url + ".sha256")).trim().split(/\s+/)[0], "python"); }
  catch (e) { if (String(e).includes("mismatch")) throw e; console.log("  (no .sha256 published, skipping verify)"); }
  extract(tgz, join(OUT, "runtime", "python"));
  copyVcRuntime(join(OUT, "runtime", "python"));
}

/** Removes directories that contain no files (recursively). Returns true if `dir` itself was removed. */
function pruneEmptyDirs(dir) {
  let empty = true;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory() && pruneEmptyDirs(full)) continue;
    empty = false;
  }
  if (empty && dir !== join(OUT, "runtime", "python", "Lib", "site-packages")) { rmSync(dir, { recursive: true }); return true; }
  return false;
}

/**
 * All Python MCP servers (AutoCAD, Blender, FreeCAD, OpenSCAD, Unity) are resolved together by pip, so the
 * result is one consistent set of third-party packages (CI re-checks it with a real handshake per server).
 * Packages that drop generically named top-level modules (autocad: server/config/security..., unity: main/core/
 * utils/models...) are then moved into their own folder, so they can never shadow another server's modules.
 */
async function buildPyPackages() {
  step("Python MCP packages (Blender, FreeCAD, OpenSCAD, AutoCAD, Unity)");
  const pyDir = join(OUT, "runtime", "python");
  if (!existsSync(pyDir)) throw new Error("run the python step before pypackages");
  const site = join(pyDir, "Lib", "site-packages");
  mkdirSync(site, { recursive: true });
  const isolated = V.python.isolated;
  const lock = join(ROOT, "build", "locks", "core-python.txt");
  if (!existsSync(lock)) throw new Error("missing build/locks/core-python.txt - run: python build/lock_packs.py core");
  // Only exact, hash-verified wheels (pip --require-hashes --no-deps): what ships is byte-for-byte what was locked.
  const flags = ["-m", "pip", "install", "--disable-pip-version-check", "--no-compile", "--only-binary=:all:", "--require-hashes", "--no-deps", "-r", lock];
  if (isWin) {
    run(join(pyDir, "python.exe"), flags);
  } else {
    run(process.env.PYTHON ?? "python3", [...flags, "--platform", "win_amd64", "--implementation", "cp", "--python-version", "3.12", "--ignore-requires-python", "--target", site]);
  }
  for (const [id, { dist }] of Object.entries(isolated)) {
    const info = readdirSync(site).find((n) => n.toLowerCase().startsWith(`${dist}-`) && n.endsWith(".dist-info"));
    if (!info) throw new Error(`dist-info for ${dist} not found`);
    const record = readFileSync(join(site, info, "RECORD"), "utf8").split(/\r?\n/).map((l) => l.split(",")[0]).filter(Boolean);
    const dest = join(OUT, "servers", id, "site");
    rmSync(dest, { recursive: true, force: true });
    let moved = 0;
    for (const rel of record) {
      if (rel.startsWith("..") || rel.includes("__pycache__")) continue; // launchers etc. with baked-in paths
      const from = join(site, rel);
      if (!existsSync(from)) continue;
      mkdirSync(dirname(join(dest, rel)), { recursive: true });
      renameSync(from, join(dest, rel));
      moved++;
    }
    console.log(`  isolated ${id}: ${moved} files -> servers/${id}/site`);
  }
  pruneEmptyDirs(site); // moving files leaves the (now empty) package folders behind
  // byte-compile now (Windows, with the very interpreter we ship): servers start noticeably faster on first launch
  if (isWin) {
    const dirs = [site, ...Object.keys(isolated).map((id) => join(OUT, "servers", id, "site"))];
    run(join(pyDir, "python.exe"), ["-m", "compileall", "-q", "-j", "0", ...dirs], { stdio: "ignore" });
  }
  // pip's console-script launchers have this machine's python path baked in and are never used
  const scripts = join(pyDir, "Scripts");
  if (existsSync(scripts)) for (const f of readdirSync(scripts)) if (f.endsWith(".exe")) rmSync(join(scripts, f), { force: true });
}

async function buildRevit() {
  step(`Revit MCP ${V.revit.version}`);
  const zip = await download(V.revit.url, `revit-${V.revit.version}.zip`);
  verify(zip, (await fetchText(V.revit.sha256Url)).trim().split(/\s+/)[0], "revit");
  const tmp = join(CACHE, "revit-extract");
  extract(zip, tmp, false);
  const srv = join(OUT, "servers", "revit");
  rmSync(srv, { recursive: true, force: true });
  cpSync(join(tmp, "mcp-server"), srv, { recursive: true });
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: srv });  // the release ships its own integrity-pinned lockfile
  const addin = join(OUT, "servers", "revit-addin");
  rmSync(addin, { recursive: true, force: true });
  cpSync(join(tmp, "addin"), addin, { recursive: true });
}

async function buildPhotoshop() {
  step(`Photoshop MCP @ ${V.photoshop.commit.slice(0, 8)}`);
  const src = join(CACHE, "photoshop-src");
  if (!existsSync(join(src, ".git"))) {
    rmSync(src, { recursive: true, force: true });
    run("git", ["clone", "--filter=blob:none", V.photoshop.repo, src]);
  }
  run("git", ["fetch", "origin", V.photoshop.commit], { cwd: src });
  run("git", ["checkout", "--force", V.photoshop.commit], { cwd: src });
  run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: src });
  run("npm", ["run", "build"], { cwd: src });

  // Workspaces use symlinks, which neither the installer nor a moved folder survives. Pack the
  // runtime packages and install the tarballs into a clean, symlink-free directory instead.
  const packs = join(CACHE, "photoshop-packs");
  rmSync(packs, { recursive: true, force: true });
  mkdirSync(packs, { recursive: true });
  const pkgs = readdirSync(join(src, "packages")).filter((d) => existsSync(join(src, "packages", d, "package.json")));
  const wanted = pkgs.filter((d) => !JSON.parse(readFileSync(join(src, "packages", d, "package.json"), "utf8")).private);
  for (const d of wanted) run("npm", ["pack", join(src, "packages", d), "--pack-destination", packs, "--ignore-scripts"], { stdio: "ignore" });
  const tarballs = readdirSync(packs).filter((f) => f.endsWith(".tgz")).map((f) => join(packs, f));

  const dest = join(OUT, "servers", "photoshop");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "package.json"), JSON.stringify({ name: "archmcp-photoshop-host", private: true }));
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", ...tarballs], { cwd: dest }); // workspace tarballs of a commit-pinned repo
  const bin = join(dest, "node_modules", "photoshop-mcp", "bin", "photoshop-mcp.js");
  if (!existsSync(bin)) throw new Error("photoshop-mcp entrypoint missing after install: " + bin);

  // UXP plugin -> .ccx (a .ccx is just a zip with manifest.json at the root)
  const plugin = join(src, "photoshop-uxp");
  const { selectOutputs } = await import(pathToFileURL(join(src, "scripts", "dist-outputs.mjs")).href);
  const { keep } = selectOutputs(join(plugin, "dist"), join(plugin, "src"));
  const stage = join(CACHE, "ccx-stage");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "dist"), { recursive: true });
  copyFileSync(join(plugin, "manifest.json"), join(stage, "manifest.json"));
  cpSync(join(plugin, "icons"), join(stage, "icons"), { recursive: true });
  for (const f of keep) {
    mkdirSync(dirname(join(stage, "dist", f)), { recursive: true });
    copyFileSync(join(plugin, "dist", f), join(stage, "dist", f));
  }
  const pluginOut = join(OUT, "servers", "photoshop-plugin");
  rmSync(pluginOut, { recursive: true, force: true });
  mkdirSync(pluginOut, { recursive: true });
  const zipPath = join(pluginOut, "photoshop-mcp.zip");
  // explicit top-level names: a bare "." would prefix every entry with "./", which strict zip readers dislike
  run("tar", ["-a", "-cf", zipPath, "-C", stage, ...readdirSync(stage)]);
  cpSync(zipPath, join(pluginOut, "photoshop-mcp.ccx"));
  rmSync(zipPath);
}

function cloneAt(name, repo, commit) {
  const src = join(CACHE, name);
  if (!existsSync(join(src, ".git"))) {
    rmSync(src, { recursive: true, force: true });
    run("git", ["clone", "--filter=blob:none", repo, src]);
  }
  run("git", ["fetch", "origin", commit], { cwd: src });
  run("git", ["checkout", "--force", commit], { cwd: src });
  return src;
}

async function buildGodot() {
  step(`Godot MCP ${V.godot.version}`);
  const dest = join(OUT, "servers", "godot");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(ROOT, "build", "locks", "npm", "godot", "package.json"), join(dest, "package.json"));
  copyFileSync(join(ROOT, "build", "locks", "npm", "godot", "package-lock.json"), join(dest, "package-lock.json"));
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: dest });
  if (!existsSync(join(dest, "node_modules", "@coding-solo", "godot-mcp", "build", "index.js"))) {
    throw new Error("godot-mcp build/index.js missing (npm tarball without build output?)");
  }
}

async function buildFreecad() {
  step(`FreeCAD addon @ ${V.freecad.commit.slice(0, 8)}`);
  const src = cloneAt("freecad-src", V.freecad.repo, V.freecad.commit);
  const dest = join(OUT, "servers", "freecad-addon");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, "addon", "FreeCADMCP"), join(dest, "FreeCADMCP"), { recursive: true });
  if (!existsSync(join(dest, "FreeCADMCP", "InitGui.py"))) throw new Error("FreeCADMCP/InitGui.py missing");
}

async function buildUnity() {
  step(`Unity package @ ${V.unity.commit.slice(0, 8)}`);
  const src = cloneAt("unity-src", V.unity.repo, V.unity.commit);
  const dest = join(OUT, "servers", "unity-package");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  // Copied into <project>/Packages/ as an *embedded* package: no git or registry needed on the user's PC.
  cpSync(join(src, "MCPForUnity"), join(dest, "com.coplaydev.unity-mcp"), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(dest, "com.coplaydev.unity-mcp", "package.json"), "utf8"));
  if (pkg.name !== "com.coplaydev.unity-mcp") throw new Error("unexpected unity package name " + pkg.name);
}

// ------------------------------------------------------------------ main

const steps = { node: buildNode, python: buildPython, pypackages: buildPyPackages, revit: buildRevit, photoshop: buildPhotoshop,
  godot: buildGodot, freecad: buildFreecad, unity: buildUnity };
mkdirSync(OUT, { recursive: true });
for (const name of ALL) if (only.has(name)) await steps[name]();

// the ArchMCP application itself (setup CLI, control panel, libraries) travels with the payload
rmSync(join(OUT, "app"), { recursive: true, force: true });
cpSync(join(ROOT, "app"), join(OUT, "app"), { recursive: true });
// Where the app downloads packs from. An explicit value wins (versions.json, or ARCHMCP_CATALOG_BASE_URL for another host);
// otherwise, when built by GitHub Actions, it is the rolling "catalog" release of this very repository (see publish-catalog.yml),
// so nobody has to type an address anywhere. The repository must be public for end users to download from it.
// ARCHMCP_PACKS_REPO ("owner/name") = a separate PUBLIC repository that only holds the packs, so the source repository can stay private.
const packsRepo = process.env.ARCHMCP_PACKS_REPO || process.env.GITHUB_REPOSITORY;
const catBase = V.catalog?.baseUrl || process.env.ARCHMCP_CATALOG_BASE_URL
  || (packsRepo ? `https://github.com/${packsRepo}/releases/download/catalog` : "");
if (catBase) { V.catalog = { ...(V.catalog ?? {}), baseUrl: catBase }; console.log(`pack catalog address: ${catBase}`); }
else console.warn("!! no catalog address (versions.json catalog.baseUrl / GITHUB_REPOSITORY): the Store works offline from the embedded catalog only");
writeFileSync(join(OUT, "versions.json"), JSON.stringify(V, null, 2));

// the signed pack catalog travels with the installer (offline baseline); the app can refresh it from catalog.baseUrl
const catSrc = resolve(ROOT, flag("catalog", "dist/packs"));
if (existsSync(join(catSrc, "ephemeral-pubkey.pem"))) {
  const pem = readFileSync(join(catSrc, "ephemeral-pubkey.pem"), "utf8").trim();
  writeFileSync(join(OUT, "app", "lib", "catalog-key.mjs"), `// DEVELOPMENT BUILD: signed with a throw-away key (no CATALOG_SIGNING_KEY secret was available)\nexport const CATALOG_KEYS = [{ id: "ephemeral", pem: \`${pem}\` }];\n`);
  console.warn("!! development build: pack catalog signed with a throw-away key");
}
if (existsSync(join(catSrc, "catalog.json")) && existsSync(join(catSrc, "catalog.sig"))) {
  mkdirSync(join(OUT, "catalog"), { recursive: true });
  copyFileSync(join(catSrc, "catalog.json"), join(OUT, "catalog", "catalog.json"));
  copyFileSync(join(catSrc, "catalog.sig"), join(OUT, "catalog", "catalog.sig"));
  console.log("signed pack catalog included");
} else console.log("(no signed catalog found in " + catSrc + " - run build-packs first; the app then offers no downloadable packs)");

// Windows' 260-character path limit still bites some tools: the install folder is ~45 characters, leave headroom
const MAX_REL = 170;
const longest = walkAll(OUT).map((f) => relative(OUT, f)).filter((f) => f.length > MAX_REL).sort((x, y) => y.length - x.length);
if (longest.length) throw new Error(`${longest.length} file path(s) longer than ${MAX_REL} characters, e.g.\n  ${longest.slice(0, 3).join("\n  ")}`);

import("./make-sbom.mjs").then((m) => m.writeSbom(OUT, ROOT));
console.log(`\npayload ready: ${OUT}`);
