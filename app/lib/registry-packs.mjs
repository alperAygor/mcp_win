// The downloadable integrations: each is a signed "pack" (see packs.mjs) that is installed after the main setup.
// A pack's launch command comes from its own pack.json, so the registry cannot drift from what was built.
import { readFileSync } from "node:fs";
import { alwaysPresent, detectByPatterns, versionFromPath } from "./detect.mjs";
import { KEY_PREFIX, L, clean, nodeCmd } from "./registry-util.mjs";

function manifest(c, id) {
  try { return JSON.parse(readFileSync(c.fs("servers", id, "pack.json"), "utf8")); } catch { return null; }
}

/** Claude-config entry for a pack, built from its manifest. `args` are extra command-line arguments. */
export function packLaunch(c, id, { args = [], env = {} } = {}) {
  const m = manifest(c, id);
  if (!m) return null;
  const l = m.launch;
  const dir = (...p) => c.p("servers", id, ...p);
  switch (l.kind) {
    case "node": return { command: nodeCmd(c), args: [dir(...l.path.split("/")), ...args], env: clean(env) };
    case "exe": return { command: dir(...l.path.split("/")), args, env: clean(env) };
    case "module": case "script": return {
      command: c.p("runtime", "python", "python.exe"),
      // -I: ignore PYTHONPATH/user site. -S: no interpreter site-packages. The pack brings everything it needs.
      args: ["-I", "-S", c.p("app", "py", "bootstrap.py"), ...args],
      env: clean({
        PYTHONUTF8: "1", PYTHONUNBUFFERED: "1",
        ARCHMCP_SITE: dir("site"),
        ...(l.kind === "module" ? { ARCHMCP_MODULE: l.target, ARCHMCP_PATH: l.path ? dir(...l.path.split("/")) : undefined }
          : { ARCHMCP_SCRIPT: dir(...l.path.split("/")) }),
        ...env,
      }),
    };
    default: return null;
  }
}

const portOpt = (def, tr, en, extra = {}) => ({ key: "port", type: "number", min: 1024, max: 65535, label: L(tr, en), ...extra, ...(def ? { help: def } : {}) });
const pyDetect = (patterns) => (c) => detectByPatterns(c, patterns, versionFromPath);

const defs = [];
const add = (d) => defs.push({
  kind: "local", pack: true, probe: ["servers", d.id, "pack.json"], defaults: {}, options: [], ...d,
  entries(c, o, det) {
    const built = d.launchArgs ? d.launchArgs(o, det, c) : {};
    const e = packLaunch(c, d.id, { args: built.args ?? [], env: { ...(d.env?.(o, det, c) ?? {}), ...(built.env ?? {}) } });
    return e ? { [`${KEY_PREFIX}${d.id}`]: e } : {};
  },
});

