import { makeT } from "./i18n.js";
import { guideIndex, renderGuide } from "./guides.js";

// ---------------------------------------------------------------- plumbing

const hashToken = new URLSearchParams(location.hash.slice(1)).get("t");
if (hashToken) { try { sessionStorage.setItem("archmcp-token", hashToken); } catch { /* private mode */ } history.replaceState(null, "", location.pathname); }
const TOKEN = (() => { try { return sessionStorage.getItem("archmcp-token") ?? ""; } catch { return hashToken ?? ""; } })();

async function api(method, path, body) {
  const res = await fetch(path, {
    method, headers: { "x-archmcp-token": TOKEN, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = (sel, root = document) => root.querySelector(sel);
const mb = (n) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;

let S = null;                 // last state from the server
let t = makeT("tr");
const ui = {
  view: "overview", chip: "all", openId: null, tests: {}, busy: new Set(), logName: "gui", logs: null, backups: null, diagRunning: false,
  storeQuery: "", storeTier: "all", jobs: {}, guideId: "how", system: null, profileName: "",
};

// Monogram tiles (neutral colours on purpose: these are not the vendors' logos)
const TILE = {
  revit: ["Rv", "#2f6fed"], autocad: ["Ac", "#d6453d"], photoshop: ["Ps", "#2a4fd6"], sketchup: ["Su", "#d9822b"],
  blender: ["Bl", "#e0782a"], freecad: ["Fc", "#b8453a"], openscad: ["Os", "#c9a227"], godot: ["Gd", "#3f86b8"], unity: ["Un", "#4a4f57"],
  ableton: ["Ab", "#2b2f36"], fusion360: ["Fu", "#e0602a"], rhino: ["Rh", "#3a3a3a"], archicad: ["Ar", "#1f8a70"], solidworks: ["Sw", "#c8372d"],
  maya: ["My", "#2a8c8c"], ifc: ["Ifc", "#5b7f3a"], unreal: ["Ue", "#222a45"], matlab: ["Ml", "#d9622b"], bonsai: ["Bo", "#6a9a3a"],
  qgis: ["Qg", "#4f8f3a"], altium: ["Al", "#b8742a"], abaqus: ["Aq", "#2f5f9f"], ansys: ["An", "#c9a227"], nx: ["Nx", "#0f8a8a"],
  inventor: ["In", "#d6902d"], etabs: ["Et", "#4a66a8"], opensees: ["Op", "#7a4aa8"], kicad: ["Ki", "#2f6f9f"], civil3d: ["C3", "#c03d3d"],
  openfoam: ["Of", "#5a6a7a"], sap2000: ["Sp", "#6a5aa8"], comsol: ["Co", "#3a6fb0"], ltspice: ["Lt", "#2a8a5a"],
};
// filter chips -> categories
const CHIPS = { all: null, archcad: ["bim", "gis"], mech: ["cad", "mech"], analysis: ["analysis"], electronics: ["electronics", "audio"], visual: ["image", "3d"], game: ["game"] };
const name = (m) => m.name[S.settings.language] ?? m.name.tr;
const desc = (m) => m.desc[S.settings.language] ?? m.desc.tr;
const lbl = (o) => (o && typeof o === "object" ? (o[S.settings.language] ?? o.tr) : o);

const I = {
  gear: '<path d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm8 3.5l-1.7-.5a6.7 6.7 0 00-.6-1.5l.9-1.5-1.8-1.8-1.5.9a6.7 6.7 0 00-1.5-.6L13.5 4h-3l-.5 1.7a6.7 6.7 0 00-1.5.6l-1.5-.9-1.8 1.8.9 1.5c-.3.5-.5 1-.6 1.5L4 10.5v3l1.7.5c.1.5.3 1 .6 1.5l-.9 1.5 1.8 1.8 1.5-.9c.5.3 1 .5 1.5.6l.5 1.7h3l.5-1.7c.5-.1 1-.3 1.5-.6l1.5.9 1.8-1.8-.9-1.5c.3-.5.5-1 .6-1.5l1.7-.5z"/>',
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>', doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12l5 5 9-10"/>', warn: '<path d="M12 4l9 16H3zM12 10v5M12 18v.5"/>', play: '<path d="M7 5v14l12-7z"/>', refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>', plus: '<path d="M12 5v14M5 12h14"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  store: '<path d="M4 8l2-4h12l2 4M4 8v12h16V8M4 8h16M9 13h6"/>', plug: '<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 01-12 0zM12 18v3"/>', book: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11"/>',
  down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
};
const icon = (n, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;

// ---------------------------------------------------------------- toast + modal

function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.classList.add("out"), 3600);
  setTimeout(() => el.remove(), 4100);
}

function modal({ title, body, confirm, danger = false, cancel = true }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-bg";
    wrap.innerHTML = `<div class="modal ${danger ? "danger" : ""}" role="dialog" aria-modal="true">
      <h3>${danger ? icon("warn") : ""}${esc(title ?? "")}</h3><p>${esc(body)}</p>
      <div class="modal-actions">${cancel ? `<button class="btn" data-r="0">${esc(t("btn.cancel"))}</button>` : ""}<button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-r="1">${esc(confirm ?? t("btn.ok"))}</button></div></div>`;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener("click", (e) => { const r = e.target.closest("[data-r]"); if (r) done(r.dataset.r === "1"); else if (e.target === wrap) done(false); });
    document.body.append(wrap);
    $("[data-r='1']", wrap).focus();
  });
}

// ---------------------------------------------------------------- state

async function load({ quiet = false } = {}) {
  try {
    const next = await api("GET", "/api/state");
    const changed = JSON.stringify(next) !== JSON.stringify(S);
    S = next;
    t = makeT(S.settings.language);
    if (changed || !quiet) render();
  } catch (e) { if (!quiet) toast(e.message, "err"); }
}

async function post(path, body, { silent = false } = {}) {
  try {
    const r = await api("POST", path, body);
    if (r.state) { S = r.state; t = makeT(S.settings.language); }
    return r;
  } catch (e) { if (!silent) toast(`${t("toast.error")}: ${e.message}`, "err"); throw e; }
}

const notify = (r) => {
  for (const x of r.addonResults ?? []) toast(`${x.target}: ${x.ok ? (x.message || t("toast.addonOk")) : x.message}`, x.ok ? "ok" : "err");
  for (const n of r.portNotes ?? r.notes ?? []) toast(t("ports.moved", { name: n.id, from: n.from, to: n.to }), "info");
};
const patchMcp = (id, patch) => post("/api/settings", { mcps: { [id]: patch } }).then((r) => { notify(r); render(); return r; });
const setOption = (id, key, value) => patchMcp(id, { options: { [key]: value } });

// ---------------------------------------------------------------- rendering

const NAV = [["overview", "grid", "nav.overview"], ["store", "store", "nav.store"], ["ports", "plug", "nav.ports"], ["guides", "book", "nav.guides"],
  ["diagnostics", "pulse", "nav.diagnostics"], ["settings", "gear", "nav.settings"], ["logs", "doc", "nav.logs"], ["about", "info", "nav.about"]];

function render() {
  if (!S) return;
  document.documentElement.lang = S.settings.language;
  if (S.settings.theme === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = S.settings.theme;
  const views = { overview: viewOverview, store: viewStore, ports: viewPorts, guides: viewGuides, diagnostics: viewDiagnostics, settings: viewSettings, logs: viewLogs, about: viewAbout };
  const c = S.claude;
  const navBadge = (id) => (id === "store" && S.catalog.updates.length ? `<span class="dot-badge">${S.catalog.updates.length}</span>` : id === "ports" && S.ports.some((p) => p.status === "duplicate" || p.status === "foreign") ? `<span class="dot-badge warn">!</span>` : "");
  const scroll = $("#view")?.scrollTop ?? 0, dscroll = $("#drawer .drawer-body")?.scrollTop ?? 0;
  $("#app").innerHTML = `
    <aside class="side">
      <div class="brand"><img src="logo.svg" alt="" width="34" height="34"><div><b>${esc(t("appName"))}</b><small>v${esc(S.version)}</small></div></div>
      <nav>${NAV.map(([id, ic, key]) => `<button class="nav ${ui.view === id ? "on" : ""}" data-nav="${id}">${icon(ic)}<span>${esc(t(key))}</span>${navBadge(id)}</button>`).join("")}</nav>
      <div class="side-foot">${sideChips()}</div>
    </aside>
    <main id="view">${views[ui.view]()}</main>
    <section id="drawer" class="${ui.openId ? "open" : ""}" aria-hidden="${ui.openId ? "false" : "true"}">${ui.openId ? drawer(S.mcps.find((m) => m.id === ui.openId)) : ""}</section>`;
  $("#view").scrollTop = scroll;
  const db = $("#drawer .drawer-body"); if (db) db.scrollTop = dscroll;
}

const clientOn = (id) => !!S.settings.clients?.[id]?.enabled;

/** One chip per enabled AI app (Claude Desktop, Codex, Antigravity, OpenCode); a hint when none is enabled. */
function sideChips() {
  const on = S.clients.filter((c) => c.enabled);
  if (!on.length) return `<div class="chip bad"><i></i>${esc(t("clients.none"))}</div>`;
  return on.map((c) => `<div class="chip ${c.detected ? "ok" : "bad"}" title="${esc(c.detected ? t("clients.detected") : t("clients.notFound"))}"><i></i>${esc(c.name)}${c.id === "claude" && S.claude.running ? ` · ${esc(t("claude.running"))}` : ""}</div>`).join("");
}

function pendingBanner() {
  const n = Math.max(S.pending.length, S.clients.filter((c) => !c.inSync).length);
  if (!n) return "";
  return `<div class="banner"><div><b>${esc(t("banner.pending", { n }))}</b><small>${esc(t(clientOn("claude") ? "banner.hint" : "banner.hintOther"))}</small></div>
    <div class="banner-actions"><button class="btn ${clientOn("claude") ? "" : "btn-primary"}" data-act="apply">${esc(t("btn.apply"))}</button>${clientOn("claude") ? `<button class="btn btn-primary" data-act="apply-restart">${icon("refresh")}${esc(t("btn.applyRestart"))}</button>` : ""}</div></div>`;
}

const chipsRow = () => `<div class="pills">${Object.keys(CHIPS).map((k) => `<button class="pill ${ui.chip === k ? "on" : ""}" data-chip="${k}">${esc(t(`cat.${k}`))}</button>`).join("")}</div>`;
const inChip = (m) => !CHIPS[ui.chip] || CHIPS[ui.chip].includes(m.category);

function profileBar() {
  const names = Object.keys(S.settings.profiles ?? {});
  return `<div class="profiles"><span class="muted">${esc(t("profile.title"))}</span>
    ${names.map((n) => `<span class="pchip"><button data-act="profile-apply" data-name="${esc(n)}" title="${esc(t("profile.applyHint"))}">${esc(n)}</button><button class="icon-btn sm" data-act="profile-delete" data-name="${esc(n)}" aria-label="${esc(t("opt.remove"))}">${icon("x")}</button></span>`).join("")}
    <span class="inline-save"><input type="text" id="profile-name" maxlength="40" placeholder="${esc(t("profile.placeholder"))}" value="${esc(ui.profileName)}"><button class="btn btn-sm" data-act="profile-save">${esc(t("profile.save"))}</button></span></div>`;
}

function viewOverview() {
  const list = S.mcps.filter((m) => m.installed && m.kind !== "manual").filter(inChip);
  const act = S.mcps.filter((m) => m.status === "active").length, pend = S.pending.length, avail = S.mcps.filter((m) => m.installed && m.kind === "local").length;
  const empty = !list.length ? `<div class="empty"><p>${esc(t("overview.empty"))}</p><button class="btn btn-primary" data-nav="store">${icon("store")}${esc(t("nav.store"))}</button></div>` : "";
  return `<header class="page-h"><div><h1>${esc(t("overview.title"))}</h1><p>${esc(t("overview.sub"))}</p></div>
    <div class="stats"><span><b>${act}</b> ${esc(t("summary.active"))}</span><span><b>${pend}</b> ${esc(t("summary.pending"))}</span><span><b>${avail}</b> ${esc(t("summary.available"))}</span></div></header>
    ${pendingBanner()}${chipsRow()}${profileBar()}<div class="grid">${list.map(card).join("")}</div>${empty}`;
}

const badge = (m) => `<span class="badge s-${m.status}">${esc(t(`status.${m.status}`))}</span>`;
const tierBadge = (m) => (m.tier && m.tier !== "stable" ? `<span class="badge tier-${esc(m.tier)}">${esc(t(`tier.${m.tier}`))}</span>` : "");

function card(m) {
  const [letters, color] = TILE[m.id] ?? ["?", "#666"];
  const test = ui.tests[m.id];
  const local = m.kind === "local";
  const meta = local
    ? `<span class="meta ${m.app.found ? "good" : "dim"}">${icon(m.app.found ? "check" : "warn")}${esc(m.app.found ? `${t("card.appFound")}${m.app.versions.length ? ` · ${m.app.versions.slice(0, 2).join(", ")}` : ""}` : t("card.appMissing"))}</span>`
    : `<span class="meta dim">${icon("info")}${esc(t("card.cloud"))}</span>`;
  const warns = m.warnings.filter((w) => w !== "app-missing").map((w) => `<div class="warn-line">${icon("warn")}${esc(t(`warn.${w}`))}</div>`).join("");
  const upd = S.catalog.updates.find((u) => u.id === m.id);
  return `<article class="card" data-id="${m.id}">
    <div class="card-top"><div class="tile" style="--c:${color}">${letters}</div>
      <div class="card-title"><h3>${esc(name(m))}</h3><div class="badges">${badge(m)}${tierBadge(m)}</div></div>
      ${local ? `<label class="switch" title="${esc(t("card.connect"))}"><input type="checkbox" data-act="toggle" data-id="${m.id}" ${m.enabled ? "checked" : ""}><span></span></label>` : ""}</div>
    <p class="card-desc">${esc(desc(m))}</p>
    <div class="card-meta">${meta}<span class="meta dim">${esc(lbl(m.appNote))}</span></div>${warns}
    ${upd ? `<div class="warn-line">${icon("down")}${esc(t("store.updateAvail", { from: upd.installed, to: upd.available }))}</div>` : ""}
    ${test ? `<div class="mini-test ${test.running ? "run" : test.result?.ok ? "good" : "bad"}">${test.running ? esc(t("test.running")) : esc(testSummary(test.result))}</div>` : ""}
    <div class="card-actions">
      ${local ? `<button class="btn btn-sm" data-act="test" data-id="${m.id}" ${ui.busy.has(`t${m.id}`) ? "disabled" : ""}>${icon("play")}${esc(t("card.test"))}</button>` : ""}
      ${m.app.exe ? `<button class="btn btn-sm" data-act="openapp" data-id="${m.id}">${esc(t("card.openApp"))}</button>` : ""}
      ${m.kind === "cloud" ? `<button class="btn btn-sm btn-primary" data-act="open-url" data-what="sketchup-page">${icon("ext")}SketchUp</button>` : ""}
      <button class="btn btn-sm ghost" data-act="guide" data-id="${m.id}">${icon("book")}${esc(t("card.guide"))}</button>
      <button class="btn btn-sm ghost" data-act="open" data-id="${m.id}">${icon("gear")}${esc(t("card.settings"))}</button>
    </div></article>`;
}

function testSummary(r) {
  if (!r) return "";
  const s = r.servers.filter((x) => x.ok).map((x) => `${x.tools} ${t("test.tools")} · ${x.ms} ms`).join(", ");
  return r.ok ? `${t("test.ok")} · ${s}` : `${t("test.fail")}${r.servers.find((x) => !x.ok) ? `: ${r.servers.find((x) => !x.ok).message.slice(0, 120)}` : ""}`;
}

// ---------------------------------------------------------------- store

function jobBar(id) {
  const j = ui.jobs[id];
  if (!j) return "";
  if (j.state === "error") return `<div class="warn-line">${icon("warn")}${esc(j.message)}</div>`;
  const pct = j.total ? Math.min(100, Math.round((j.got / j.total) * 100)) : 0;
  return `<div class="progress"><div style="width:${j.state === "done" ? 100 : pct}%"></div></div><small class="muted">${esc(j.state === "running" ? (j.total ? `${mb(j.got)} / ${mb(j.total)}` : t("store.working")) : t("store.done"))}</small>`;
}

function storeCard(m) {
  const [letters, color] = TILE[m.id] ?? ["?", "#666"];
  const entry = S.catalog.packs[m.id];
  const running = ui.jobs[m.id]?.state === "running";
  let action;
  if (m.kind === "manual") action = `<button class="btn btn-sm btn-primary" data-act="guide" data-id="${m.id}">${icon("book")}${esc(t("card.guide"))}</button>`;
  else if (m.isPack && entry) action = `<button class="btn btn-sm btn-primary" data-act="pack-install" data-id="${m.id}" ${running ? "disabled" : ""}>${icon("down")}${esc(t("store.install"))}</button><span class="muted small">${esc(mb(entry.size))}</span>`;
  else if (m.isPack) action = `<span class="muted small">${esc(t("store.notInCatalog"))}</span>`;
  else action = `<span class="muted small">${esc(t("card.notInstalled"))}</span>`;
  const tierLabel = m.kind === "manual" ? `<span class="badge tier-manual">${esc(t("tier.manual"))}</span>` : (tierBadge(m) || `<span class="badge tier-stable">${esc(t("tier.stable"))}</span>`);
  return `<article class="card" data-id="${m.id}">
    <div class="card-top"><div class="tile" style="--c:${color}">${letters}</div>
      <div class="card-title"><h3>${esc(name(m))}</h3><div class="badges">${tierLabel}</div></div></div>
    <p class="card-desc">${esc(desc(m))}</p>
    <div class="card-meta"><span class="meta dim">${esc(lbl(m.appNote))}</span>${entry ? `<span class="meta dim">${esc(t("store.license"))}: ${esc(entry.license)}</span>` : ""}</div>
    ${jobBar(m.id)}
    <div class="card-actions">${action}<button class="btn btn-sm ghost" data-act="guide" data-id="${m.id}">${icon("book")}${esc(t("card.guide"))}</button></div></article>`;
}

function viewStore() {
  // once per panel session, quietly look for a newer signed catalog (new packs, updates); offline or failing is not an error here
  if (!ui.catalogChecked && S.catalog.baseUrl) {
    ui.catalogChecked = true;
    post("/api/catalog/refresh", {}, { silent: true }).then(() => { if (ui.view === "store") render(); }, () => {});
  }
  const q = ui.storeQuery.trim().toLowerCase();
  const items = S.mcps.filter((m) => (!m.installed || m.kind === "manual") && m.kind !== "cloud").filter(inChip)
    .filter((m) => ui.storeTier === "all" || (ui.storeTier === "manual" ? m.kind === "manual" : m.tier === ui.storeTier && m.kind !== "manual"))
    .filter((m) => !q || `${name(m)} ${desc(m)} ${m.id}`.toLowerCase().includes(q));
  const cat = S.catalog;
  const upd = cat.updates.map((u) => `<div class="warn-line">${icon("down")}<span>${esc(name(S.mcps.find((m) => m.id === u.id)))}: ${esc(t("store.updateAvail", { from: u.installed, to: u.available }))}</span><button class="btn btn-sm" data-act="pack-install" data-id="${u.id}">${esc(t("store.update"))}</button></div>`).join("");
  const tiers = ["all", "stable", "experimental", "manual"];
  return `<header class="page-h"><div><h1>${esc(t("store.title"))}</h1><p>${esc(t("store.sub"))}</p></div>
    <div class="btn-row"><button class="btn btn-sm" data-act="catalog-refresh">${icon("refresh")}${esc(t("store.refresh"))}</button><button class="btn btn-sm" data-act="pack-import">${icon("folder")}${esc(t("store.import"))}</button></div></header>
    <div class="catalog-info ${cat.error ? "bad" : ""}">${icon(cat.error ? "warn" : "check")}<span>${esc(t(`store.source.${cat.source}`))}${cat.generated ? ` · ${esc(new Date(cat.generated).toLocaleDateString(S.settings.language))}` : ""}${cat.error ? ` · ${esc(cat.error)}` : ""}</span></div>
    ${upd}${chipsRow()}
    <div class="store-tools"><input type="search" id="store-q" placeholder="${esc(t("store.search"))}" value="${esc(ui.storeQuery)}">
      <div class="pills">${tiers.map((k) => `<button class="pill ${ui.storeTier === k ? "on" : ""}" data-tier="${k}">${esc(t(`tier.${k}`))}</button>`).join("")}</div></div>
    <div class="grid">${items.map(storeCard).join("")}</div>${items.length ? "" : `<div class="empty"><p>${esc(t("store.empty"))}</p></div>`}`;
}

// ---------------------------------------------------------------- ports

const portStatus = (p) => (p.status === "duplicate" ? t("ports.duplicate", { other: p.clash }) : p.status === "foreign" ? t("ports.foreign", { name: p.owner?.name ?? "?" }) : p.status === "host" ? t("ports.host") : t("ports.free"));

function viewPorts() {
  const rows = S.ports.map((p) => `<tr class="${p.status}"><td><b>${esc(p.label)}</b></td><td class="mono">${p.range > 1 ? `${p.port}–${p.port + p.range - 1}` : p.port}</td>
    <td>${esc(t(`ports.side.${p.side}`))}</td><td><span class="tag ${p.status === "free" || p.status === "host" ? "good" : "bad"}">${esc(portStatus(p))}</span></td></tr>`).join("");
  const bad = S.ports.some((p) => p.status === "duplicate" || p.status === "foreign");
  return `<header class="page-h"><div><h1>${esc(t("ports.title"))}</h1><p>${esc(t("ports.sub"))}</p></div>
    <div class="btn-row"><button class="btn ${bad ? "btn-primary" : ""}" data-act="ports-auto">${icon("refresh")}${esc(t("ports.auto"))}</button></div></header>
    ${S.ports.length ? `<div class="panel flush"><table class="tbl wide"><thead><tr><th>${esc(t("ports.col.mcp"))}</th><th>${esc(t("ports.col.port"))}</th><th>${esc(t("ports.col.side"))}</th><th>${esc(t("ports.col.status"))}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><p>${esc(t("ports.none"))}</p></div>`}
    <section class="panel"><h3>${esc(t("ports.how"))}</h3><ul class="g-list">${["server", "host-patch", "host-manual", "fixed"].map((s) => `<li><b>${esc(t(`ports.side.${s}`))}</b> — ${esc(t(`ports.sideHelp.${s}`))}</li>`).join("")}</ul>
      <button class="btn btn-sm" data-act="guide" data-id="ports">${icon("book")}${esc(t("card.guide"))}</button></section>`;
}

// ---------------------------------------------------------------- guides

function viewGuides() {
  const idx = guideIndex(S, S.settings.language);
  const link = (g) => `<button class="g-link ${ui.guideId === g.id ? "on" : ""}" data-guide="${esc(g.id)}">${esc(g.title)}${g.tier === "experimental" ? ` <span class="tag">${esc(t("tier.experimental"))}</span>` : ""}${g.installed === false ? ` <span class="tag dim">${esc(t("guide.notInstalledShort"))}</span>` : ""}</button>`;
  return `<header class="page-h"><div><h1>${esc(t("guides.title"))}</h1><p>${esc(t("guides.sub"))}</p></div></header>
    <div class="guides"><nav class="g-index"><h5>${esc(t("guides.general"))}</h5>${idx.general.map(link).join("")}<h5>${esc(t("guides.programs"))}</h5>${idx.programs.map(link).join("")}</nav>
    <div class="g-content">${renderGuide(ui.guideId, S.settings.language, S)}</div></div>`;
}

// ---------------------------------------------------------------- drawer (per-MCP details)

function drawer(m) {
  if (!m) return "";
  const [letters, color] = TILE[m.id] ?? ["?", "#666"];
  const local = m.kind === "local";
  const test = ui.tests[m.id];
  const opts = m.schema.map((o) => optionRow(m, o)).join("");
  const how = (m.howTo?.[S.settings.language] ?? m.howTo?.tr ?? []).map((s) => `<li>${esc(s)}</li>`).join("");
  const portRows = S.ports.filter((p) => p.id === m.id);
  return `<div class="drawer-h"><div class="tile" style="--c:${color}">${letters}</div><div><h2>${esc(name(m))}</h2><div class="badges">${badge(m)}${tierBadge(m)}${m.packVersion ? `<span class="tag">${esc(m.packVersion)}</span>` : ""}</div></div>
      <button class="icon-btn" data-act="close" aria-label="${esc(t("drawer.close"))}">${icon("x")}</button></div>
    <div class="drawer-body">
      <p class="muted">${esc(desc(m))}</p>
      <div class="btn-row"><button class="btn btn-sm" data-act="guide" data-id="${m.id}">${icon("book")}${esc(t("card.guide"))}</button>
        ${m.homepage ? `<button class="btn btn-sm" data-act="open-url" data-what="homepage" data-id="${m.id}">${icon("ext")}${esc(t("guide.homepage"))}</button>` : ""}</div>
      ${local && m.installed ? `<div class="sect"><h4>${esc(t("drawer.connection"))}</h4>
        <label class="row"><span>${esc(t("card.connect"))}</span><span class="switch"><input type="checkbox" data-act="toggle" data-id="${m.id}" ${m.enabled ? "checked" : ""}><span></span></span></label></div>` : ""}
      ${!m.installed && m.kind === "local" ? `<p class="note">${esc(t("card.notInstalled"))}</p>` : ""}
      ${m.warnings.map((w) => `<div class="warn-line">${icon("warn")}${esc(t(`warn.${w}`))}</div>`).join("")}
      ${m.installed && m.kind === "local" ? `<div class="sect"><h4>${esc(t("drawer.options"))}</h4>${opts || `<p class="muted">${esc(t("drawer.noOptions"))}</p>`}</div>` : ""}
      ${portRows.length ? `<div class="sect"><h4>${esc(t("nav.ports"))}</h4><ul class="results">${portRows.map((p) => `<li class="${p.status === "free" || p.status === "host" ? "good" : "bad"}">${icon(p.status === "free" || p.status === "host" ? "check" : "warn")}<span>${esc(p.label)} :${p.port}${p.range > 1 ? `–${p.port + p.range - 1}` : ""} — ${esc(portStatus(p))}</span></li>`).join("")}</ul></div>` : ""}
      ${m.hasAddon && m.installed ? addonSection(m) : ""}
      ${local && m.installed ? `<div class="sect"><h4>${esc(t("drawer.test"))}</h4>
        <button class="btn btn-sm" data-act="test" data-id="${m.id}" ${ui.busy.has(`t${m.id}`) ? "disabled" : ""}>${icon("play")}${esc(t("card.test"))}</button>
        ${test ? testDetail(test) : ""}</div>` : ""}
      ${how ? `<div class="sect"><h4>${esc(t("drawer.howto"))}</h4><ol class="howto">${how}</ol></div>` : ""}
      ${m.isPack && m.installed ? `<div class="sect"><button class="btn btn-sm btn-danger-o" data-act="pack-remove" data-id="${m.id}">${icon("trash")}${esc(t("store.remove"))}</button></div>` : ""}
    </div>`;
}

function testDetail(test) {
  if (test.running) return `<div class="mini-test run">${esc(t("test.running"))}</div>`;
  const r = test.result;
  return `<ul class="results">${r.servers.map((s) => `<li class="${s.ok ? "good" : "bad"}">${icon(s.ok ? "check" : "x")}<span><b>${esc(s.key)}</b> ${esc(s.ok ? `${s.message} · ${s.tools} ${t("test.tools")} · ${s.ms} ms` : s.message.slice(0, 300))}</span></li>`).join("")}
    ${r.ports.map((p) => `<li class="${p.open ? "good" : "warnc"}">${icon(p.open ? "check" : "warn")}<span>${esc(p.label)} :${p.port} — ${esc(p.open ? t("test.portOpen") : t("test.portClosed"))}</span></li>`).join("")}</ul>`;
}

function addonSection(m) {
  const rows = m.addons.map((a) => `<li><span class="path" title="${esc(a.target)}">${esc(a.target)}</span>
    <span class="tag ${a.installed && !a.stale ? "good" : a.stale ? "bad" : "dim"}">${esc(a.stale ? t("addon.stale") : a.installed ? t("addon.installed") : t("addon.missing"))}</span>
    <button class="btn btn-sm" data-act="addon" data-id="${m.id}" data-do="install" data-target="${esc(a.target)}" ${ui.busy.has(`a${m.id}`) ? "disabled" : ""}>${esc(a.stale ? t("addon.update") : a.installed ? t("addon.reinstall") : m.id === "unity" ? t("addon.addProject") : t("addon.install"))}</button>
    ${a.installed ? `<button class="btn btn-sm ghost" data-act="addon" data-id="${m.id}" data-do="uninstall" data-target="${esc(a.target)}">${esc(t("addon.remove"))}</button>` : ""}</li>`).join("");
  return `<div class="sect"><h4>${esc(t("drawer.addon"))}</h4>${rows ? `<ul class="addons">${rows}</ul>` : `<p class="muted">${esc(t("addon.none"))}</p>`}
    ${m.addons.length > 1 ? `<button class="btn btn-sm" data-act="addon" data-id="${m.id}" data-do="install">${esc(t("addon.installAll"))}</button>` : ""}</div>`;
}

function optionRow(m, o) {
  const v = m.options[o.key];
  const help = o.help ? `<small>${esc(lbl(o.help))}</small>` : "";
  const head = `<div class="opt-h"><span>${esc(lbl(o.label))}</span>${o.danger ? `<span class="tag bad">!</span>` : ""}</div>${help}`;
  const attr = `data-opt="${esc(o.key)}" data-id="${m.id}"`;
  switch (o.type) {
    case "bool": return `<div class="opt ${o.danger ? "opt-danger" : ""}"><label class="row"><div>${head}</div><span class="switch"><input type="checkbox" ${attr} data-t="bool" ${v ? "checked" : ""}><span></span></span></label></div>`;
    case "select": return `<div class="opt">${head}<select ${attr} data-t="select">${o.choices.map((c) => `<option value="${esc(c.value)}" ${c.value === v ? "selected" : ""}>${esc(lbl(c.label))}</option>`).join("")}</select></div>`;
    case "number": return `<div class="opt">${head}<input type="number" ${attr} data-t="number" min="${o.min ?? ""}" max="${o.max ?? ""}" value="${esc(v)}"></div>`;
    case "multi": return `<div class="opt">${head}<div class="checks">${o.choices.map((c) => `<label class="chk ${c.danger ? "danger" : ""}"><input type="checkbox" ${attr} data-t="multi" data-val="${esc(c.value)}" ${(v ?? []).includes(c.value) ? "checked" : ""}><span>${esc(lbl(c.label))}</span></label>`).join("")}</div></div>`;
    case "file": case "folder": case "text": {
      const det = o.autoDetect ? (m.app.exe ? `<small class="good">${esc(t("opt.autoDetected"))}: ${esc(m.app.exe)}</small>` : `<small class="warnc">${esc(t("opt.autoDetected"))}: ${esc(t("opt.notFound"))}</small>`) : "";
      return `<div class="opt">${head}<div class="inline"><input type="text" ${attr} data-t="text" value="${esc(v)}" placeholder="${esc(o.placeholder ?? "")}">
        ${o.type !== "text" ? `<button class="btn btn-sm" data-act="pick" ${attr} data-kind="${o.type}">${esc(t("opt.browse"))}</button>` : ""}</div>${det}</div>`;
    }
    case "folders": return `<div class="opt">${head}<ul class="folders">${(v ?? []).map((p, i) => `<li><span class="path" title="${esc(p)}">${esc(p)}</span><button class="icon-btn sm" data-act="folder-remove" ${attr} data-i="${i}" aria-label="${esc(t("opt.remove"))}">${icon("x")}</button></li>`).join("")}</ul>
      <div class="inline"><input type="text" id="new-${m.id}-${esc(o.key)}" placeholder="${esc(t("opt.manualPath"))}"><button class="btn btn-sm" data-act="folder-add-text" ${attr}>${icon("plus")}</button>
      <button class="btn btn-sm" data-act="folder-add" ${attr}>${esc(t("opt.add"))}</button></div></div>`;
    default: return "";
  }
}

// ---------------------------------------------------------------- other views

function clientRow(c) {
  const state = c.enabled ? (c.inSync ? t("clients.sync") : t("clients.outOfSync")) : (c.registered ? t("clients.willRemove") : t("clients.off"));
  const files = c.files.map((f) => `<li class="${f.valid === false ? "bad" : f.exists ? "good" : "dim"}"><span class="path" title="${esc(f.path)}">${esc(f.path)}</span><span class="tag">${esc(f.exists ? (f.valid ? t("settings.valid") : t("settings.invalid")) : t("settings.missing"))}</span></li>`).join("");
  return `<div class="client">
    <div class="row"><div><span><b>${esc(c.name)}</b> <span class="tag ${c.detected ? "good" : "dim"}">${esc(c.detected ? t("clients.detected") : t("clients.notFound"))}</span></span>
      <small>${esc(t(`clients.note.${c.id}`))}</small></div>
      <label class="switch"><input type="checkbox" data-client="${esc(c.id)}" ${c.enabled ? "checked" : ""}><span></span></label></div>
    <small class="muted">${esc(state)} · ${esc(t("clients.servers", { n: c.registered }))}</small><ul class="files">${files}</ul></div>`;
}

function viewSettings() {
  const s = S.settings;
  const seg = (nm, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-set="${nm}" data-v="${v}">${esc(l)}</button>`).join("")}</div>`;
  const toggle = (key, label, help) => `<div class="row"><div><span>${esc(label)}</span><small>${esc(help)}</small></div><label class="switch"><input type="checkbox" data-setbool="${key}" ${s[key] ? "checked" : ""}><span></span></label></div>`;
  const files = S.claude.files.map((f) => `<li class="${f.valid === false ? "bad" : f.exists ? "good" : "dim"}">${icon(f.valid === false ? "x" : f.exists ? "check" : "warn")}<span class="path" title="${esc(f.path)}">${esc(f.path)}</span><span class="tag">${esc(f.exists ? (f.valid ? t("settings.valid") : t("settings.invalid")) : t("settings.missing"))}</span></li>`).join("");
  if (!ui.backups) api("GET", "/api/backups").then((r) => { ui.backups = r.backups; if (ui.view === "settings") render(); }).catch(() => { ui.backups = []; });
  const backups = (ui.backups ?? []).slice(0, 8).map((b) => `<li><span>${esc(new Date(b.time).toLocaleString(s.language))}</span><span class="tag">${esc(S.clients.find((c) => c.id === b.client)?.name ?? "")}</span><span class="path dim" title="${esc(b.path)}">${esc(b.file)}</span><button class="btn btn-sm" data-act="restore" data-path="${esc(b.path)}">${esc(t("settings.restore"))}</button></li>`).join("");
  return `<header class="page-h"><div><h1>${esc(t("settings.title"))}</h1></div></header>
    <section class="panel"><h3>${esc(t("settings.general"))}</h3>
      <div class="row"><span>${esc(t("settings.language"))}</span>${seg("language", [["tr", "Türkçe"], ["en", "English"]], s.language)}</div>
      <div class="row"><span>${esc(t("settings.theme"))}</span>${seg("theme", [["auto", t("settings.themeAuto")], ["light", t("settings.themeLight")], ["dark", t("settings.themeDark")]], s.theme)}</div></section>
    <section class="panel"><h3>${esc(t("settings.behavior"))}</h3>${toggle("autoApply", t("settings.autoApply"), t("settings.autoApplyHelp"))}${toggle("confirmRestart", t("settings.confirmRestart"), t("settings.confirmRestartHelp"))}</section>
    <section class="panel"><h3>${esc(t("settings.store"))}</h3><small class="muted">${esc(t("settings.catalogHelp"))}</small>
      <div class="inline"><input type="text" id="catalog-url" value="${esc(s.catalogUrl)}" placeholder="${esc(S.catalog.baseUrl || "…/releases/latest/download")}"><button class="btn btn-sm" data-act="catalog-refresh">${icon("refresh")}${esc(t("store.refresh"))}</button></div></section>
    <section class="panel"><h3>${esc(t("clients.title"))}</h3><small class="muted">${esc(t("clients.help"))}</small>${S.clients.map(clientRow).join("")}</section>
    <section class="panel"><h3>${esc(t("settings.claude"))}</h3><h5>${esc(t("settings.configFiles"))}</h5><ul class="files">${files}</ul>
      <h5>${esc(t("settings.extraConfig"))}</h5><small class="muted">${esc(t("settings.extraConfigHelp"))}</small>
      <div class="inline"><input type="text" id="extra-config" value="${esc(s.extraClaudeConfig)}" placeholder="D:\\Portable\\Claude\\claude_desktop_config.json"><button class="btn btn-sm" data-act="pick-extra">${esc(t("opt.browse"))}</button></div>
      <h5>${esc(t("settings.backups"))}</h5><small class="muted">${esc(t("settings.backupsHelp"))}</small>
      ${backups ? `<ul class="backups">${backups}</ul>` : `<p class="muted">${esc(t("settings.noBackups"))}</p>`}</section>
    <section class="panel"><h3>${esc(t("settings.folders"))}</h3><div class="btn-row">
      <button class="btn btn-sm" data-act="open-url" data-what="install-dir">${icon("folder")}${esc(t("settings.openInstall"))}</button>
      <button class="btn btn-sm" data-act="open-url" data-what="data-dir">${icon("folder")}${esc(t("settings.openData"))}</button>
      <button class="btn btn-sm" data-act="open-url" data-what="guide">${icon("doc")}${esc(t("settings.openGuide"))}</button></div></section>
    <section class="panel"><h3>${esc(t("settings.privacy"))}</h3><p class="muted">${esc(t("settings.privacyText"))}</p></section>
    <section class="panel"><button class="btn btn-danger-o" data-act="reset">${esc(t("settings.reset"))}</button></section>`;
}

function diagRows() {
  const rows = S.mcps.filter((m) => m.kind === "local" && m.installed);
  if (!rows.length) return `<p class="muted">${esc(t("diag.none"))}</p>`;
  return `<div class="panel flush"><ul class="diag">${rows.map((m) => {
    const test = ui.tests[m.id];
    return `<li><div class="d-name"><div class="tile sm" style="--c:${(TILE[m.id] ?? ["", "#666"])[1]}">${(TILE[m.id] ?? ["?"])[0]}</div><b>${esc(name(m))}</b>${m.enabled ? "" : `<span class="tag dim">${esc(t("diag.disabledSkip"))}</span>`}</div>
      <div class="d-res">${test ? testDetail(test) : ""}</div></li>`;
  }).join("")}</ul></div>`;
}

function systemSection() {
  if (!ui.system) api("GET", "/api/system").then((r) => { ui.system = r; if (ui.view === "diagnostics") render(); }).catch(() => {});
  const sys = ui.system;
  if (!sys) return `<p class="muted">${esc(t("test.running"))}</p>`;
  const row = (c) => {
    const key = `sys.${c.id}`;
    const dataText = Object.entries(c.data ?? {}).filter(([k]) => ["version", "build", "freeGb", "length", "out", "arch", "why"].includes(k)).map(([, v]) => v).filter((v) => v !== undefined && v !== "").join(" · ");
    const cls = c.status === "ok" ? "good" : c.status === "skip" ? "dim" : c.status === "warn" ? "warnc" : "bad";
    return `<li class="${cls}">${icon(c.status === "ok" ? "check" : c.status === "skip" ? "info" : c.status === "warn" ? "warn" : "x")}
      <span><b>${esc(t(key))}</b>${dataText ? ` <span class="muted">${esc(dataText)}</span>` : ""}${c.status === "fail" || c.status === "warn" ? `<small class="fixline">${esc(t(`${key}.fix`))}</small>` : ""}</span></li>`;
  };
  return `<ul class="results sys">${sys.checks.map(row).join("")}</ul>`;
}

function viewDiagnostics() {
  return `<header class="page-h"><div><h1>${esc(t("diag.title"))}</h1><p>${esc(t("diag.sub"))}</p></div>
    <div class="btn-row"><button class="btn btn-primary" data-act="test-all" ${ui.diagRunning ? "disabled" : ""}>${icon("play")}${esc(t("diag.runAll"))}</button><button class="btn" data-act="copy-report">${esc(t("diag.copy"))}</button></div></header>
    <section class="panel"><div class="sect-h"><h3>${esc(t("diag.system"))}</h3><button class="btn btn-sm ghost" data-act="system-refresh">${icon("refresh")}</button></div>${systemSection()}</section>${diagRows()}`;
}

function viewLogs() {
  if (!ui.logs) api("GET", `/api/logs?name=${ui.logName}`).then((r) => { ui.logs = r; if (ui.view === "logs") render(); }).catch(() => {});
  const names = ui.logs?.names ?? ["gui", "setup-install", "setup-uninstall"];
  return `<header class="page-h"><div><h1>${esc(t("logs.title"))}</h1></div><div class="btn-row"><button class="btn btn-sm" data-act="logs-refresh">${icon("refresh")}${esc(t("logs.refresh"))}</button></div></header>
    <div class="pills">${names.map((n) => `<button class="pill ${ui.logName === n ? "on" : ""}" data-log="${n}">${esc(n)}</button>`).join("")}</div>
    <pre class="log">${esc(ui.logs?.text || t("logs.empty"))}</pre>`;
}

function viewAbout() {
  const v = S.versions ?? {};
  const rows = [["Node.js", v.node?.version], ["Python", v.python?.version], ["Revit MCP", v.revit?.version], ["Photoshop MCP", v.photoshop?.commit?.slice(0, 8)], ["AutoCAD MCP", v.autocad?.version],
    ["Blender MCP", v.blender?.version], ["FreeCAD MCP", v.freecad?.version], ["OpenSCAD MCP", v.openscad?.version], ["Godot MCP", v.godot?.version], ["Unity MCP", v.unity?.version]]
    .filter(([, x]) => x).map(([k, x]) => `<tr><td>${esc(k)}</td><td>${esc(x)}</td></tr>`).join("");
  const packs = S.mcps.filter((m) => m.packVersion).map((m) => `<tr><td>${esc(name(m))}</td><td>${esc(m.packVersion)}</td></tr>`).join("");
  return `<header class="page-h"><div><h1>${esc(t("about.title"))}</h1><p>${esc(t("tagline"))}</p></div></header>
    <section class="panel"><div class="about-h"><img src="logo.svg" alt="" width="52" height="52"><div><b>${esc(t("appName"))}</b><br><span class="muted">${esc(t("about.version"))} ${esc(S.version)}</span></div></div>
      <p class="muted">${esc(t("about.disclaimer"))}</p>
      ${S.settings.consentAcceptedAt ? `<p class="muted">${esc(t("about.consent"))}: ${esc(new Date(S.settings.consentAcceptedAt).toLocaleString(S.settings.language))}</p>` : ""}</section>
    <section class="panel"><h3>${esc(t("about.bundled"))}</h3><table class="tbl">${rows}${packs}</table>
      <div class="btn-row"><button class="btn btn-sm" data-act="open-url" data-what="notices">${icon("doc")}${esc(t("about.notices"))}</button><button class="btn btn-sm" data-act="open-url" data-what="sbom">${icon("doc")}${esc(t("about.sbom"))}</button></div></section>`;
}

// ---------------------------------------------------------------- actions

async function applyToClaude() {
  const r = await post("/api/apply", {});
  const names = Object.fromEntries(S.clients.map((c) => [c.id, c.name]));
  const wanted = Object.keys(r.clients ?? {}).filter((id) => clientOn(id));
  const bad = wanted.flatMap((id) => r.clients[id].filter((x) => !x.ok).map((x) => ({ ...x, id })));
  const empty = wanted.filter((id) => !r.clients[id].length);
  if (!wanted.length) toast(t("clients.none"), "err");
  else if (empty.length) toast(`${t("toast.noClient", { name: names[empty[0]] })}`, "err");
  else if (bad.length) toast(`${t("toast.appliedPartial")}: ${names[bad[0].id]} - ${bad[0].error ?? ""}`, "err");
  else toast(t("toast.applied"));
  render();
  return wanted.length > 0 && !bad.length && !empty.length;
}

async function restartClaude() {
  if (S.settings.confirmRestart && !(await modal({ body: t("restart.confirm"), confirm: t("btn.continue") }))) return;
  toast(t("toast.restarting"), "info");
  const r = await post("/api/restart-claude", {});
  if (r.ok) toast(t("toast.restarted")); else toast(r.message ?? t("toast.error"), "err");
  setTimeout(() => load({ quiet: true }), 1500);
}

async function runTest(id) {
  ui.tests[id] = { running: true }; ui.busy.add(`t${id}`); render();
  try { ui.tests[id] = { result: await api("POST", `/api/mcp/${id}/test`, {}) }; }
  catch (e) { ui.tests[id] = { result: { ok: false, servers: [{ key: id, ok: false, message: e.message }], ports: [] } }; }
  ui.busy.delete(`t${id}`); render();
}

/** Follows a background install/import job until it finishes. */
async function followJob(id, job) {
  ui.jobs[id] = job;
  render();
  while (ui.jobs[id].state === "running") {
    await new Promise((r) => setTimeout(r, 400));
    try { ui.jobs[id] = await api("GET", `/api/jobs/${job.id}`); } catch { ui.jobs[id] = { state: "error", message: "lost contact with the panel" }; }
    if (ui.view === "store") render();
  }
  const j = ui.jobs[id];
  if (j.state === "done") { toast(t("store.installed", { name: id })); delete ui.jobs[id]; await load(); }
  else { toast(`${t("toast.error")}: ${j.message}`, "err"); render(); }
}

const confirmDanger = (kind) => modal({ title: t("danger.title"), body: t(`danger.${kind}`), confirm: t("danger.confirm"), danger: true });
const pickPath = (kind) => post("/api/pick", { kind, title: "ArchMCP" }, { silent: true }).catch((err) => { toast(String(err.message).includes("Windows") ? t("toast.pickUnsupported") : err.message, "err"); return null; });

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-nav],[data-chip],[data-tier],[data-act],[data-set],[data-log],[data-guide]");
  if (!el) return;
  const d = el.dataset;
  try {
    if (d.nav) { ui.view = d.nav; if (d.nav === "logs") ui.logs = null; if (d.nav === "settings") ui.backups = null; if (d.nav === "diagnostics") ui.system = null; ui.openId = null; render(); }
    else if (d.chip) { ui.chip = d.chip; render(); }
    else if (d.tier) { ui.storeTier = d.tier; render(); }
    else if (d.guide) { ui.guideId = d.guide; render(); $("#view").scrollTop = 0; }
    else if (d.set) { await post("/api/settings", { [d.set]: d.v }); render(); toast(t("toast.saved")); }
    else if (d.log) { ui.logName = d.log; ui.logs = null; render(); }
    else switch (d.act) {
      case "open": ui.openId = d.id; render(); break;
      case "close": ui.openId = null; render(); break;
      case "guide": ui.guideId = d.id; ui.view = "guides"; ui.openId = null; render(); $("#view").scrollTop = 0; break;
      case "apply": await applyToClaude(); break;
      case "apply-restart": if (await applyToClaude() && clientOn("claude")) await restartClaude(); break;
      case "test": await runTest(d.id); break;
      case "test-all": ui.diagRunning = true; render(); for (const m of S.mcps.filter((x) => x.kind === "local" && x.installed)) await runTest(m.id); ui.diagRunning = false; ui.system = null; render(); break;
      case "system-refresh": ui.system = null; render(); break;
      case "copy-report": {
        const { text } = await api("GET", "/api/report");
        const extra = Object.entries(ui.tests).filter(([, x]) => x.result).map(([k, x]) => `test ${k}: ${testSummary(x.result)}`).join("\n");
        await navigator.clipboard.writeText(`${text}\n${extra}`); toast(t("diag.copied")); break;
      }
      case "openapp": await post(`/api/mcp/${d.id}/open-app`, {}); break;
      case "open-url": await post("/api/open", { what: d.what, id: d.id }); break;
      case "logs-refresh": ui.logs = null; render(); break;
      case "pack-install": { const r = await post(`/api/packs/${d.id}/install`, {}); await followJob(d.id, r.job); break; }
      case "pack-remove":
        if (await modal({ body: t("store.removeConfirm"), confirm: t("store.remove"), danger: true })) { await post(`/api/packs/${d.id}/remove`, {}); ui.openId = null; toast(t("store.removed")); render(); }
        break;
      case "pack-import": {
        const r = await pickPath("file");
        if (r?.path) { const j = await post("/api/packs/import", { path: r.path }); await followJob(j.job.label.replace(/^import /, ""), j.job); }
        break;
      }
      case "catalog-refresh": {
        const r = await post("/api/catalog/refresh", {});
        toast(r.error ? `${t("store.refreshFailed")}: ${r.error}` : t("store.refreshed"), r.error ? "err" : "ok");
        render();
        break;
      }
      case "ports-auto": {
        const r = await post("/api/ports/auto", {});
        notify(r);
        for (const n of r.notes) if (n.side === "host-manual") toast(t("ports.manualHint", { name: n.id, port: n.to }), "info");
        toast(r.notes.length ? t("ports.fixed", { n: r.notes.length }) : (r.unresolved.length ? t("ports.unresolved") : t("ports.allGood")), r.unresolved.length && !r.notes.length ? "err" : "ok");
        render();
        break;
      }
      case "profile-save": {
        const nm = $("#profile-name")?.value.trim();
        if (!nm) { toast(t("profile.needName"), "err"); break; }
        ui.profileName = ""; await post("/api/profiles/save", { name: nm }); toast(t("toast.saved")); render();
        break;
      }
      case "profile-apply": { const r = await post("/api/profiles/apply", { name: d.name }); notify(r); render(); toast(t("profile.applied", { name: d.name })); break; }
      case "profile-delete": await post("/api/profiles/delete", { name: d.name }); render(); break;
      case "addon": {
        ui.busy.add(`a${d.id}`); render();
        try {
          const r = await post(`/api/mcp/${d.id}/addon`, { action: d.do, target: d.target || undefined });
          for (const x of r.results) toast(`${x.target}: ${x.ok ? (x.message || t("toast.addonOk")) : x.message}`, x.ok ? "ok" : "err");
        } finally { ui.busy.delete(`a${d.id}`); render(); }
        break;
      }
      case "pick": { const r = await pickPath(d.kind === "folder" ? "folder" : "file"); if (r?.path) await setOption(d.id, d.opt, r.path); break; }
      case "folder-add": {
        const r = await pickPath("folder");
        const m = S.mcps.find((x) => x.id === d.id);
        if (r?.path) await setOption(d.id, d.opt, [...(m.options[d.opt] ?? []), r.path]);
        break;
      }
      case "folder-add-text": {
        const input = $(`#new-${d.id}-${d.opt}`); const val = input?.value.trim();
        const m = S.mcps.find((x) => x.id === d.id);
        if (val) await setOption(d.id, d.opt, [...(m.options[d.opt] ?? []), val]);
        break;
      }
      case "folder-remove": {
        const m = S.mcps.find((x) => x.id === d.id);
        await setOption(d.id, d.opt, (m.options[d.opt] ?? []).filter((_, i) => i !== Number(d.i)));
        break;
      }
      case "restore":
        if (await modal({ body: t("settings.restoreConfirm"), confirm: t("settings.restore") })) { await post("/api/backups/restore", { path: d.path }); ui.backups = null; toast(t("toast.restored")); render(); }
        break;
      case "reset":
        if (await modal({ body: t("settings.resetConfirm"), confirm: t("settings.reset"), danger: true })) { await post("/api/reset", {}); ui.backups = null; render(); toast(t("toast.saved")); }
        break;
      case "pick-extra": { const r = await pickPath("file"); if (r?.path) { await post("/api/settings", { extraClaudeConfig: r.path }); render(); } break; }
      default: break;
    }
  } catch (err) { /* post() already toasted */ void err; }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "store-q") { ui.storeQuery = e.target.value; const pos = e.target.selectionStart; render(); const el = $("#store-q"); el?.focus(); el?.setSelectionRange(pos, pos); }
  if (e.target.id === "profile-name") ui.profileName = e.target.value;
});

