// Real checks: start the server exactly as Claude would and speak MCP to it; probe the host-application ports.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

/** Starts the server like Claude would and returns { name, tools } or rejects with a readable reason. */
export function handshake(entry, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(entry.command, entry.args ?? [], {
      env: { ...process.env, ...(entry.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let stderr = "", name = "", done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(t); child.kill(); fn(v); } };
    const t = setTimeout(() => finish(reject, new Error(`no answer within ${timeoutMs / 1000}s ${stderr.slice(-200)}`)), timeoutMs);
    child.on("error", (e) => finish(reject, e));
    child.on("exit", (c) => finish(reject, new Error(`exited early (code ${c}) ${stderr.slice(-300)}`)));
    child.stderr.on("data", (d) => { stderr += d; });
    const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    createInterface({ input: child.stdout }).on("line", (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id === 1) {
        name = `${msg.result?.serverInfo?.name ?? "?"} ${msg.result?.serverInfo?.version ?? ""}`.trim();
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      } else if (msg.id === 2) finish(resolve, { name, tools: msg.result?.tools?.length ?? 0 });
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "archmcp", version: "1" } } });
  });
}

export const portOpen = (port, host = "127.0.0.1") => new Promise((res) => {
  const s = createConnection({ port, host }, () => { s.destroy(); res(true); });
  s.on("error", () => res(false));
  s.setTimeout(1500, () => { s.destroy(); res(false); });
});

/**
 * Full check of one MCP. `entries` = Claude-config entries of that MCP.
 * @returns {{ok:boolean, servers:{key:string, ok:boolean, message:string, tools?:number}[], ports:{label:string, open:boolean, port:number}[]}}
 */
export async function testMcp(def, entries, opts = {}) {
  const servers = [];
  for (const [key, e] of Object.entries(entries)) {
    if (!existsSync(e.command)) { servers.push({ key, ok: false, message: `runtime missing: ${e.command}` }); continue; }
    const t0 = Date.now();
    try { const r = await handshake(e); servers.push({ key, ok: true, message: r.name, tools: r.tools, ms: Date.now() - t0 }); }
    catch (err) { servers.push({ key, ok: false, message: String(err.message) }); }
  }
  const ports = [];
  for (const p of def.ports?.(opts) ?? []) {
    let open = await portOpen(p.port);
    for (let i = 1; !open && i < (p.range ?? 1); i++) open = await portOpen(p.port + i);
    ports.push({ label: p.label, port: p.port, open });
  }
  return { ok: servers.length > 0 && servers.every((s) => s.ok), servers, ports };
}