// ---------------------------------------------------------------- stable
add({
  id: "ableton", tier: "stable", runtime: "python", category: "audio", addonKind: "ableton",
  name: L("Ableton Live", "Ableton Live"),
  desc: L("Müzik prodüksiyonu: parça, klip, enstrüman ve efekt oluştur; tempo ve transportu yönet.", "Music production: create tracks, clips, instruments and effects; control tempo and transport."),
  appNote: L("Ableton Live 10.1.13+ (Remote Script)", "Ableton Live 10.1.13+ (Remote Script)"),
  detect: pyDetect(["Ableton/Live */Program/Ableton Live*.exe"]),
  defaults: { port: 9877 },
  options: [portOpt(L("Remote Script'in dinlediği port (varsayılan 9877). Eklenti yeniden kurulunca aynı port yazılır.", "Port the Remote Script listens on (default 9877). It is written again whenever the add-on is reinstalled."), "Remote Script portu", "Remote Script port")],
  env: (o) => ({ ABLETON_PORT: String(o.port ?? 9877), ABLETON_MCP_DISABLE_TELEMETRY: "1" }),
  ports: (o) => [{ label: "Ableton", port: o.port ?? 9877, side: "host-patch", option: "port", hostProcess: ["Ableton Live"] }],
});
add({
  id: "fusion360", tier: "stable", runtime: "python", category: "mech", addonKind: "fusion360",
  name: L("Autodesk Fusion", "Autodesk Fusion"),
  desc: L("Parametrik 3B parça: eskiz, extrude, birleştirme, montaj ve dışa aktarma.", "Parametric 3D parts: sketches, extrudes, joins, assemblies and export."),
  appNote: L("Fusion (Add-In otomatik kurulur)", "Fusion (add-in installed automatically)"),
  detect: pyDetect(["LOCAL:Autodesk/webdeploy/production/*/Fusion360.exe", "LOCAL:Autodesk/webdeploy/production/*/Fusion.exe"]),
  defaults: { port: 9876 },
  options: [portOpt(L("Fusion Add-In'in dinlediği port. Değiştirince Add-In otomatik yeniden yazılır.", "Port the Fusion add-in listens on. Changing it rewrites the add-in automatically."), "Add-In portu", "Add-in port")],
  env: (o) => ({ FUSION_MCP_PORT: String(o.port ?? 9876) }),
  launchArgs: () => ({ args: ["--mode", "socket"] }),
  ports: (o) => [{ label: "Fusion", port: o.port ?? 9876, side: "host-patch", option: "port", hostProcess: ["Fusion360.exe", "Fusion.exe"] }],
});
add({
  id: "rhino", tier: "stable", runtime: "python", category: "3d",
  name: L("Rhino / Grasshopper", "Rhino / Grasshopper"),
  desc: L("Rhino'da nesne/eğri/yüzey oluştur ve düzenle; Grasshopper tanımlarını yönet.", "Create and edit objects, curves and surfaces in Rhino; drive Grasshopper definitions."),
  appNote: L("Rhino 8 + RhinoMCP eklentisi (Package Manager)", "Rhino 8 + the RhinoMCP plug-in (Package Manager)"),
  detect: pyDetect(["Rhino */System/Rhino.exe"]),
  defaults: { port: 1999 },
  options: [portOpt(L("Rhino eklentisindeki port ile aynı olmalı (varsayılan 1999).", "Must match the port in the Rhino plug-in (default 1999)."), "Rhino portu", "Rhino port")],
  env: (o) => ({ RHINO_MCP_PORT: String(o.port ?? 1999) }),
  ports: (o) => [{ label: "Rhino", port: o.port ?? 1999, side: "host-manual", option: "port", hostProcess: ["Rhino.exe"] }],
});
add({
  id: "archicad", tier: "stable", runtime: "python", category: "bim",
  name: L("Graphisoft Archicad", "Graphisoft Archicad"),
  desc: L("BIM modelini oku; eleman, katman ve özellik sorgula; Tapir eklentisi üzerinden düzenle.", "Read the BIM model; query elements, layers and properties; edit through the Tapir add-on."),
  appNote: L("Archicad 26+ ve Tapir eklentisi", "Archicad 26+ with the Tapir add-on"),
  detect: pyDetect(["GRAPHISOFT/ARCHICAD */ARCHICAD.exe"]),
  ports: () => [{ label: "Archicad (Tapir)", port: 19723, range: 20, side: "fixed", hostProcess: ["ARCHICAD.exe"] }],
});
add({
  id: "solidworks", tier: "stable", runtime: "python", category: "mech",
  name: L("SolidWorks", "SolidWorks"),
  desc: L("Parça ve montaj modelleme, eskiz, özellikler, ölçü ve dışa aktarma (COM ile).", "Part and assembly modelling, sketches, features, dimensions and export (via COM)."),
  appNote: L("SolidWorks 2026'da test edilmiş (API 2020+)", "Tested on SolidWorks 2026 (API 2020+)"),
  detect: pyDetect(["SOLIDWORKS Corp/SOLIDWORKS/SLDWORKS.exe"]),
});
add({
  id: "maya", tier: "stable", runtime: "python", category: "3d", addonKind: "maya",
  name: L("Autodesk Maya", "Autodesk Maya"),
  desc: L("Sahne, mesh, malzeme ve animasyon; Maya komut portu üzerinden kod çalıştırma.", "Scenes, meshes, materials and animation; run code over Maya's command port."),
  appNote: L("Maya 2024+ (commandPort betiği otomatik kopyalanır)", "Maya 2024+ (commandPort script copied automatically)"),
  detect: pyDetect(["Autodesk/Maya */bin/maya.exe"]),
  ports: () => [{ label: "Maya commandPort", port: 7001, side: "fixed", hostProcess: ["maya.exe"] }],
});
add({
  id: "ifc", tier: "stable", runtime: "python", category: "bim",
  name: L("IFC (dosya analizi)", "IFC (file analysis)"),
  desc: L("Programa gerek olmadan IFC dosyalarını oku: eleman, malzeme, özellik, miktar ve ilişkiler.", "Read IFC files without any host program: elements, materials, properties, quantities and relations."),
  appNote: L("Yalnızca IFC dosyası gerekir", "Only an IFC file is needed"),
  detect: alwaysPresent,
  defaults: { ifcFile: "" },
  options: [{ key: "ifcFile", type: "file", label: L("Açılışta yüklenecek IFC dosyası (isteğe bağlı)", "IFC file to preload (optional)"), placeholder: "C:\\Projeler\\bina.ifc" }],
  launchArgs: (o) => ({ args: ["serve", ...(o.ifcFile ? [o.ifcFile] : []), "--transport", "stdio", "--quiet"] }),
});
add({
  id: "unreal", tier: "stable", runtime: "node", category: "game",
  name: L("Unreal Engine", "Unreal Engine"),
  desc: L("Unreal Editor'de Python çalıştır; aktör, seviye ve asset yönet (Remote Execution ile).", "Run Python in the Unreal Editor; manage actors, levels and assets (via Remote Execution)."),
  appNote: L("Unreal 5.x (Python Remote Execution açık)", "Unreal 5.x (Python Remote Execution enabled)"),
  detect: pyDetect(["Epic Games/UE_*/Engine/Binaries/Win64/UnrealEditor.exe"]),
  ports: () => [{ label: "Unreal Remote Execution", port: 6776, side: "fixed", hostProcess: ["UnrealEditor.exe"] }],
});
add({
  id: "matlab", tier: "stable", runtime: "exe", category: "analysis",
  name: L("MATLAB / Simulink", "MATLAB / Simulink"),
  desc: L("MATLAB kodu çalıştır, betik ve Live Script yaz, Simulink modellerini oluştur ve çalıştır.", "Run MATLAB code, write scripts and Live Scripts, build and run Simulink models."),
  appNote: L("MATLAB R2021a+ (lisanslı)", "MATLAB R2021a+ (licensed)"),
  detect: pyDetect(["MATLAB/R*/bin/matlab.exe"]),
  defaults: { matlabRoot: "", workFolder: "" },
  options: [
    { key: "matlabRoot", type: "folder", autoDetect: true, label: L("MATLAB klasörü", "MATLAB folder"), placeholder: "C:\\Program Files\\MATLAB\\R2025a", help: L("/bin olmadan. Boşsa otomatik bulunur.", "Without /bin. Detected automatically if empty.") },
    { key: "workFolder", type: "folder", label: L("Çalışma klasörü (isteğe bağlı)", "Working folder (optional)") },
  ],
  launchArgs: (o, det, c) => {
    const root = o.matlabRoot || (det?.exe ? det.exe.replace(/[\\/]bin[\\/]matlab\.exe$/i, "") : "");
    // upstream needs WINDIR to start MATLAB/Simulink; hosts that do not forward it otherwise fail with a confusing error
    return { args: [...(root ? [`--matlab-root=${root}`] : []), ...(o.workFolder ? [`--initial-working-folder=${o.workFolder}`] : [])], env: { WINDIR: c?.env?.WINDIR ?? c?.env?.SystemRoot } };
  },
});

