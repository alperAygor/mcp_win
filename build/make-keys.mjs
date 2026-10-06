#!/usr/bin/env node
// Generates the Ed25519 key pair that signs the pack catalog.
//   node build/make-keys.mjs            -> build/keys/catalog-private.pem (NEVER commit) + prints the public key
// Put the PRIVATE key into the GitHub secret CATALOG_SIGNING_KEY and paste the PUBLIC key into app/lib/catalog-key.mjs.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "keys", process.argv[2] ?? "catalog-private.pem");
if (existsSync(out)) { console.error(`${out} already exists - refusing to overwrite a signing key`); process.exit(1); }
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
console.log(`private key written to ${out}  (keep secret; add it as the CATALOG_SIGNING_KEY secret)\n`);
console.log("public key for app/lib/catalog-key.mjs:\n");
console.log(publicKey.export({ type: "spki", format: "pem" }));
