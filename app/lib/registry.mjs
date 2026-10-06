// The single source of truth for every MCP ArchMCP knows: what it is, how Claude launches it, which options
// the user can change, and how to tell whether it is installed. The GUI, the installer and the tests all read this.
import { readFileSync } from "node:fs";
import { DETECTORS } from "./detect.mjs";
import { KEY_PREFIX, L, clean, nodeCmd } from "./registry-util.mjs";
import { PACK_DEFS } from "./registry-packs.mjs";

export { KEY_PREFIX };
export const REVIT_PORT_BASE = 7891; // 2026 -> 7891, one port per Revit year (matches the add-in)
export const PS_LEVELS = ["read", "edit", "external", "destructive"];


// ------------------------------------------------------------------ launch helpers


/**
 * Python servers run through the bundled interpreter in isolated mode (-I): the user's PYTHONPATH, user-site
 * packages and other Pythons can never leak in. Servers that ship generically named top-level modules
 * (autocad: server/config/..., unity: main/core/utils/...) live in their own folder, added by ARCHMCP_SITE.
 */
function pyEntry(c, { module, isolated, args = [], env = {} }) {
  const code = isolated
    ? `import os,site;site.addsitedir(os.environ['ARCHMCP_SITE']);from ${module} import main;main()`
    : `from ${module} import main;main()`;
  return {
    command: c.p("runtime", "python", "python.exe"),
    args: ["-I", "-c", code, ...args],
    env: {
      PYTHONUTF8: "1",
      ...(isolated ? { ARCHMCP_SITE: c.p("servers", isolated, "site") } : {}),
      ...env,
    },
  };
}


// ------------------------------------------------------------------ definitions

/** @typedef {{key:string,type:'bool'|'select'|'text'|'number'|'file'|'folder'|'folders'|'multi',label:{tr:string,en:string},help?:{tr:string,en:string},choices?:{value:any,label:{tr:string,en:string}}[],danger?:boolean,min?:number,max?:number,placeholder?:string}} Option */

