// settings.json -> every AI app's config (Claude Desktop, Codex, Antigravity, OpenCode). The single place that decides what they will launch.
import { buildEntries } from "./registry.mjs";
import { applyClients } from "./clients.mjs";

/**
 * @returns {{entries:object, results:{path:string, ok:boolean, error?:string}[], clients:Record<string,{path:string, ok:boolean, error?:string}[]>}}
 *   `results` are Claude Desktop's files (the installer's contract); `clients` has every app.
 */
export function applySettings(ctx, settings, log = () => {}) {
  const entries = buildEntries(ctx, settings);
  const clients = applyClients(ctx, settings, entries, log);
  const count = (id) => clients[id].filter((r) => r.ok).length;
  log(`applied ${Object.keys(entries).length} server(s): ${Object.keys(clients).filter((id) => settings.clients?.[id]?.enabled ?? id === "claude").map((id) => `${id}=${count(id)} file(s)`).join(", ") || "no AI app enabled"}`);
  return { entries, results: clients.claude, clients };
}
