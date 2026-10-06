# ArchMCP – Claude (ve Codex, Antigravity, OpenCode) ile mimarlık, mühendislik, CAD, 3B, müzik ve oyun yazılımları

Windows kullanıcısı tek bir `ArchMCP-Setup-x.y.z.exe` çalıştırır; seçtiği yazılımların MCP sunucuları kurulur ve Claude Desktop'a
bağlanır. Kurulumdan sonra **ArchMCP kontrol paneli** ile bağlantılar açılıp kapatılır, ayarlanır, test edilir; **Mağaza**'dan yeni
MCP'ler sonradan eklenir; **Rehber** her program için görselli, adım adım (TR/EN) anlatır. Kullanıcı kendi Claude hesabıyla çalışır.
Sunucular isteğe bağlı olarak **Codex, Antigravity ve OpenCode**'a da yazılır (kurulumda ve Ayarlar > AI uygulamaları'nda aç/kapa).

## Desteklenen yazılımlar (33 giriş)

| Grup | Kurulumla gelen (çekirdek) | Mağaza'dan indirilen (imzalı paketler) |
|---|---|---|
| Mimari / BIM | Revit 2025-27, AutoCAD 2026 | Archicad, IFC dosya analizi, Bonsai (Blender), QGIS |
| Mekanik CAD | FreeCAD | SolidWorks, Fusion, Siemens NX, Inventor |
| Analiz / simülasyon | – | MATLAB/Simulink, OpenSeesPy (kendi sunucumuz), ETABS, Ansys, Abaqus, COMSOL |
| Elektronik / müzik | – | Altium, LTspice/ngspice, Ableton Live |
| Görsel / 3B | Photoshop, Blender, OpenSCAD, SketchUp (bulut) | Rhino/Grasshopper, Maya |
| Oyun | Godot, Unity | Unreal Engine |
| Yalnızca rehber (otomatik kurulmaz) | – | KiCad, Civil 3D (AutoCAD üzerinden), OpenFOAM (WSL), SAP2000 |

"Kararlı" paketler hazır wheel/npm/sürüm ikilisiyle gelir; "Deneysel" olanlar az test edilmiş topluluk projeleridir (panelde etiketlidir).

## Mimari

```
installer/ArchMCP.iss        Inno Setup: bileşen seçimi, onay, kısayollar, kaldırıcı, (isteğe bağlı) kod imzalama
app/lib/registry.mjs         çekirdek 9 entegrasyon  +  registry-packs.mjs: 20 paket + 4 rehber girişi (TEK doğruluk kaynağı)
app/lib/packs.mjs            imzalı katalog, doğrulamalı indirme, güvenli açma, kur/güncelle/kaldır
app/lib/ports.mjs            port yöneticisi (çakışma bulma + otomatik atama)
app/lib/syscheck.mjs         "bu PC çalıştırabilir mi?" kontrolleri
app/lib/clients.mjs          AI uygulamaları: Claude (JSON), Codex (TOML), Antigravity (JSON), OpenCode (JSON) - yazma/silme/yedek
app/lib/{settings,claude,addons,detect,health,apply}.mjs
app/py/bootstrap.py          paketlerin izole Python başlatıcısı (python -I -S)
app/cli/{setup,doctor}.mjs   installer'ın çağırdığı kurulum/kaldırma, terminal tanılama
app/gui/                     kontrol paneli: server.mjs (127.0.0.1 API) + launcher.mjs + ui/ (TR/EN, açık/koyu)
app/gui/ui/guides*.js        rehber içeriği (31 program + 7 genel), şematik SVG çizimleri
packs/opensees/              kendi yazdığımız OpenSeesPy MCP sunucusu
build/lock_packs.py          sürüm+SHA-256 kilit dosyaları (build/locks/*.txt)
build/build-payload.mjs      çekirdek payload (Node, Python, sunucular) + SBOM
build/build-packs.mjs        paketler + imzalı katalog;  make-keys.mjs: imza anahtarı;  make-sbom.mjs
build/ci-*.mjs               kurulu uygulamayı panel üzerinden uçtan uca sürer
tests/                       71 test
```

### "Her Windows'ta çalışsın, bağımlılık hatası olmasın" için alınan önlemler
- **Hiçbir şey kullanıcının sistemine bağlı değil**: Node 22 ve Python 3.12 paketlenir; Visual C++ çalışma zamanı DLL'leri
  uygulamayla birlikte (app-local) gelir, yönetici izni gerekmez. Python sunucuları `-I` (PYTHONPATH/user-site yok sayılır) ile,
  paketler `-S` ile (yorumlayıcının kendi paketleri bile görünmez) çalışır. Her paket **kendi tam bağımlılık setiyle** izoledir:
  MCP 1.x ve 2.x aynı bilgisayarda çakışmadan çalışır.
- **Çözümleme kullanıcının PC'sinde yapılmaz**: tüm Python bağımlılıkları sürüm+SHA-256 kilitli wheel'dir; derleme CI'da,
  Windows'ta yapılır, her sunucu gerçek bir MCP el sıkışmasıyla denenir. Başlamayan paket kataloğa girmez.
