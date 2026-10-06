// Software bill of materials (CycloneDX 1.5 JSON): every component we ship or can download, with version, source and hash.
// Shipped as sbom.json inside the installer (About page) so a customer's security team can audit exactly what is on the PC.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const purl = (type, name, version) => `pkg:${type}/${name.replace(/^@/, "%40")}@${version}`;

function parseLock(file) {
  return readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
    const m = /^([^=\s]+)==([^\s]+) --hash=sha256:([0-9a-f]{64})/.exec(l);
    return m ? { name: m[1], version: m[2], sha256: m[3] } : null;
  }).filter(Boolean);
}

export function writeSbom(outDir, root) {
  const V = JSON.parse(readFileSync(join(root, "versions.json"), "utf8"));
  const packs = JSON.parse(readFileSync(join(root, "build", "packs.json"), "utf8"));
  const components = [];
  const add = (c) => components.push({ "bom-ref": `${c.type}:${c.name}@${c.version}`, ...c });

  add({ type: "application", name: "node", version: V.node.version, purl: purl("generic", "node", V.node.version), externalReferences: [{ type: "distribution", url: V.node.url }] });
  add({ type: "application", name: "cpython", version: V.python.version, purl: purl("generic", "cpython", V.python.version), externalReferences: [{ type: "distribution", url: V.python.url }] });
  add({ type: "application", name: "revit-mcp-server", version: V.revit.version, licenses: [{ license: { id: "MIT" } }], purl: purl("github", "KenLP/RevitMCPServer", V.revit.version) });
  add({ type: "application", name: "photoshop-mcp", version: V.photoshop.commit.slice(0, 12), licenses: [{ license: { id: "MIT" } }], purl: purl("github", "drmedia/photoshop-mcp", V.photoshop.commit) });
  add({ type: "application", name: "godot-mcp", version: V.godot.version, licenses: [{ license: { id: "MIT" } }], purl: purl("npm", "@coding-solo/godot-mcp", V.godot.version) });
  add({ type: "application", name: "unity-mcp", version: V.unity.version, licenses: [{ license: { id: "MIT" } }], purl: purl("github", "CoplayDev/unity-mcp", V.unity.commit) });

  const lockFile = (name) => join(root, "build", "locks", `${name}.txt`);
  if (existsSync(lockFile("core-python"))) for (const l of parseLock(lockFile("core-python"))) add({ type: "library", name: l.name, version: l.version, hashes: [{ alg: "SHA-256", content: l.sha256 }], purl: purl("pypi", l.name, l.version), scope: "required" });

  for (const [id, p] of Object.entries(packs)) {
    add({ type: "application", name: `archmcp-pack-${id}`, version: p.version, licenses: [{ license: { name: p.license } }], externalReferences: [{ type: "website", url: p.homepage }],
      properties: [{ name: "archmcp:tier", value: p.tier }, { name: "archmcp:distribution", value: "downloaded on demand, signed catalog" }, ...(p.git ? [{ name: "git-commit", value: p.git.commit }] : [])] });
    if (existsSync(lockFile(id))) for (const l of parseLock(lockFile(id))) add({ type: "library", name: l.name, version: l.version, hashes: [{ alg: "SHA-256", content: l.sha256 }], purl: purl("pypi", l.name, l.version), properties: [{ name: "archmcp:pack", value: id }] });
  }
  const bom = { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: new Date().toISOString(), component: { type: "application", name: "ArchMCP", version: V.app.version } }, components };
  writeFileSync(join(outDir, "sbom.json"), JSON.stringify(bom, null, 2));
  console.log(`sbom.json: ${components.length} components`);
}

if (process.argv[1]?.endsWith("make-sbom.mjs")) writeSbom(process.argv[2] ?? "payload", join(import.meta.dirname, ".."));