// ---------------------------------------------------------------- experimental
add({
  id: "bonsai", tier: "experimental", runtime: "python", category: "bim", addonKind: "bonsai",
  name: L("Bonsai (IFC / BlenderBIM)", "Bonsai (IFC / BlenderBIM)"),
  desc: L("Blender içindeki Bonsai ile IFC/BIM modelleme: eleman, özellik, katman, rapor.", "IFC/BIM authoring with Bonsai inside Blender: elements, properties, layers, reports."),
  appNote: L("Blender + Bonsai eklentisi", "Blender + the Bonsai add-on"),
  detect: pyDetect(["Blender Foundation/Blender */blender.exe"]),
  defaults: { port: 9876 },
  options: [portOpt(L("Bonsai eklentisinin portu. Blender MCP ile aynı anda kullanılacaksa farklı olmalı.", "Port of the Bonsai add-on. Must differ from Blender MCP when both are used at once."), "Bonsai portu", "Bonsai port")],
  env: (o) => ({ BONSAI_MCP_PORT: String(o.port ?? 9876) }),
  ports: (o) => [{ label: "Bonsai", port: o.port ?? 9876, side: "host-patch", option: "port", hostProcess: ["blender.exe"] }],
});
add({
  id: "qgis", tier: "experimental", runtime: "python", category: "gis", addonKind: "qgis",
  name: L("QGIS", "QGIS"),
  desc: L("Harita katmanları, projeler ve işleme araçları; QGIS içinde PyQGIS kodu çalıştır.", "Map layers, projects and processing tools; run PyQGIS code inside QGIS."),
  appNote: L("QGIS 3.x (eklenti otomatik kurulur)", "QGIS 3.x (plug-in installed automatically)"),
  detect: pyDetect(["QGIS */bin/qgis-bin.exe", "QGIS */bin/qgis.exe"]),
  defaults: { port: 9876 },
  options: [portOpt(L("QGIS eklentisinin portu. Değiştirince eklenti yeniden yazılır.", "Port of the QGIS plug-in. Changing it rewrites the plug-in."), "QGIS portu", "QGIS port")],
  env: (o) => ({ QGIS_MCP_PORT: String(o.port ?? 9876) }),
  ports: (o) => [{ label: "QGIS", port: o.port ?? 9876, side: "host-patch", option: "port", hostProcess: ["qgis-bin.exe", "qgis.exe"] }],
});
add({
  id: "altium", tier: "experimental", runtime: "python", category: "electronics",
  name: L("Altium Designer", "Altium Designer"),
  desc: L("Şematik ve PCB: bileşen, sembol, ağ ve yerleşim işlemleri; Altium betikleri ile.", "Schematic and PCB: components, symbols, nets and layout, driven through Altium scripts."),
  appNote: L("Altium Designer (kurulu ve lisanslı)", "Altium Designer (installed and licensed)"),
  detect: pyDetect(["Altium/AD*/X2.EXE", "Altium/AD*/DXP.EXE"]),
});
add({
  id: "comsol", tier: "experimental", runtime: "python", category: "analysis",
  name: L("COMSOL Multiphysics", "COMSOL Multiphysics"),
  desc: L("Çoklu fizik modelleri: parametre, geometri, fizik arayüzü, çözücü ve çalışma (study); COMSOL Server'a bağlanarak.", "Multiphysics models: parameters, geometry, physics interfaces, solvers and studies, by attaching to a COMSOL Server."),
  appNote: L("COMSOL 6.x (lisanslı); 'COMSOL Multiphysics Server' önce elle başlatılır", "COMSOL 6.x (licensed); start 'COMSOL Multiphysics Server' first"),
  detect: pyDetect(["COMSOL/COMSOL*/Multiphysics/bin/win64/comsol.exe"]),
  defaults: { exe: "", port: 2036 },
  options: [
    { key: "exe", type: "file", autoDetect: true, label: L("comsol.exe yolu (boşsa otomatik bulunur)", "comsol.exe path (found automatically when empty)"), placeholder: "C:\\Program Files\\COMSOL\\COMSOL63\\Multiphysics\\bin\\win64\\comsol.exe" },
    portOpt(L("COMSOL Server'ın dinlediği port (varsayılan 2036). Server'ı aynı portla başlatın; Server penceresinde yazar.", "Port the COMSOL Server listens on (default 2036). Start the Server on the same port; its window shows it."), "COMSOL Server portu", "COMSOL Server port"),
  ],
  env: (o, d, c) => ({
    // COMSOL_ROOT is the Multiphysics folder: three levels above bin/win64/comsol.exe
    COMSOL_ROOT: (o.exe || d?.exe || "").replace(/[\\/]bin[\\/]win64[\\/][^\\/]+$/i, "") || undefined,
    COMSOL_SERVER_MCP_HOME: `${c.dataDir}${c.sep}data${c.sep}comsol`,
    COMSOL_SERVER_PORT: String(o.port ?? 2036),
  }),
  ports: (o) => [{ label: "COMSOL Server", port: o.port ?? 2036, side: "host-manual", option: "port", hostProcess: ["comsolmphserver.exe", "comsol.exe", "comsolmphserver"] }],
});
add({
  id: "ltspice", tier: "experimental", runtime: "python", category: "electronics",
  name: L("LTspice / ngspice", "LTspice / ngspice"),
  desc: L("Devre simülasyonu: şematik (.asc) ve netlist düzenle, AC/DC/geçici analiz, tarama, Monte Carlo ve yapılandırılmış ölçümler.", "Circuit simulation: edit schematics (.asc) and netlists, AC/DC/transient analysis, sweeps, Monte Carlo and structured measurements."),
  appNote: L("LTspice (Windows) veya ngspice kurulu olmalı", "LTspice (Windows) or ngspice must be installed"),
  detect: pyDetect(["LOCAL:Programs/ADI/LTspice/LTspice.exe", "ADI/LTspice/LTspice.exe", "LTC/LTspiceXVII/XVIIx64.exe"]),
  defaults: { exe: "", folders: [], runCode: false },
  options: [
    { key: "folders", type: "folders", label: L("Devre klasörleri", "Circuit folders"),
      help: L("Sunucu yalnızca bu klasörlerdeki dosyaları okuyup yazar. Boşsa Belgeler\\LTspice kullanılır.", "The server only reads and writes files in these folders. When empty, Documents\\LTspice is used.") },
    { key: "exe", type: "file", autoDetect: true, label: L("Simülatör yolu (isteğe bağlı)", "Simulator path (optional)"),
      help: L("Boşsa LTspice otomatik bulunur. ngspice veya özel bir LTspice için dosyayı seçin.", "When empty LTspice is found automatically. Pick the file for ngspice or a custom LTspice."), placeholder: "C:\\Users\\...\\AppData\\Local\\Programs\\ADI\\LTspice\\LTspice.exe" },
    { key: "runCode", type: "bool", danger: true, label: L("'Python çalıştır' aracını aç", "Enable the 'run Python' tool"),
      help: L("Claude'un bu bilgisayarda isteğe bağlı Python kodu çalıştırmasına izin verir (klasör sınırı geçerli olmaz). Güvenliği ciddi şekilde düşürür.", "Lets Claude run arbitrary Python on this PC (the folder limit does not apply). Seriously lowers security.") },
  ],
  env: (o, d, c) => {
    const home = `${c.dataDir}${c.sep}data${c.sep}ltspice`;
    const dirs = (o.folders ?? []).length ? o.folders : [`${c.userProfile}${c.sep}Documents${c.sep}LTspice`];
    return {
      LTSPICE_MCP_WRITE_CONFIG: "false",           // never drop a config file into whatever folder Claude started us in
      LTSPICE_MCP_HOME: home, LTSPICE_MCP_STORE_DIR: `${home}${c.sep}store`,
      LTSPICE_MCP_ALLOWED_PATHS: dirs.join(";"), LTSPICE_MCP_WORKING_DIR: dirs[0],
      LTSPICE_MCP_SIMULATOR_EXE: o.exe || undefined,
      LTSPICE_MCP_RUN_CODE: o.runCode ? "true" : "false",
    };
  },
});
add({
  id: "abaqus", tier: "experimental", runtime: "python", category: "analysis", addonKind: "abaqus",
  name: L("Abaqus/CAE", "Abaqus/CAE"),
  desc: L("Abaqus modellerini oku/düzenle, iş gönder, ODB sonuçlarını incele (dosya tabanlı iletişim).", "Read/edit Abaqus models, submit jobs, inspect ODB results (file based communication)."),
  appNote: L("Abaqus/CAE 2020+", "Abaqus/CAE 2020+"),
  detect: pyDetect(["DRIVE:SIMULIA/Commands/abaqus.bat", "Dassault Systemes/SimulationServices/*/win_b64/code/bin/ABQLauncher.exe"]),
  env: (o, d, c) => ({ ABAQUS_MCP_HOME: `${c.userProfile}${c.sep}.abaqus-mcp` }),
});
add({
  id: "ansys", tier: "experimental", runtime: "python", category: "analysis",
  name: L("Ansys Workbench", "Ansys Workbench"),
  desc: L("Workbench projeleri, Mechanical/Fluent/CFX/MAPDL çalıştırma ve sonuç özetleri.", "Workbench projects, running Mechanical/Fluent/CFX/MAPDL and result summaries."),
  appNote: L("Ansys 2022 R1+ (lisanslı)", "Ansys 2022 R1+ (licensed)"),
  detect: pyDetect(["ANSYS Inc/v*/Framework/bin/Win64/RunWB2.exe"]),
  defaults: { runwb2: "" },
  options: [{ key: "runwb2", type: "file", autoDetect: true, label: L("RunWB2.exe yolu", "RunWB2.exe path"), placeholder: "C:\\Program Files\\ANSYS Inc\\v251\\Framework\\bin\\Win64\\RunWB2.exe" }],
  env: (o, d, c) => ({ ANSYS_WORKBENCH_MCP_HOME: `${c.dataDir}${c.sep}data${c.sep}ansys`, ANSYS_RUNWB2: o.runwb2 || d?.exe || undefined }),
});
add({
  id: "nx", tier: "experimental", runtime: "python", category: "mech",
  name: L("Siemens NX", "Siemens NX"),
  desc: L("NX parça/eskiz/extrude işlemleri; NX içinde çalışan bir köprü ile (NXOpen).", "NX part/sketch/extrude operations through a bridge running inside NX (NXOpen)."),
  appNote: L("NX 2206+ (köprü NX içinde başlatılır)", "NX 2206+ (the bridge is started inside NX)"),
  detect: pyDetect(["Siemens/NX*/NXBIN/ugraf.exe"]),
});
add({
  id: "inventor", tier: "experimental", runtime: "python", category: "mech",
  name: L("Autodesk Inventor", "Autodesk Inventor"),
  desc: L("Parametrik parça: eskiz, extrude, delik, pah, desen; geri alınabilir işlem grupları.", "Parametric parts: sketches, extrudes, holes, chamfers, patterns; undoable transaction groups."),
  appNote: L("Inventor 2022+ (COM)", "Inventor 2022+ (COM)"),
  detect: pyDetect(["Autodesk/Inventor */Bin/Inventor.exe"]),
});
add({
  id: "etabs", tier: "experimental", runtime: "python", category: "analysis",
  name: L("ETABS", "ETABS"),
  desc: L("Yapı modeli: nokta, kiriş, kolon, döşeme; yük ve analiz (COM). SAP2000 için de başlangıç noktası.", "Structural model: joints, beams, columns, slabs; loads and analysis (COM). A starting point for SAP2000 too."),
  appNote: L("ETABS (COM API) — sonuçlar mühendis onayı ister", "ETABS (COM API) — results need engineer sign-off"),
  detect: pyDetect(["Computers and Structures/ETABS */ETABS.exe"]),
});
add({
  id: "opensees", tier: "experimental", runtime: "python", category: "analysis",
  name: L("OpenSeesPy", "OpenSeesPy"),
  desc: L("Yapısal analiz: OpenSeesPy betiğini izole klasörde yazıp çalıştırır, çıktıları okur. ArchMCP'nin kendi sunucusudur.", "Structural analysis: writes and runs OpenSeesPy scripts in an isolated folder and reads the output. ArchMCP's own server."),
  appNote: L("Program gerekmez (Python kütüphanesi)", "No program needed (Python library)"),
  detect: alwaysPresent,
  defaults: { safeMode: true, timeout: 120, workspace: "" },
  options: [
    { key: "safeMode", type: "bool", label: L("Güvenli mod", "Safe mode"), help: L("Betikte dosya, süreç ve ağ modüllerini engeller. Kapatmak önerilmez.", "Blocks file, process and network modules in scripts. Turning it off is not recommended.") },
    { key: "timeout", type: "number", min: 5, max: 3600, label: L("Zaman aşımı (sn)", "Timeout (s)") },
    { key: "workspace", type: "folder", label: L("Çalışma klasörü", "Workspace folder"), placeholder: "%USERPROFILE%\\Documents\\ArchMCP\\opensees" },
  ],
  env: (o) => ({ OPENSEES_MCP_SAFE_MODE: o.safeMode === false ? "0" : "1", OPENSEES_MCP_TIMEOUT: String(o.timeout ?? 120), OPENSEES_MCP_WORKSPACE: o.workspace || undefined }),
});

