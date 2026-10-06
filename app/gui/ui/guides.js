// Renders guides (guides-data.js) as HTML. The first and last steps that are the same for every program are added here.
import { GENERAL, GUIDES } from "./guides-data.js";
import { ill } from "./illustrations.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const T = {
  tr: {
    what: "Bu ne işe yarar?", good: "Neler yaptırabilirsiniz", needs: "Başlamadan önce gerekenler", steps: "Adım adım", prompts: "Claude'a şunları deneyin",
    limits: "Bilmeniz gerekenler", fix: "Sorun giderme", safety: "Güvenlik notu", tips: "İpuçları", general: "Genel rehberler", programs: "Programlar", tierStable: "Kararlı", tierExperimental: "Deneysel", tierManual: "Manuel kurulum",
    homepage: "Resmi sayfa", picBy: "Çizimler şematiktir; programınızın arayüzü sürüme göre biraz farklı görünebilir.",
    headToggle: "ArchMCP'de bağlantıyı açın", headToggleD: "ArchMCP → Bağlantılar sayfasında bu programın kartındaki anahtarı açın. Eksik uygulama eklentisi otomatik kurulur.",
    headApply: "Uygula ve Claude'u yeniden başlatın", headApplyD: "Sayfanın üstündeki sarı banttaki düğmeye basın. Claude, sunucuları kendi açılışında başlatır; bu yüzden bir kez yeniden başlaması gerekir.",
    tailChat: "Claude'da araçları görün", tailChatD: "Claude'da yeni bir sohbet açın ve sohbet kutusunun yanındaki araçlar simgesine basın; listede bu bağlantı görünmelidir. Panelde 'Test et' de aynı şeyi doğrular.",
    tailAsk: "İlk isteğinizi yazın", tailAskD: "Aşağıdaki örneklerden biriyle başlayın.",
    open: "Rehberi aç", problem: "Sorun", solution: "Çözüm", notInstalled: "Bu bağlantı henüz kurulu değil. Mağaza'dan ekleyebilirsiniz.",
  },
  en: {
    what: "What is it for?", good: "What you can ask it to do", needs: "What you need first", steps: "Step by step", prompts: "Try asking Claude",
    limits: "Good to know", fix: "Troubleshooting", safety: "Safety note", tips: "Tips", general: "General guides", programs: "Programs", tierStable: "Stable", tierExperimental: "Experimental", tierManual: "Manual setup",
    homepage: "Official page", picBy: "The pictures are schematic; your program's interface may look slightly different depending on its version.",
    headToggle: "Switch the connection on in ArchMCP", headToggleD: "On the ArchMCP → Connections page turn on the switch on this program's card. A missing program add-on is installed automatically.",
    headApply: "Apply and restart Claude", headApplyD: "Press the button in the yellow banner at the top of the page. Claude starts the servers when it launches, so it has to restart once.",
    tailChat: "See the tools in Claude", tailChatD: "Open a new chat in Claude and press the tools icon next to the chat box; this connection should be in the list. 'Test' in the panel verifies the same thing.",
    tailAsk: "Write your first request", tailAskD: "Start with one of the examples below.",
    open: "Open guide", problem: "Problem", solution: "Solution", notInstalled: "This connection is not installed yet. You can add it from the Store.",
  },
};

/** Sidebar of the Guides page: general guides first, then every program. */
export function guideIndex(state, lang) {
  const t = T[lang] ?? T.tr;
  const general = GENERAL.map((g) => ({ id: g.id, title: (g[lang] ?? g.tr).title, group: t.general }));
  const programs = state.mcps.filter((m) => GUIDES[m.id]).map((m) => ({ id: m.id, title: m.name[lang] ?? m.name.tr, group: t.programs, tier: m.tier, installed: m.installed }));
  return { general, programs };
}

