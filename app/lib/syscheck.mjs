// "Will this PC run it?" - checks the things that make software fail on SOME Windows machines but not others.
// Every check returns { id, status: 'ok'|'warn'|'fail'|'skip', data } ; the UI/CLI turn id+data into text with a fix.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { claudeConfigPaths } from "./claude.mjs";
import { CLIENT_IDS, clientDetected } from "./clients.mjs";

const isWin = process.platform === "win32";
const MIN_FREE_GB = 1.5;

function canWrite(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `.write-test-${process.pid}`);
    writeFileSync(f, "x");
    rmSync(f);
    return true;
  } catch { return false; }
}

function runs(exe, args) {
  if (!existsSync(exe)) return { ok: false, why: "missing" };
  const r = spawnSync(exe, args, { encoding: "utf8", timeout: 20_000, windowsHide: true });
  if (r.error) return { ok: false, why: r.error.code ?? r.error.message };          // EPERM/EACCES = blocked by antivirus or AppLocker
  return r.status === 0 ? { ok: true, out: (r.stdout || r.stderr || "").trim().split(/\r?\n/)[0] } : { ok: false, why: `exit ${r.status}`, out: (r.stderr || "").slice(0, 200) };
}

/** @returns {{id:string,status:string,data?:any}[]} */
export function systemCheck(ctx) {
  const out = [];
  const add = (id, status, data = {}) => out.push({ id, status, data });

  // Windows version (Node 22 needs Windows 10+; build numbers start at 10.0.x)
  if (isWin) {
    const [maj, , build] = release().split(".").map(Number);
    add("windows", maj >= 10 ? "ok" : "fail", { version: release(), build });
  } else add("windows", "skip", { platform: process.platform });

  add("arch", process.arch === "x64" || process.arch === "arm64" ? "ok" : "fail", { arch: process.arch });

  // disk space where the app lives
  try {
    const st = statfsSync(ctx.appDir);
    const freeGb = (st.bavail * st.bsize) / 1073741824;
    add("disk", freeGb >= MIN_FREE_GB ? "ok" : "fail", { freeGb: Math.round(freeGb * 10) / 10, needGb: MIN_FREE_GB });
  } catch { add("disk", "skip"); }

  // permissions
  add("write-app", canWrite(join(ctx.appDir, "servers")) ? "ok" : "fail", { path: ctx.appDir });
  add("write-data", canWrite(ctx.dataDir) ? "ok" : "fail", { path: ctx.dataDir });

  // path hygiene (260-char limit still bites old tools; spaces/non-ASCII are supported but worth knowing)
  const len = ctx.appDir.length;
  add("path", len > 90 ? "warn" : "ok", { length: len, path: ctx.appDir });

  // bundled runtimes actually start (this is where antivirus / AppLocker / Smart App Control show up)
  const node = runs(ctx.fs("runtime", "node", "node.exe"), ["--version"]);
  add("node", node.ok ? "ok" : (node.why === "missing" ? "skip" : "fail"), { out: node.out, why: node.why });
  const py = ctx.has("runtime", "python", "python.exe") ? runs(ctx.fs("runtime", "python", "python.exe"), ["-I", "-S", "-c", "import sys;print(sys.version.split()[0])"]) : { ok: false, why: "missing" };
  add("python", py.ok ? "ok" : (py.why === "missing" ? "skip" : "fail"), { out: py.out, why: py.why, output: py.out });

  // Visual C++ runtime: python.exe needs vcruntime140*.dll; we ship them app-local, but report if neither place has them
  if (isWin && ctx.has("runtime", "python")) {
    const local = ctx.has("runtime", "python", "vcruntime140.dll");
    const sys32 = existsSync(join(ctx.env.SystemRoot ?? "C:\\Windows", "System32", "vcruntime140.dll"));
    add("vcruntime", local || sys32 ? "ok" : "fail", { appLocal: local, system: sys32 });
  }

  // at least one supported AI app (Claude Desktop, Codex, Antigravity, OpenCode) should be on this PC
  const found = CLIENT_IDS.filter((id) => clientDetected(ctx, id));
  add("claude", found.length ? "ok" : "warn", { paths: claudeConfigPaths(ctx), clients: found });

  const proxy = ctx.env.HTTPS_PROXY || ctx.env.https_proxy || ctx.env.HTTP_PROXY || ctx.env.http_proxy;
  add("proxy", "ok", { proxy: proxy ? "set" : "none" });

  if (isWin) {
    const q = spawnSync("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem", "/v", "LongPathsEnabled"], { encoding: "utf8", windowsHide: true });
    add("longpaths", /0x1/.test(q.stdout ?? "") ? "ok" : "warn", { enabled: /0x1/.test(q.stdout ?? "") });
  }
  return out;
}

export const overall = (checks) => (checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok");