export const REGISTRY = [
  {
    id: "revit", kind: "local", runtime: "node", category: "bim",
    name: L("Autodesk Revit", "Autodesk Revit"),
    desc: L("Modeli oku, sorgula; eleman oluştur/düzenle. İşlemler Revit'te tek bir geri alınabilir adımdır.",
      "Read and query the model; create/edit elements. Operations run as one undoable Revit transaction."),
    appNote: L("Revit 2025 / 2026 / 2027", "Revit 2025 / 2026 / 2027"),
    probe: ["servers", "revit", "dist", "index.js"],
    addonKind: "revit",
    defaults: { versions: [] },
    options: [
      { key: "versions", type: "multi", label: L("Revit sürümleri", "Revit versions"),
        help: L("Seçilen her sürüm için ayrı bir sunucu kaydedilir.", "One server is registered for each selected version."),
        choices: [2025, 2026, 2027].map((y) => ({ value: y, label: L(`Revit ${y}`, `Revit ${y}`) })) },
    ],
    entries(c, o) {
      const out = {};
      for (const y of o.versions ?? []) {
        out[`${KEY_PREFIX}revit-${y}`] = {
          command: nodeCmd(c), args: [c.p("servers", "revit", "dist", "index.js")],
          env: { REVIT_MCP_VERSION: String(y), REVIT_MCP_PORT: String(REVIT_PORT_BASE + (y - 2026)) },
        };
      }
      return out;
    },
    ports(o) { return (o.versions ?? []).map((y) => ({ label: `Revit ${y}`, port: REVIT_PORT_BASE + (y - 2026), side: "fixed", hostProcess: ["Revit.exe"] })); },
  },
  {
    id: "autocad", kind: "local", runtime: "python", category: "bim",
    name: L("Autodesk AutoCAD 2026", "Autodesk AutoCAD 2026"),
    desc: L("Çizim nesnelerini oluştur/düzenle, katman, blok, ölçü ve mimari/mühendislik araçları. Yalnızca AutoCAD 2026.",
      "Create/edit drawing entities, layers, blocks, dimensions and architectural/engineering tools. AutoCAD 2026 only."),
    appNote: L("Yalnızca AutoCAD 2026", "AutoCAD 2026 only"),
    probe: ["servers", "autocad", "site", "server.py"],
    defaults: { backend: "auto", toolProfile: "full", discovery: "off", enable3d: false, allowedPaths: [], rawCommands: false },
    options: [
      { key: "backend", type: "select", label: L("Çalışma biçimi", "Backend"),
        help: L("Otomatik: AutoCAD açıksa canlı kontrol (COM), değilse DXF dosyaları üzerinde.", "Auto: live control (COM) when AutoCAD runs, otherwise DXF files."),
        choices: [{ value: "auto", label: L("Otomatik", "Auto") }, { value: "com", label: L("Yalnızca canlı AutoCAD (COM)", "Live AutoCAD only (COM)") }, { value: "ezdxf", label: L("Yalnızca DXF dosyaları", "DXF files only") }] },
      { key: "toolProfile", type: "select", label: L("Araç seti", "Tool profile"),
        help: L("Tam: tüm araçlar. Hafif: günlük işler için daha az araç.", "Full: every tool. Lean: fewer tools for everyday work."),
        choices: [{ value: "full", label: L("Tam", "Full") }, { value: "lean", label: L("Hafif", "Lean") }] },
      { key: "discovery", type: "select", label: L("Araç keşfi", "Tool discovery"),
        help: L("Arama: Claude araç listesini tek tek yüklemek yerine arar (bağlamı küçültür).", "Search: Claude searches tools instead of loading the whole catalog (smaller context)."),
        choices: [{ value: "off", label: L("Kapalı (tüm liste)", "Off (full list)") }, { value: "search", label: L("Arama", "Search") }] },
      { key: "enable3d", type: "bool", label: L("3B araçlarını aç", "Enable 3D tools") },
      { key: "allowedPaths", type: "folders", label: L("Erişilebilir klasörler", "Allowed folders"),
        help: L("Boş = tüm yerel sürücüler. Doldurursanız dosya işlemleri yalnızca bu klasörlerle sınırlanır.", "Empty = all local drives. If set, file operations are limited to these folders.") },
      { key: "rawCommands", type: "bool", danger: true, label: L("Ham komut kısıtlamasını kaldır", "Remove raw-command restriction"),
        help: L("SHELL, NETLOAD, APPLOAD, VBARUN gibi bilgisayarda program çalıştırabilen komutlara izin verir. Güvenliği ciddi şekilde düşürür.", "Allows commands that can run programs on this PC (SHELL, NETLOAD, APPLOAD, VBARUN). Seriously lowers security.") },
    ],
    entries(c, o) {
      return { [`${KEY_PREFIX}autocad`]: pyEntry(c, { module: "server", isolated: "autocad", env: clean({
        AUTOCAD_MCP_BACKEND: o.backend, TOOL_PROFILE: o.toolProfile,
        DISCOVERY_MODE: o.discovery === "off" ? undefined : o.discovery,
        ENABLE_3D: o.enable3d ? "true" : undefined,
        ALLOWED_PATHS: (o.allowedPaths ?? []).join(","),
        // Raw-command denylist stays on unless the user opted out. Delete/save/purge work through typed tools either way.
        DANGEROUS_COMMANDS_ENABLED: o.rawCommands ? "true" : undefined,
      }) }) };
    },
  },
  {
    id: "photoshop", kind: "local", runtime: "node", category: "image",
    name: L("Adobe Photoshop", "Adobe Photoshop"),
    desc: L("Katman, maske, ayar, filtre ve rötuş işlemleri; belge okuma ve düzenleme.", "Layers, masks, adjustments, filters and retouching; read and edit documents."),
    appNote: L("Photoshop 25+ (Creative Cloud)", "Photoshop 25+ (Creative Cloud)"),
    probe: ["servers", "photoshop", "node_modules", "photoshop-mcp", "bin", "photoshop-mcp.js"],
    addonKind: "photoshop",
    defaults: { permissions: [...PS_LEVELS], profile: "full", port: 0 },
    options: [
      { key: "permissions", type: "multi", label: L("Yetkiler", "Permissions"),
        help: L("Okuma: yalnızca bakar. Düzenleme: Photoshop içinde. Dışarı: dosya yazma/okuma, dış işlemci. Yıkıcı: üzerine yazma, silme, birleştirme (geri alınamaz).",
          "Read: look only. Edit: inside Photoshop. External: file I/O, external processors. Destructive: overwrite, delete, merge (irreversible)."),
        choices: [
          { value: "read", label: L("Okuma", "Read") }, { value: "edit", label: L("Düzenleme", "Edit") },
          { value: "external", label: L("Dışarı (dosya)", "External (files)") }, { value: "destructive", label: L("Yıkıcı", "Destructive"), danger: true },
        ] },
      { key: "port", type: "number", min: 0, max: 8774, label: L("Köprü portu (0 = otomatik)", "Bridge port (0 = automatic)"),
        help: L("0: 8765-8774 arasında ilk boş port. Sabitlemek için 8765-8774 arası bir değer girin.", "0: first free port in 8765-8774. Enter a value in 8765-8774 to pin it.") },
      { key: "profile", type: "select", label: L("Araç seti", "Tool profile"),
        help: L("Yalnızca Claude'a gösterilen listeyi küçültür; yetkileri değiştirmez.", "Only shrinks the list Claude sees; permissions are unchanged."),
        choices: [{ value: "full", label: L("Tam", "Full") }, { value: "retouch", label: L("Rötuş", "Retouch") }, { value: "readonly", label: L("Salt okunur", "Read-only") }] },
    ],
    entries(c, o) {
      const perms = PS_LEVELS.filter((l) => (o.permissions ?? []).includes(l));
      return { [`${KEY_PREFIX}photoshop`]: {
        command: nodeCmd(c),
        args: [c.p("servers", "photoshop", "node_modules", "photoshop-mcp", "bin", "photoshop-mcp.js")],
        env: {
          PHOTOSHOP_MCP_ALLOW: perms.length === PS_LEVELS.length ? "all" : perms.length ? perms.join(",") : "none",
          PHOTOSHOP_MCP_PROFILE: o.profile,
          PHOTOSHOP_MCP_PORT: o.port >= 8765 && o.port <= 8774 ? String(o.port) : undefined,
          // Upstream defaults to <cwd>/extensions, capabilities.json, workflows.json - whatever folder Claude launches us
          // from. Pin them to our own (empty) folder so nothing foreign is ever loaded.
          PHOTOSHOP_MCP_EXTENSIONS: c.p("servers", "photoshop", "extensions"),
          PHOTOSHOP_MCP_EXTENSIONS_ENABLED: "none",
          PHOTOSHOP_MCP_CAPABILITIES: c.p("servers", "photoshop", "capabilities.json"),
          PHOTOSHOP_MCP_WORKFLOWS: c.p("servers", "photoshop", "workflows.json"),
        },
      } };
    },
    // No bridge-health port check on purpose: 8765-8774 is opened by THIS server and the Photoshop plugin connects to it,
    // so an open port only means "our server is running". The port manager still watches it for foreign owners.
    portClaims(o) { return [{ label: "Photoshop bridge", port: o.port >= 8765 ? o.port : 8765, range: o.port >= 8765 ? 1 : 10, side: "server", option: "port", hostProcess: ["node.exe"] }]; },
  },
  {
    id: "sketchup", kind: "cloud", runtime: "cloud", category: "3d",
    name: L("SketchUp", "SketchUp"),
    desc: L("Trimble'ın bulut bağlayıcısı: sohbetten 3B model üretir. Claude içinden eklenir, Trimble hesabıyla giriş gerekir.",
      "Trimble's cloud connector: builds 3D models from a conversation. Added inside Claude, requires a Trimble sign-in."),
    appNote: L("Bulut hizmeti (yerel kurulum yok)", "Cloud service (no local install)"),
    cloud: { url: "https://api.sketchup.com/mcp/v1/sketchup/mcp", page: "https://claude.com/marketplace/connectors/sketchup" },
    defaults: {}, options: [],
    entries() { return {}; },
  },
  {
    id: "blender", kind: "local", runtime: "python", category: "3d",
    name: L("Blender", "Blender"),
    desc: L("Sahneyi kur, nesne/malzeme/animasyon üret; Blender Python'u çalıştır, görünümü gör.", "Build scenes, objects, materials and animation; run Blender Python and see the viewport."),
    appNote: L("Blender 3.x / 4.x / 5.x + eklenti", "Blender 3.x / 4.x / 5.x + add-on"),
    probe: ["runtime", "python", "Lib", "site-packages", "blender_mcp", "server.py"],
    addonKind: "blender",
    defaults: { port: 9876, safeMode: false },
    options: [
      { key: "port", type: "number", min: 1024, max: 65535, label: L("Eklenti portu", "Add-on port"),
        help: L("Blender eklentisindeki port ile aynı olmalı (varsayılan 9876). Bağlantı yalnızca bu bilgisayardadır.", "Must match the port in the Blender add-on (default 9876). The connection stays on this PC.") },
      { key: "safeMode", type: "bool", label: L("Güvenli mod", "Safe mode"),
        help: L("Çalıştırmadan önce Python kodunu denetler; dosya erişimi, program çalıştırma ve ağ kullanan kodu engeller.", "Checks Python before it runs; blocks file access, running programs and network use.") },
    ],
    entries(c, o) {
      return { [`${KEY_PREFIX}blender`]: pyEntry(c, { module: "blender_mcp.server", env: clean({
        BLENDER_HOST: "localhost", BLENDER_PORT: String(o.port ?? 9876),
        BLENDER_MCP_SAFE_MODE: o.safeMode ? "1" : undefined,
        DISABLE_TELEMETRY: "true", // upstream sends anonymous usage data by default; ArchMCP never opts in
        BLENDERMCP_NO_UPDATE_CHECK: "1",
      }) }) };
    },
    ports(o) { return [{ label: "Blender", port: o.port ?? 9876, side: "host-manual", option: "port", hostProcess: ["blender.exe"] }]; },
  },
  {
    id: "freecad", kind: "local", runtime: "python", category: "cad",
    name: L("FreeCAD", "FreeCAD"),
    desc: L("Parametrik 3B modelleme: model oluştur/düzenle, belge incele, FEM analizi, Python çalıştır.", "Parametric 3D modelling: create/edit models, inspect documents, FEM analysis, run Python."),
    appNote: L("FreeCAD 0.21 / 1.0 / 1.1 + eklenti", "FreeCAD 0.21 / 1.0 / 1.1 + add-on"),
    probe: ["runtime", "python", "Lib", "site-packages", "freecad_mcp", "server.py"],
    addonKind: "freecad",
    defaults: { textOnly: false },
    options: [
      { key: "textOnly", type: "bool", label: L("Yalnızca metin geri bildirimi", "Text-only feedback"),
        help: L("Ekran görüntülerini göndermez; token kullanımını azaltır.", "Omits screenshots; reduces token use.") },
    ],
    entries(c, o) { return { [`${KEY_PREFIX}freecad`]: pyEntry(c, { module: "freecad_mcp.server", args: o.textOnly ? ["--only-text-feedback"] : [] }) }; },
    ports() { return [{ label: "FreeCAD RPC", port: 9875, side: "fixed", hostProcess: ["FreeCAD.exe"] }]; },
  },
  {
    id: "openscad", kind: "local", runtime: "python", category: "3d",
    name: L("OpenSCAD", "OpenSCAD"),
    desc: L("Kodla parametrik 3B parça: ölçekli render, ölçüm, çakışma ve boşluk kontrolü, basılabilirlik, dışa aktarma.", "Parametric 3D parts as code: scaled renders, measuring, interference/clearance checks, printability, export."),
    appNote: L("OpenSCAD kurulu olmalı", "OpenSCAD must be installed"),
    probe: ["runtime", "python", "Lib", "site-packages", "openscad_mcp", "server.py"],
    defaults: { openscadPath: "" },
    options: [
      { key: "openscadPath", type: "file", label: L("openscad.exe yolu", "openscad.exe path"), placeholder: "C:\\Program Files\\OpenSCAD\\openscad.exe", autoDetect: true,
        help: L("Boş bırakırsanız otomatik bulunur.", "Leave empty to auto-detect.") },
    ],
    entries(c, o, d) {
      return { [`${KEY_PREFIX}openscad`]: pyEntry(c, { module: "openscad_mcp.server", env: clean({ OPENSCAD_PATH: o.openscadPath || d?.exe || "" }) }) };
    },
  },
  {
    id: "godot", kind: "local", runtime: "node", category: "game",
    name: L("Godot", "Godot"),
    desc: L("Editörü aç, projeyi çalıştır, hata çıktısını oku; sahne ve düğüm oluştur, UID yönet.", "Launch the editor, run projects, read debug output; create scenes and nodes, manage UIDs."),
    appNote: L("Godot 4.x (godot.exe yolu gerekir)", "Godot 4.x (needs the godot.exe path)"),
    probe: ["servers", "godot", "node_modules", "@coding-solo", "godot-mcp", "build", "index.js"],
    defaults: { godotPath: "", debug: false },
    options: [
      { key: "godotPath", type: "file", label: L("godot.exe yolu", "godot.exe path"), placeholder: "C:\\Tools\\Godot_v4.3-stable_win64.exe", autoDetect: true,
        help: L("Godot tek bir .exe olarak gelir; nereye koyduysanız seçin. Boşsa otomatik aranır.", "Godot ships as a single .exe; pick wherever you put it. Searched automatically if empty.") },
      { key: "debug", type: "bool", label: L("Ayrıntılı günlük", "Verbose log") },
    ],
    entries(c, o, d) {
      return { [`${KEY_PREFIX}godot`]: {
        command: nodeCmd(c),
        args: [c.p("servers", "godot", "node_modules", "@coding-solo", "godot-mcp", "build", "index.js")],
        env: clean({ GODOT_PATH: o.godotPath || d?.exe || "", DEBUG: o.debug ? "true" : undefined }),
      } };
    },
  },
  {
    id: "unity", kind: "local", runtime: "python", category: "game",
    name: L("Unity", "Unity"),
    desc: L("Sahne, GameObject, C# betikleri, asset, test ve build işlemleri. Paket her Unity projesine eklenir.", "Scenes, GameObjects, C# scripts, assets, tests and builds. The package is added to each Unity project."),
    appNote: L("Unity 2021.3 LTS – 6.x + proje paketi", "Unity 2021.3 LTS – 6.x + project package"),
    probe: ["servers", "unity", "site", "main.py"],
    addonKind: "unity",
    defaults: { projects: [] },
    options: [
      { key: "projects", type: "folders", label: L("Unity projeleri", "Unity projects"),
        help: L("Her projeye 'MCP for Unity' paketi eklenir (Packages klasörüne kopyalanır, git gerekmez).", "The 'MCP for Unity' package is added to each project (copied into Packages; no git needed).") },
    ],
    entries(c) {
      return { [`${KEY_PREFIX}unity`]: pyEntry(c, { module: "main", isolated: "unity", args: ["--transport", "stdio"],
        env: { DISABLE_TELEMETRY: "true", UNITY_MCP_DISABLE_TELEMETRY: "true" } }) };
    },
    ports() { return [{ label: "Unity", port: 6400, range: 5, side: "fixed", hostProcess: ["Unity.exe"] }]; },
  },
];

