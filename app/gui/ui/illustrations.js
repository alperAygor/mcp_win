// Schematic illustrations for the guides: inline SVG drawn from a small spec, themed through CSS variables (so they follow
// light/dark mode). They are explanatory diagrams of WHERE to click, not screenshots of third-party software.
// ill({ k: "menu", path: ["Edit", "Preferences", "Add-ons"], app: "Blender" }, "en") -> "<svg ...>"

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const UI = {
  tr: { connect: "Claude'a bağla", apply: "Uygula ve Claude'u yeniden başlat", claude: "Claude", server: "ArchMCP sunucusu", local: "yalnızca bu bilgisayarda", tools: "araçlar", chatHint: "Bir şey yazın…", panelName: "ArchMCP", test: "Test et", active: "Etkin", step: "adım", port: "Port" },
  en: { connect: "Connect to Claude", apply: "Apply and restart Claude", claude: "Claude", server: "ArchMCP server", local: "on this PC only", tools: "tools", chatHint: "Type something…", panelName: "ArchMCP", test: "Test", active: "Active", step: "step", port: "Port" },
};

const wrap = (w, h, body, label) => `<svg class="il" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg"><title>${esc(label)}</title>${body}</svg>`;
const rect = (x, y, w, h, cls, r = 8) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const text = (x, y, s, cls = "il-t", anchor = "start") => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s)}</text>`;
const arrow = (x1, y1, x2, y2, cls = "il-arrow") => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)"/>`;
const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="il-arrowhead"/></marker></defs>`;
const fit = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
/** a numbered highlight bubble */
const bubble = (x, y, n) => `<circle class="il-bubble" cx="${x}" cy="${y}" r="11"/><text class="il-bubble-t" x="${x}" y="${y + 4}" text-anchor="middle">${n}</text>`;

const DRAW = {
  /** Claude <-> ArchMCP server <-> application */
  flow({ app }, l) {
    const t = UI[l];
    return wrap(620, 150, `${defs}
      ${rect(10, 40, 150, 64, "il-card")}${text(85, 78, t.claude, "il-t il-b", "middle")}
      ${rect(235, 40, 160, 64, "il-card il-acc-fill")}${text(315, 70, t.server, "il-t il-b il-on-acc", "middle")}${text(315, 88, "MCP", "il-t il-on-acc", "middle")}
      ${rect(470, 40, 140, 64, "il-card")}${text(540, 78, fit(app, 16), "il-t il-b", "middle")}
      ${arrow(160, 62, 235, 62)}${arrow(235, 84, 160, 84)}${arrow(395, 62, 470, 62)}${arrow(470, 84, 395, 84)}
      ${text(315, 128, t.local, "il-t il-m", "middle")}`, `${t.claude} - ${t.server} - ${app}`);
  },

  /** the ArchMCP card with its switch highlighted */
  toggle({ name }, l) {
    const t = UI[l];
    return wrap(420, 150, `${rect(10, 10, 400, 130, "il-card")}
      ${rect(26, 26, 34, 34, "il-acc-fill", 9)}${text(43, 49, fit(name, 2), "il-t il-on-acc il-b", "middle")}
      ${text(72, 40, fit(name, 24), "il-t il-b")}${text(72, 56, t.connect, "il-t il-m")}
      ${rect(334, 28, 56, 30, "il-on-track", 15)}<circle class="il-knob" cx="375" cy="43" r="11"/>
      ${rect(26, 94, 86, 28, "il-btn")}${text(69, 112, t.test, "il-t", "middle")}
      ${bubble(362, 78, 1)}${arrow(362, 90, 362, 66)}`, `${t.panelName}: ${t.connect}`);
  },

  /** the pending banner with Apply and restart */
  apply(_, l) {
    const t = UI[l];
    return wrap(520, 110, `${defs}${rect(10, 10, 500, 90, "il-card il-warn")}
      ${text(28, 40, l === "tr" ? "1 değişiklik Claude'a henüz uygulanmadı." : "1 change not applied to Claude yet.", "il-t il-b")}
      ${rect(28, 56, 70, 28, "il-btn")}${text(63, 74, l === "tr" ? "Uygula" : "Apply", "il-t", "middle")}
      ${rect(110, 56, 250, 28, "il-acc-fill")}${text(235, 74, t.apply, "il-t il-on-acc il-b", "middle")}
      ${bubble(400, 70, 2)}${arrow(388, 70, 366, 70)}`, t.apply);
  },

  /** application window with a menu path highlighted */
  menu({ path, app }) {
    const items = path.slice(0, 5);
    const w = 620;
    let x = 14;
    let crumbs = "";
    items.forEach((p, i) => {
      const bw = Math.max(54, Math.min(170, 14 + String(p).length * 7.4));
      const last = i === items.length - 1;
      crumbs += `${rect(x, 74, bw, 30, last ? "il-acc-fill" : "il-btn")}${text(x + bw / 2, 93, fit(p, 22), last ? "il-t il-on-acc il-b" : "il-t", "middle")}`;
      x += bw;
      if (i < items.length - 1) { crumbs += arrow(x + 2, 89, x + 22, 89); x += 24; }
    });
    return wrap(Math.max(w, x + 14), 126, `${defs}${rect(2, 2, Math.max(w, x + 14) - 4, 122, "il-card")}
      ${rect(2, 2, Math.max(w, x + 14) - 4, 28, "il-bar", 8)}${text(16, 21, fit(app, 36), "il-t il-b")}
      ${["●", "●", "●"].map((d, i) => `<text class="il-dot" x="${Math.max(w, x + 14) - 56 + i * 16}" y="22">${d}</text>`).join("")}
      ${text(16, 56, items.join("  ›  "), "il-t il-m")}${crumbs}`, `${app}: ${items.join(" > ")}`);
  },

  /** a single highlighted button / checkbox in the host app */
  button({ label, caption }) {
    return wrap(420, 96, `${rect(10, 10, 400, 76, "il-card")}
      ${rect(26, 28, Math.max(120, 30 + String(label).length * 8), 34, "il-acc-fill")}${text(26 + Math.max(120, 30 + String(label).length * 8) / 2, 50, fit(label, 36), "il-t il-on-acc il-b", "middle")}
      ${caption ? text(26, 78, fit(caption, 52), "il-t il-m") : ""}`, label);
  },

  /** a text field with a value (paths, ports) */
  field({ label, value }) {
    return wrap(460, 86, `${text(14, 24, fit(label, 56), "il-t il-b")}${rect(12, 34, 436, 36, "il-input")}${text(24, 57, fit(value, 56), "il-t il-mono")}`, `${label}: ${value}`);
  },

  /** the chat box: tools icon and the list of archmcp servers */
  chat({ name }, l) {
    const t = UI[l];
    return wrap(520, 190, `${rect(10, 120, 500, 56, "il-card")}${text(28, 154, t.chatHint, "il-t il-m")}
      ${rect(440, 132, 56, 32, "il-btn")}<g class="il-icon"><path d="M452 148h32M452 140h32M452 156h32"/></g>
      ${rect(250, 14, 246, 96, "il-card il-pop")}${text(266, 36, t.tools, "il-t il-m")}
      ${text(266, 60, `archmcp-${name}`, "il-t il-mono il-b")}${rect(468, 48, 18, 18, "il-ok", 9)}<path class="il-tick" d="M472 57l4 4 6-8"/>
      ${text(266, 86, "…", "il-t il-m")}${bubble(30, 30, 3)}`, `archmcp-${name}`);
  },

  /** command line / script editor snippet */
  terminal({ cmd, where }) {
    return wrap(520, 100, `${rect(10, 10, 500, 80, "il-term", 8)}${text(24, 32, fit(where ?? "", 60), "il-t il-term-m")}
      ${text(24, 62, `> ${fit(cmd, 56)}`, "il-t il-mono il-term-t")}`, cmd);
  },

  /** port table */
  ports({ rows }, l) {
    const t = UI[l];
    const body = rows.map((r, i) => `${text(24, 56 + i * 26, fit(r[0], 20), "il-t il-b")}${text(220, 56 + i * 26, String(r[1]), "il-t il-mono")}${rect(300, 42 + i * 26, 110, 20, r[2] === "ok" ? "il-ok-bg" : "il-bad-bg", 10)}${text(355, 56 + i * 26, r[3], "il-t il-small", "middle")}`).join("");
    return wrap(440, 50 + rows.length * 26 + 14, `${rect(10, 8, 420, 34 + rows.length * 26 + 8, "il-card")}${text(24, 30, "MCP", "il-t il-m")}${text(220, 30, t.port, "il-t il-m")}${body}`, "ports");
  },

  /** a success badge with text */
  ok({ text: s }) {
    return wrap(420, 56, `${rect(10, 10, 400, 36, "il-ok-bg", 18)}<circle class="il-ok" cx="34" cy="28" r="10"/><path class="il-tick" d="M29 28l4 4 7-8"/>${text(54, 33, fit(s, 50), "il-t il-b")}`, s);
  },
};

export function ill(spec, lang = "tr") {
  const f = DRAW[spec?.k];
  return f ? f(spec, UI[lang] ? lang : "tr") : "";
}

export const ILLUSTRATION_KINDS = Object.keys(DRAW);
