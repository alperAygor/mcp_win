#!/usr/bin/env node
// Checks that a built catalog is signed by a key the app trusts (app/lib/catalog-key.mjs). Run before publishing: if the
// CATALOG_SIGNING_KEY secret does not belong to the public key in the repo, every installed app would REJECT the catalog.
//   node build/verify-catalog.mjs [dir with catalog.json + catalog.sig]   (default dist/packs)
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CATALOG_KEYS } from "../app/lib/catalog-key.mjs";
import { parseCatalog, verifyCatalog } from "../app/lib/packs.mjs";

const dir = resolve(process.argv[2] ?? "dist/packs");
const bytes = readFileSync(join(dir, "catalog.json"));
const sig = readFileSync(join(dir, "catalog.sig"), "utf8");
if (!verifyCatalog(bytes, sig, CATALOG_KEYS)) {
  console.error(`!! ${dir}/catalog.sig is NOT signed by any key in app/lib/catalog-key.mjs (${CATALOG_KEYS.map((k) => k.id).join(", ")}).\n   The secret CATALOG_SIGNING_KEY does not match the public key in the repository.`);
  process.exit(1);
}
const c = parseCatalog(bytes);
console.log(`catalog OK: signed by a trusted key, ${Object.keys(c.packs).length} pack(s): ${Object.keys(c.packs).join(", ")}`);
