import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX = 1_000_000;

/** Appends to <dataDir>/logs/<name>.log (rotated at ~1 MB). Logging must never break the app. */
export function makeLogger(ctx, name = "gui") {
  const dir = join(ctx.dataDir, "logs");
  const file = join(dir, `${name}.log`);
  return Object.assign((msg) => {
    try {
      mkdirSync(dir, { recursive: true });
      if (existsSync(file) && statSync(file).size > MAX) renameSync(file, `${file}.1`);
      appendFileSync(file, `[${new Date().toISOString()}] ${msg}\n`);
    } catch { /* ignore */ }
  }, { file });
}

export function readLog(ctx, name = "gui", maxChars = 60_000) {
  const files = [join(ctx.dataDir, "logs", `${name}.log`), join(ctx.appDir, "logs", `${name}.log`)];
  for (const f of files) {
    try { const t = readFileSync(f, "utf8"); return t.length > maxChars ? t.slice(-maxChars) : t; } catch { /* next */ }
  }
  return "";
}

/** Names of the log files the GUI can show. */
export const LOG_NAMES = ["gui", "setup-install", "setup-uninstall"];