- **Sistem uyumluluğu kontrolü** (Tanılama sayfası): Windows sürümü, 64 bit, disk, yazma izni, yol uzunluğu, Node/Python gerçekten
  başlıyor mu (antivirüs/AppLocker), VC++ çalışma zamanı, Claude Desktop, proxy, uzun yol desteği.
- Yönetici izni gerekmez; `%LOCALAPPDATA%\Programs\ArchMCP`. Türkçe karakter/boşluklu kullanıcı yolları desteklenir.

### Birden çok AI uygulaması
Ayarlar > **AI uygulamaları** (ve kurulumdaki görev kutuları): Claude Desktop, Codex, Antigravity, OpenCode. Aynı sunucular her birinin kendi biçiminde yazılır;
yalnızca `archmcp-` kayıtlarına dokunulur, her yazmadan önce yedek alınır, ayrıştırılamayan dosyaya yazılmaz, kapatılan uygulamadan kayıtlar silinir.
Codex için `~/.codex/config.toml` içinde işaretli bir blok, Antigravity için `~/.gemini/config/mcp_config.json`, OpenCode için `~/.config/opencode/opencode.json`.

### Port yönetimi
Birçok program Claude ile konuşmak için yerel bir port açar; Blender, Bonsai, Fusion ve QGIS hepsi varsayılan olarak 9876'yı kullanır.
Panel sistemin dinlediği portları tarar (`netstat`), çakışmayı bulur ve yapılandırılabilen tarafı boş bir porta taşır:
sunucu açıyorsa env ile, eklenti açıyorsa eklenti dosyasını yeni portla **yeniden yazarak** (Fusion, QGIS, Bonsai, Ableton), programda elle
ayar gerekiyorsa nereye yazılacağını söyleyerek (Blender, Rhino). Sabit portlar (Revit, FreeCAD, Unity, Archicad) yalnızca bildirilir.

### Tedarik zinciri
Ayrıntı: [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md). Özet: hash'li kilitler, `--require-hashes --no-deps`, commit'e sabit git,
SHA-256'lı ikililer, Ed25519 imzalı katalog, her dosyası hash'lenen paketler, güvenli açma, sabitlenmiş GitHub Actions, CycloneDX SBOM,
imzalı yükleyici.

### Çalışma süresi / performans
`.pyc` ön derlemesi (ilk başlangıç hızlı), her sunucunun başlama süresi testte ölçülüp panelde gösterilir (örn. 0,6–2,5 sn), AutoCAD'de
"Araç keşfi: Arama" ve "Hafif araç seti", Photoshop'ta araç profili, **profiller** (örn. "Mimari", "Elektronik": tek tıkla yalnızca o grup açık,
diğerleri kapalı — Claude'un başlattığı süreç sayısı ve araç sayısı düşer), gerekmeyen paketlerin hiç indirilmemesi.

## Yetki ve onay modeli
Kullanıcı kurulumda **kullanım koşulları + tam yetki onayını** kabul etmeden devam edemez (`installer/docs/TERMS.*.txt`; sessiz kurulumda
`/ACCEPTTERMS=1`). Varsayılan yetki geniştir; panelden daraltılır. **Bilerek verilmeyen tek şey**: AutoCAD'in ham komut kısıtlaması
(SHELL/NETLOAD/APPLOAD); ayrı, uyarılı, onaylı bir anahtarla açılır. Yapısal/mühendislik analizi sonuçları için ayrı sorumluluk reddi vardır.

## Geliştirme

```bash
npm test                                   # 71 test (TOML doğrulaması için Python 3.11+ varsa PYTHON=... verin)
node build/make-keys.mjs                   # ilk kez: katalog imza anahtarı (özel anahtarı CATALOG_SIGNING_KEY secret'ı yap)
python build/lock_packs.py                 # kilit dosyalarını yenile (yeni sürüm eklerken)
node build/build-payload.mjs               # çekirdek payload
node build/build-packs.mjs --out dist/packs # paketler + imzalı katalog
node app/gui/launcher.mjs --no-open        # paneli başlatır (geliştirme)
iscc /DAppVersion=0.2.0 installer\ArchMCP.iss
```

Yeni bir MCP eklemek: `build/packs.json` (kaynak + sürüm/commit) → `python build/lock_packs.py <id>` → `app/lib/registry-packs.mjs`
(`add({...})`) → `app/gui/ui/guides-data.js` (TR/EN rehber) → `app/gui/ui/app.js` içindeki `TILE`. Testler eksik rehberi/çeviriyi yakalar.

### CI sırları (hepsi isteğe bağlı; yoksa geliştirme derlemesi çıkar)
| Secret | Anlamı |
|---|---|
| `CATALOG_SIGNING_KEY` | Katalog imza anahtarı (Ed25519 PEM). `app/lib/catalog-key.mjs` içindeki **açık anahtar** buna uymalı. Yükleyici derlemesinde yoksa geçici anahtar kullanılır (geliştirme derlemesi); **Publish catalog** ise anahtarsız yayınlamayı reddeder |
| `WIN_CODESIGN_PFX_BASE64` + `WIN_CODESIGN_PASSWORD` | Authenticode sertifikası (.pfx, base64). Yoksa yükleyici imzasız kalır (SmartScreen uyarır). EV sertifika veya Azure Trusted Signing SmartScreen itibarını hızlandırır |

