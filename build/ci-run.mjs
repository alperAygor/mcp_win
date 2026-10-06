#!/usr/bin/env node
// CI helper: runs a command with its output streamed as usual and, when it fails, publishes the tail of the output as a GitHub
// annotation (visible in the run summary and through the public API even though raw logs need a login).
//   node build/ci-run.mjs <label> -- <command and arguments...>
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const label = argv.slice(0, dash).join(" ") || "step";
const cmd = argv.slice(dash + 1);
if (dash < 0 || !cmd.length) { console.error("usage: ci-run.mjs <label> -- <command...>"); process.exit(2); }

const MAX = 12_000;
let tail = "";
const keep = (b) => { tail = (tail + b).slice(-MAX * 4); };
const child = spawn(cmd[0], cmd.slice(1), { stdio: ["inherit", "pipe", "pipe"], shell: process.platform === "win32" });
child.stdout.on("data", (b) => { process.stdout.write(b); keep(b); });
child.stderr.on("data", (b) => { process.stderr.write(b); keep(b); });
child.on("error", (e) => { keep(`\nspawn error: ${e.message}\n`); });
child.on("close", (code) => {
  if (code === 0) return process.exit(0);
  // node's test runner lists the failures at the end ("failing tests:" / "not ok"); otherwise the last lines
  const clean = tail.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
  const at = Math.max(clean.lastIndexOf("failing tests:"), -1);
  let msg = at >= 0 ? clean.slice(at) : clean;
  if (msg.length > MAX) msg = msg.slice(0, MAX);
  const enc = msg.replace(/%/g, "%25").replace(/\n/g, "%0A");
  console.log(`::error title=${label} failed (exit ${code})::${enc}`);
  process.exit(code ?? 1);
});
