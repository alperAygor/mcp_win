// Small helpers shared by registry.mjs (core integrations) and registry-packs.mjs (downloadable packs).
export const KEY_PREFIX = "archmcp-";
export const L = (tr, en) => ({ tr, en });
export const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));
export const nodeCmd = (c) => c.p("runtime", "node", "node.exe");