REGISTRY.push(...PACK_DEFS);

export const byId = (id) => REGISTRY.find((m) => m.id === id);

/**
 * Components the user ticked in the installer (components.json, written by setup). `null` = file absent
 * (development / hand-copied install): every integration whose files exist counts as installed.
 */
export function installedComponents(ctx) {
  try { return new Set(JSON.parse(readFileSync(ctx.fs("components.json"), "utf8")).components); } catch { return null; }
}

/** Was this MCP chosen at install time, and is its server software physically present? */
export function isInstalled(ctx, def) {
  if (def.kind === "cloud" || def.kind === "manual") return true;
  const chosen = installedComponents(ctx);
  return ctx.has(...def.probe) && (chosen === null || chosen.has(def.id));
}

export function defaultOptions(def) { return structuredClone(def.defaults); }

/** Detected host application for a definition (cached by callers if needed). */
export function detectApp(ctx, def) { return (def.detect ?? DETECTORS[def.id])?.(ctx) ?? { found: false, exe: null, versions: [] }; }

/** Claude-config entries for every enabled + installed MCP in `settings`. */
export function buildEntries(ctx, settings) {
  const entries = {};
  for (const def of REGISTRY) {
    const s = settings.mcps?.[def.id];
    if (!s?.enabled || def.kind !== "local" || !isInstalled(ctx, def)) continue;
    const opts = { ...defaultOptions(def), ...s.options };
    Object.assign(entries, def.entries(ctx, opts, def.options.some((o) => o.autoDetect) ? detectApp(ctx, def) : undefined));
  }
  return entries;
}