document.addEventListener("change", async (e) => {
  const el = e.target;
  try {
    if (el.dataset.act === "toggle") { await patchMcp(el.dataset.id, { enabled: el.checked }); return; }
    if (el.dataset.client) { const r = await post("/api/settings", { clients: { [el.dataset.client]: { enabled: el.checked } } }); notify(r); render(); return; }
    if (el.dataset.setbool) { await post("/api/settings", { [el.dataset.setbool]: el.checked }); render(); return; }
    if (el.id === "extra-config") { await post("/api/settings", { extraClaudeConfig: el.value.trim() }); render(); return; }
    if (el.id === "catalog-url") { await post("/api/settings", { catalogUrl: el.value.trim() }); toast(t("toast.saved")); return; }
    const key = el.dataset.opt, id = el.dataset.id;
    if (!key) return;
    const m = S.mcps.find((x) => x.id === id);
    const type = el.dataset.t;
    if (type === "bool") {
      if (el.checked && key === "rawCommands" && !(await confirmDanger("raw"))) { el.checked = false; return; }
      if (el.checked && key === "runCode" && !(await confirmDanger("code"))) { el.checked = false; return; }
      await setOption(id, key, el.checked);
    } else if (type === "multi") {
      const cur = new Set(m.options[key] ?? []);
      const val = isNaN(Number(el.dataset.val)) ? el.dataset.val : Number(el.dataset.val);
      if (el.checked && val === "destructive" && !(await confirmDanger("destructive"))) { el.checked = false; return; }
      el.checked ? cur.add(val) : cur.delete(val);
      await setOption(id, key, [...cur]);
    } else if (type === "number") await setOption(id, key, Number(el.value));
    else if (type === "select") await setOption(id, key, el.value);
    else if (type === "text") await setOption(id, key, el.value.trim());
  } catch (err) { void err; await load(); }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.openId) { ui.openId = null; render(); } });

// ---------------------------------------------------------------- boot

setInterval(() => api("POST", "/api/heartbeat", {}).catch(() => {}), 5000);
setInterval(() => {
  const busy = document.activeElement?.matches?.("input[type=text],input[type=number],input[type=search],select") || document.querySelector(".modal-bg") || ui.busy.size || Object.values(ui.jobs).some((j) => j.state === "running");
  if (!busy && document.visibilityState === "visible") load({ quiet: true });
}, 6000);

load();
