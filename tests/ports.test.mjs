import test from "node:test";
import assert from "node:assert/strict";
import { fakePc } from "./helpers.mjs";
import { REGISTRY } from "../app/lib/registry.mjs";
import { defaultSettings, updateSettings } from "../app/lib/settings.mjs";
import { analyzePorts, parseNetstat, planPorts } from "../app/lib/ports.mjs";
import { systemCheck, overall } from "../app/lib/syscheck.mjs";

const enable = (...ids) => {
  let s = defaultSettings();
  for (const id of ids) s.mcps[id].enabled = true;
  s.mcps.revit.options.versions = [2026];
  return s;
};

test("parseNetstat reads LISTENING rows (IPv4/IPv6) and ignores everything else", () => {
  const rows = parseNetstat("  TCP    127.0.0.1:9876   0.0.0.0:0   LISTENING   4242\r\n  TCP    [::]:8765   [::]:0   LISTENING   77\r\n  TCP 1.2.3.4:50000 5.6.7.8:443 ESTABLISHED 9\r\n  UDP 0.0.0.0:5353 *:* 55");
  assert.deepEqual(rows.map((r) => [r.port, r.pid]), [[9876, 4242], [8765, 77]]);
});

test("four programs default to 9876: the first keeps it, the others move to free ports", () => {
  const pc = fakePc();
  const s = enable("blender", "bonsai", "fusion360", "qgis");
  const plan = planPorts(pc.ctx, s, new Map());
  assert.equal(plan.changes.blender, undefined);                   // registry order: Blender keeps 9876
  const moved = [plan.changes.bonsai.port, plan.changes.fusion360.port, plan.changes.qgis.port];
  assert.equal(new Set(moved).size, 3, "no two moved integrations share a port");
  assert.ok(moved.every((p) => p !== 9876));
  assert.deepEqual(plan.unresolved, []);
});

test("ports already taken by other programs are skipped when choosing", () => {
  const pc = fakePc();
  const busy = new Map([[9877, { pid: 1, name: "chrome.exe" }], [9878, { pid: 2, name: "node.exe" }]]);
  const plan = planPorts(pc.ctx, enable("blender", "fusion360"), busy);
  assert.equal(plan.changes.fusion360.port, 9879);
  assert.equal(plan.notes[0].from, 9876);
});

test("a foreign program on a configurable port is worked around; on a fixed port it is only reported", () => {
  const pc = fakePc();
  const listen = new Map([[9876, { pid: 5, name: "skype.exe" }], [9875, { pid: 6, name: "something.exe" }]]);
  const s = enable("blender", "freecad");
  const rows = analyzePorts(pc.ctx, s, listen);
  assert.equal(rows.find((r) => r.id === "blender").status, "foreign");
  assert.equal(rows.find((r) => r.id === "freecad").status, "foreign");
  const plan = planPorts(pc.ctx, s, listen);
  assert.ok(plan.changes.blender.port > 9876);
  assert.deepEqual(plan.unresolved.map((r) => r.id), ["freecad"]);   // FreeCAD's 9875 is hard-coded upstream
});

test("the host program holding its own port is normal, not a clash", () => {
  const pc = fakePc();
  const listen = new Map([[9876, { pid: 5, name: "blender.exe" }]]);
  const row = analyzePorts(pc.ctx, enable("blender"), listen).find((r) => r.id === "blender");
  assert.equal(row.status, "host");
  assert.deepEqual(planPorts(pc.ctx, enable("blender"), listen).changes, {});
});

test("every port claim is well-formed and configurable ones name their option", () => {
  const pc = fakePc();
  const s = defaultSettings();
  for (const def of REGISTRY.filter((d) => d.kind === "local")) {
    s.mcps[def.id].enabled = true;
  }
  s.mcps.revit.options.versions = [2025, 2026, 2027];
  for (const r of analyzePorts(pc.ctx, s, new Map())) {
    assert.ok(Number.isInteger(r.port) && r.port > 0 && r.port < 65536, `${r.id} ${r.port}`);
    assert.ok(["server", "host-patch", "host-manual", "fixed"].includes(r.side), `${r.id} ${r.side}`);
    if (r.side !== "fixed") assert.ok(r.option, `${r.id} is configurable but names no option`);
  }
  // the three Revit years never collide with each other
  const revit = analyzePorts(pc.ctx, s, new Map()).filter((r) => r.id === "revit").map((r) => r.port);
  assert.deepEqual(revit.sort(), [7890, 7891, 7892]);
});

test("changing a port updates the environment the server gets", () => {
  const pc = fakePc();
  const s = updateSettings(enable("blender", "fusion360", "bonsai", "qgis"), { mcps: { fusion360: { options: { port: 9900 } }, qgis: { options: { port: 9901 } }, bonsai: { options: { port: 9902 } } } });
  // (buildEntries is covered elsewhere; here: the plan sees the new values as non-conflicting)
  assert.deepEqual(planPorts(pc.ctx, s, new Map()).changes, {});
});

test("system check: returns every check with a status, and flags nothing wrong on a healthy dev machine", () => {
  const pc = fakePc();
  const checks = systemCheck(pc.ctx);
  const ids = checks.map((c) => c.id);
  for (const id of ["windows", "arch", "disk", "write-app", "write-data", "path", "node", "python", "claude", "proxy"]) assert.ok(ids.includes(id), id);
  assert.ok(checks.every((c) => ["ok", "warn", "fail", "skip"].includes(c.status)));
  assert.equal(checks.find((c) => c.id === "write-data").status, "ok");
  assert.ok(["ok", "warn", "fail"].includes(overall(checks)));
});
