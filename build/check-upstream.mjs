#!/usr/bin/env node
// Reports which downloadable packs / bundled servers have a newer upstream than the one we pinned. It NEVER changes anything:
// updating is a deliberate act (edit build/packs.json or versions.json -> python build/lock_packs.py <id> -> CI -> tag), because a
// silently moved pin is exactly the supply-chain risk the pins exist to prevent.
//   node build/check-upstream.mjs [--json] [--issue-body <file>]       exit code 0 always (it is a report)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packs = JSON.parse(readFileSync(join(root, "build", "packs.json"), "utf8"));
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const rows = [];
async function pypiLatest(name) {
  const r = await fetch(`https://pypi.org/pypi/${name}/json`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`PyPI ${r.status}`);
  return (await r.json()).info.version;
}
function gitHead(repo) {
  const r = spawnSync("git", ["ls-remote", repo, "HEAD"], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error((r.stderr || "git failed").trim().split("\n")[0]);
  return r.stdout.split(/\s+/)[0];
}

for (const [id, spec] of Object.entries(packs)) {
  try {
    const hold = new Set(spec.hold ?? []);           // deliberate holds, e.g. an upstream HEAD that is known to be broken
    if (spec.git && !hold.has("git")) {
      const head = gitHead(spec.git.repo);
      rows.push({ id, kind: "git", pinned: spec.git.commit.slice(0, 10), latest: head.slice(0, 10), newer: head !== spec.git.commit });
    }
    for (const req of spec.pip ?? []) {
      const m = /^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?==([^;\s]+)$/.exec(req);
      if (!m || hold.has(m[1])) continue;                                  // ranges (>=, <) are resolved at lock time, only exact pins are watched
      const latest = await pypiLatest(m[1]);
      rows.push({ id, kind: "pypi", name: m[1], pinned: m[2], latest, newer: latest !== m[2] });
    }
  } catch (e) { rows.push({ id, kind: "error", error: e.message }); }
}

const newer = rows.filter((r) => r.newer), errors = rows.filter((r) => r.kind === "error");
if (argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  console.log(`checked ${rows.length} pin(s): ${newer.length} newer upstream, ${errors.length} could not be checked\n`);
  for (const r of newer) console.log(`  ${r.id.padEnd(12)} ${r.kind === "git" ? "git" : r.name}  ${r.pinned} -> ${r.latest}`);
  for (const r of errors) console.log(`  ${r.id.padEnd(12)} ! ${r.error}`);
}
if (arg("issue-body")) {
  const lines = ["Newer upstream versions exist for pinned packs. Nothing was changed automatically.", "",
    "| pack | source | pinned | latest |", "|---|---|---|---|",
    ...newer.map((r) => `| ${r.id} | ${r.kind === "git" ? "git HEAD" : r.name} | \`${r.pinned}\` | \`${r.latest}\` |`), "",
    "To update one: edit `build/packs.json`, run `python build/lock_packs.py <id>`, let CI build and smoke-test it, then run **Publish catalog**.", "",
    ...(errors.length ? ["Could not check: " + errors.map((e) => e.id).join(", ")] : [])];
  writeFileSync(arg("issue-body"), lines.join("\n"));
}
