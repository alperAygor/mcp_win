#!/usr/bin/env node
// Starts the ArchMCP control panel and shows it in its own app-style window (Edge/Chrome --app), no browser chrome.
//   node launcher.mjs [--app-dir <dir>] [--no-open] [--port <n>]
// One instance at a time: a second launch just brings up a window for the running server. The server quits by itself
// shortly after the window is closed (the UI sends a heartbeat every few seconds).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext } from "../lib/context.mjs";
import { createApp } from "./server.mjs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const ctx = makeContext({ appDir: arg("app-dir") });
const noOpen = argv.includes("--no-open");
const lockFile = join(ctx.dataDir, "gui.lock.json");
const IDLE_EXIT_MS = 45_000;

function readVersions() {
  try { return JSON.parse(readFileSync(join(ctx.appDir, "versions.json"), "utf8")); } catch { return {}; }
}

function findBrowser() {
  const bases = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const rel = [["Microsoft", "Edge", "Application", "msedge.exe"], ["Google", "Chrome", "Application", "chrome.exe"]];
  for (const r of rel) for (const b of bases) { const p = join(b, ...r); if (existsSync(p)) return p; }
  return null;
}

function openWindow(url) {
  if (noOpen) return;
  const browser = process.platform === "win32" ? findBrowser() : null;
  if (browser) {
    // own profile folder: no tabs, no extensions, no history mixed with the user's browsing
    mkdirSync(join(ctx.dataDir, "browser"), { recursive: true });
    spawn(browser, [`--app=${url}`, `--user-data-dir=${join(ctx.dataDir, "browser")}`, "--window-size=1240,840",
      "--no-first-run", "--no-default-browser-check", "--disable-extensions"], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function existingInstance() {
  try {
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    const res = await fetch(`http://127.0.0.1:${lock.port}/api/state`, { headers: { "x-archmcp-token": lock.token }, signal: AbortSignal.timeout(1500) });
    if (res.ok) return lock;
  } catch { /* none running */ }
  return null;
}

const running = await existingInstance();
if (running) {
  const url = `http://127.0.0.1:${running.port}/#t=${running.token}`;
  console.log(url);
  openWindow(url);
  process.exit(0);
}

const token = randomBytes(24).toString("hex");
const app = createApp({ ctx, token, versions: readVersions(), onShutdown: () => shutdown() });
app.server.listen(Number(arg("port") ?? 0), "127.0.0.1", () => {
  const { port } = app.server.address();
  app.setPort(port);
  mkdirSync(ctx.dataDir, { recursive: true });
  writeFileSync(lockFile, JSON.stringify({ port, token, pid: process.pid }));
  const url = `http://127.0.0.1:${port}/#t=${token}`;
  app.log(`control panel started on :${port}`);
  console.log(url);
  openWindow(url);
});

function shutdown() {
  try { rmSync(lockFile, { force: true }); } catch { /* ignore */ }
  app.log("control panel stopped");
  process.exit(0);
}
// A bug in one request/job must never kill the control panel: log it and keep serving.
process.on("uncaughtException", (e) => app.log(`uncaughtException: ${e?.stack ?? e}`));
process.on("unhandledRejection", (e) => app.log(`unhandledRejection: ${e?.stack ?? e}`));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
app.touch(); // grace period for the window to open before the first heartbeat arrives
setInterval(() => { if (app.idleMs() > IDLE_EXIT_MS && !argv.includes("--keep-alive")) shutdown(); }, 5000).unref?.();