const list = (items, cls = "") => `<ul class="g-list ${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
const prose = (text) => `<p class="g-p">${esc(text)}</p>`;

function step(n, s, lang) {
  return `<li class="g-step"><div class="g-n">${n}</div><div class="g-body"><h4>${esc(s.t)}</h4><p>${esc(s.d)}</p>${s.img ? `<figure class="g-fig">${ill(s.img, lang)}</figure>` : ""}</div></li>`;
}

/** @returns {string} HTML of one guide */
export function renderGuide(id, lang, state) {
  const t = T[lang] ?? T.tr;
  const general = GENERAL.find((g) => g.id === id);
  if (general) {
    const g = general[lang] ?? general.tr;
    return `<article class="guide"><header><h2>${esc(g.title)}</h2></header>${prose(g.what)}
      <h3>${esc(t.steps)}</h3><ol class="g-steps">${g.steps.map((s, i) => step(i + 1, s, lang)).join("")}</ol>
      ${g.tips?.length ? `<h3>${esc(t.tips)}</h3>${list(g.tips, "g-tips")}` : ""}<p class="g-note">${esc(t.picBy)}</p></article>`;
  }
  const entry = GUIDES[id];
  const m = state.mcps.find((x) => x.id === id);
  if (!entry || !m) return "";
  const g = entry[lang] ?? entry.tr;
  const name = m.name[lang] ?? m.name.tr;
  const steps = [];
  if (!entry.cloud && !entry.manual) {
    steps.push({ t: t.headToggle, d: t.headToggleD, img: { k: "toggle", name } }, { t: t.headApply, d: t.headApplyD, img: { k: "apply" } });
  }
  steps.push(...g.steps);
  if (!entry.cloud && !entry.manual) {
    steps.push({ t: t.tailChat, d: t.tailChatD, img: { k: "chat", name: id } }, { t: t.tailAsk, d: t.tailAskD });
  }
  const tier = m.tier === "manual" ? t.tierManual : m.tier === "experimental" ? t.tierExperimental : t.tierStable;
  return `<article class="guide">
    <header><h2>${esc(name)}</h2><span class="badge tier-${esc(m.tier)}">${esc(tier)}</span>
      ${m.homepage ? `<button class="btn btn-sm" data-act="open-url" data-what="homepage" data-id="${esc(id)}">${esc(t.homepage)}</button>` : ""}</header>
    ${!m.installed && m.kind === "local" ? `<div class="warn-line">${esc(t.notInstalled)}</div>` : ""}
    <h3>${esc(t.what)}</h3>${prose(g.what)}
    ${g.good?.length ? `<h3>${esc(t.good)}</h3>${list(g.good)}` : ""}
    ${g.needs?.length ? `<h3>${esc(t.needs)}</h3>${list(g.needs)}` : ""}
    <h3>${esc(t.steps)}</h3><ol class="g-steps">${steps.map((s, i) => step(i + 1, s, lang)).join("")}</ol>
    ${g.prompts?.length ? `<h3>${esc(t.prompts)}</h3><ul class="g-prompts">${g.prompts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${g.limits?.length ? `<h3>${esc(t.limits)}</h3>${list(g.limits)}` : ""}
    ${g.fix?.length ? `<h3>${esc(t.fix)}</h3><div class="g-fix">${g.fix.map(([p, s]) => `<div class="g-fix-row"><b>${esc(p)}</b><span>${esc(s)}</span></div>`).join("")}</div>` : ""}
    ${g.safety ? `<div class="g-safety"><b>${esc(t.safety)}</b><p>${esc(g.safety)}</p></div>` : ""}
    <p class="g-note">${esc(t.picBy)}</p></article>`;
}

/** Text that a test (or a search box) can check: every string a guide would show. */
export function guideCompleteness(id, lang) {
  const g = (GUIDES[id] ?? GENERAL.find((x) => x.id === id))?.[lang];
  if (!g) return { ok: false, missing: ["guide"] };
  const missing = [];
  for (const k of GENERAL.some((x) => x.id === id) ? ["what", "steps"] : ["what", "steps", "prompts", "fix", "safety"]) if (!g[k] || (Array.isArray(g[k]) && !g[k].length)) missing.push(k);
  return { ok: !missing.length, missing };
}