// ---------------------------------------------------------------- manual / guide-only
const manual = (d) => defs.push({ kind: "manual", pack: false, tier: "manual", runtime: "none", defaults: {}, options: [], entries: () => ({}), detect: d.detect ?? alwaysPresent, ...d });
manual({
  id: "kicad", category: "electronics", name: L("KiCad", "KiCad"),
  desc: L("PCB ve şematik tasarımı. Yardımcı Python bağımlılıkları KiCad'in kendi Python sürümüne bağlı olduğu için elle kurulum gerekir.", "PCB and schematic design. Its helper Python dependencies are tied to KiCad's own Python version, so setup is manual."),
  appNote: L("Yarı manuel (rehber)", "Semi-manual (guide)"), homepage: "https://github.com/mixelpixx/KiCAD-MCP-Server",
  detect: pyDetect(["KiCad/*/bin/kicad.exe"]),
});
manual({
  id: "civil3d", category: "bim", name: L("Civil 3D", "Civil 3D"),
  desc: L("Civil 3D, AutoCAD tabanlıdır: AutoCAD MCP ile çizim işlemleri yapılır. Yola, parsele ve yüzeye özgü nesneler kapsam dışıdır.", "Civil 3D is AutoCAD based: drawing operations work through the AutoCAD MCP. Road, parcel and surface objects are out of scope."),
  appNote: L("AutoCAD MCP üzerinden (kısmi)", "Through the AutoCAD MCP (partial)"), homepage: "https://github.com/U-C4N/Autocad-MCP",
  detect: pyDetect(["Autodesk/AutoCAD 2026/acad.exe"]),
});
manual({
  id: "openfoam", category: "analysis", name: L("OpenFOAM", "OpenFOAM"),
  desc: L("CFD çözücüsü. Windows'ta WSL/Docker gerektirir; mevcut MCP'ler Linux odaklıdır. Rehberde seçenekler anlatılır.", "CFD solver. On Windows it needs WSL/Docker; the available MCPs are Linux oriented. The guide explains the options."),
  appNote: L("WSL / Docker (rehber)", "WSL / Docker (guide)"), homepage: "https://github.com/webworn/openfoam-mcp-server",
});
manual({
  id: "sap2000", category: "analysis", name: L("SAP2000", "SAP2000"),
  desc: L("Olgun bir MCP yok. ETABS MCP aynı COM tabanını kullanır; SAP2000 için rehberde yol gösterilir.", "No mature MCP exists. The ETABS MCP uses the same COM base; the guide shows the way for SAP2000."),
  appNote: L("Yok (rehber)", "None (guide)"), homepage: "https://www.csiamerica.com/products/sap2000",
  detect: pyDetect(["Computers and Structures/SAP2000 */SAP2000.exe"]),
});

export const PACK_DEFS = defs;