## Yayınlama (GitHub ile, elle adres girmeden)

Kaynak depo **private** kalabilir (ya da sonradan herkese açılırsa: depo değişkeni `PACKS_REPO` = bu deponun adı yapılır, ayrı paket deposu ve `PACKS_REPO_TOKEN` gerekmez). Mağaza paketleri kimlik doğrulamasız indirdiği için paketler ayrı, **herkese açık ve kod içermeyen** bir depoda (varsayılan `alperAygor/mcp_win_packs`; başka ad için depo değişkeni `PACKS_REPO`) yayınlanır.

1. Herkese açık boş bir depo oluşturun (`mcp_win_packs`). Yalnızca imzalı paket zipleri ve katalog oraya gider; kaynak kod gitmez.
2. Yazma izinli bir token üretin (fine-grained: yalnızca o depo, Contents = Read and write) ve kaynak depoya **`PACKS_REPO_TOKEN`** sırrı olarak ekleyin.
3. **Katalog imza anahtarı**: açık anahtar `app/lib/catalog-key.mjs` içinde, özel anahtar `build/keys/catalog-private.pem` (git dışı, yedekleyin!) ve depo sırrı **`CATALOG_SIGNING_KEY`**. Kaybolursa katalog bir daha imzalanamaz.
4. Actions > **Publish catalog** çalıştırın: paketler Windows'ta derlenir, MCP el sıkışmasıyla denenir, imzalanır, `mcp_win_packs` deposunun `catalog` sürümüne yüklenir. Paket eklemek/güncellemek için yükleyiciyi yeniden yayınlamak gerekmez.
5. `Build installer` her push'ta çalışır; yükleyiciye katalog adresi (`https://github.com/<packs deposu>/releases/download/catalog`) otomatik gömülür. Yükleyici `.exe` dosyasını Actions çıktısından (artifact) indirip kullanıcıya doğrudan verebilirsiniz.
6. Haftalık **Upstream watch** yeni upstream sürümlerini issue olarak bildirir (otomatik güncellemez).

Kod imzalama sertifikası (`WIN_CODESIGN_PFX_BASE64` + `WIN_CODESIGN_PASSWORD`) **isteğe bağlıdır**: yoksa yükleyici imzasız çıkar ve çalışır (SmartScreen uyarır; onay metni ve BEFORE dosyası bunu anlatır).

## Dağıtımdan önce yapılacaklar
1. Özel anahtarı yedekleyin; `CATALOG_SIGNING_KEY` ve `PACKS_REPO_TOKEN` sırlarını ekleyin (yukarıda). Yayın hattı eşleşmeyi `verify-catalog.mjs` ile kontrol eder.
2. (İsteğe bağlı) **Kod imzalama sertifikası** (OV/EV veya Azure Trusted Signing). Şimdilik test için imzasız çalışır.
3. **Hukuki inceleme**: onay metni avukattan geçmedi; yayıncı adı yer tutucu.
4. **Gerçek makinede test**: aşağıdaki "Doğrulanmamışlar".

## Doğrulanmamışlar
- Bu geliştirme **macOS'ta** yapıldı. Çekirdek 8 sunucu ve 12 paket gerçek MCP el sıkışmasıyla, panel üzerinden **Mac'te** doğrulandı;
  Windows'a özgü parçalar (Inno betiği, `.exe`, Edge penceresi, dosya seçici, Claude'u yeniden başlatma, UPIA, `wscript` kısayolu, `netstat`,
  Windows wheel'leri, VC++ DLL kopyası, kod imzalama) CI'da ve gerçek makinede ilk kez çalışacak.
- Altium paketi Mac'te test edilemedi (pywin32 gerekir); Windows CI'da denenir. Windows'a özgü paketler (SolidWorks, Inventor, ETABS, OpenSees, MATLAB) de.
- **Hiçbir ticari programla** (SolidWorks, ETABS, NX, Ansys, MATLAB, Altium, Revit...) gerçek bağlantı denenmedi; yalnızca sunucuların başladığı ve araçlarını bildirdiği doğrulandı.
- Rehberlerdeki menü yolları upstream belgelerinden alındı; **çizimler şematiktir, gerçek ekran görüntüsü değildir** (gerçek görüntüler eklenebilir).
- **Codex, Antigravity ve OpenCode** ile gerçek uçtan uca deneme yapılmadı; yapılandırma biçimleri resmî belgelerden alındı, TOML çıktısı Python `tomllib` ile doğrulandı. Antigravity belgeleri iki dosya konumu gösteriyor; ikisi de desteklenir.
- **COMSOL ve LTspice**: sunucular MCP el sıkışmasıyla denendi (COMSOL 50, LTspice 7 araç) ama gerçek COMSOL/LTspice kurulumuyla değil.
- Photoshop `.ccx` sessiz kurulumu, Blender eklentisinin başsız etkinleştirilmesi, Claude'un `claude://` ile yeniden başlatılması.
