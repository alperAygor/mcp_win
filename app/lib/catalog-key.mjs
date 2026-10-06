// Public keys that may sign the pack catalog (Ed25519, SPKI PEM). More than one allows key rotation.
// The matching PRIVATE key is a CI secret (CATALOG_SIGNING_KEY); a copy lives in build/keys/ (git-ignored) - see build/make-keys.mjs.
// To rotate: add the new key here, ship that release, sign with the new key afterwards, and remove the old entry in a later release.
export const CATALOG_KEYS = [
  {
    id: "archmcp-2026-10",
    pem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/f7E1maWUtdpcYIv/iXfI7CyCBwrUpHFCdJcKmQRlQk=
-----END PUBLIC KEY-----`,
  },
];