/** Keys (in Claude's config) that belong to one definition. */
export function keysOf(def, entries) {
  const base = `${KEY_PREFIX}${def.id}`;
  return Object.keys(entries).filter((k) => k === base || k.startsWith(`${base}-`));
}

/** Short "what to do in the host application" steps shown in the GUI. */
export const HOW_TO = {
  revit: L(
    ["Revit'i ve bir projeyi açın.", "Eklenti otomatik yüklenir; ilk açılışta güvenlik penceresi çıkarsa \"Her zaman yükle\" seçin.", "Claude'u yeniden başlatın; sohbet kutusundaki araçlarda archmcp-revit-… görünür."],
    ["Open Revit and a project.", "The add-in loads automatically; if a security prompt appears on first start, choose \"Always Load\".", "Restart Claude; archmcp-revit-… shows up in the chat box tools."]),
  autocad: L(
    ["AutoCAD 2026'yı ve bir çizimi açın.", "AutoCAD kapalıysa yalnızca DXF dosyaları üzerinde (ekransız) çalışılır."],
    ["Open AutoCAD 2026 and a drawing.", "With AutoCAD closed, only DXF files can be processed (headless)."]),
  photoshop: L(
    ["Photoshop'u açın.", "Eklentiler (Plugins) menüsünden \"Photoshop MCP\" panelini açın ve açık bırakın."],
    ["Open Photoshop.", "From the Plugins menu open the \"Photoshop MCP\" panel and keep it open."]),
  sketchup: L(
    ["Claude → Ayarlar → Bağlayıcılar → \"SketchUp\" ekleyin.", "Trimble hesabınızla giriş yapın."],
    ["Claude → Settings → Connectors → add \"SketchUp\".", "Sign in with your Trimble account."]),
  blender: L(
    ["Blender'ı açın. Edit → Preferences → Add-ons içinde \"MCP for Blender\" etkin olmalı.", "3B görünümde N tuşu → \"MCP for Blender\" sekmesi → gerekirse \"Start MCP Server\"."],
    ["Open Blender. \"MCP for Blender\" must be enabled in Edit → Preferences → Add-ons.", "In the 3D viewport press N → \"MCP for Blender\" tab → click \"Start MCP Server\" if needed."]),
  freecad: L(
    ["FreeCAD'i (yeniden) başlatın.", "Çalışma tezgâhı listesinden \"MCP Addon\" seçin.", "\"FreeCAD MCP\" araç çubuğunda \"Start RPC Server\"a basın (\"Auto-Start Server\" işaretlenebilir)."],
    ["Start (or restart) FreeCAD.", "Pick the \"MCP Addon\" workbench.", "Press \"Start RPC Server\" in the \"FreeCAD MCP\" toolbar (you can tick \"Auto-Start Server\")."]),
  openscad: L(
    ["OpenSCAD kurulu olmalı; yol otomatik bulunur, bulunamazsa seçin.", "Claude'dan kod yazıp render etmesini isteyin."],
    ["OpenSCAD must be installed; the path is found automatically, otherwise pick it.", "Ask Claude to write and render code."]),
  godot: L(
    ["godot.exe yolunu seçin (otomatik bulunmadıysa).", "Claude'a proje klasörünü söyleyin; editörü açıp projeyi çalıştırabilir."],
    ["Pick the godot.exe path (if it was not found automatically).", "Tell Claude the project folder; it can launch the editor and run the project."]),
  unity: L(
    ["Projeyi \"Unity projeleri\" listesine ekleyip \"Paketi ekle\"ye basın.", "Projeyi Unity'de açın; ilk içe aktarma Unity'nin kendi bağımlılıklarını indirir.", "Unity'de Window → MCP for Unity penceresinden bağlantının açık olduğunu doğrulayın."],
    ["Add the project to \"Unity projects\" and press \"Add package\".", "Open the project in Unity; the first import downloads Unity's own dependencies.", "In Unity, check Window → MCP for Unity that the connection is on."]),
};
