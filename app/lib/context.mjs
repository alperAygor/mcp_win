// Everything that depends on "where am I installed / whose profile is this" lives here, so the rest of the
// code (and the tests) can run against a fake Windows profile in a temp folder.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** @param {{appDir?: string, env?: NodeJS.ProcessEnv, sep?: string}} [o] */
export function makeContext({ appDir, env = process.env, sep = process.platform === "win32" ? "\\" : "/" } = {}) {
  const here = dirname(fileURLToPath(import.meta.url)); // <app>/app/lib
  const root = appDir ?? env.ARCHMCP_APP_DIR ?? join(here, "..", "..");
  const appData = env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const localAppData = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const ctx = {
    appDir: root,
    env,
    sep,
    appData,
    localAppData,
    userProfile: env.USERPROFILE ?? homedir(),
    programFiles: [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean),
    commonProgramFiles: [env.CommonProgramFiles, env["CommonProgramFiles(x86)"], env.ProgramFiles].filter(Boolean),
    dataDir: join(appData, "ArchMCP"), // settings + GUI logs: survive reinstalls
    /** Path string that goes into Claude's config (always Windows-style, even in tests on macOS). */
    p: (...parts) => [root, ...parts].join(sep),
    /** Real filesystem path inside the install folder. */
    fs: (...parts) => join(root, ...parts),
    has: (...parts) => existsSync(join(root, ...parts)),
  };
  return ctx;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}
