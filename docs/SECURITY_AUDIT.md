# Güvenlik denetimi (2026-10-06, 2. bölüm: Blender, FreeCAD, OpenSCAD, Godot, Unity sonradan eklendi)

Kapsam: bundle edilen üç upstream proje (pinli sürümler, `versions.json`) ve bu repodaki kurulum kodu.
Yöntem: kaynak kodunda hedefli tarama (ağ dinleyicileri, dış bağlantılar, süreç/kod çalıştırma, yetki modelleri, kimlik
doğrulama) + çalıştırarak doğrulama. **Satır satır tam kod incelemesi değildir** (~660 kaynak dosya), bağımlılıkların
(npm/pip) kaynağı da incelenmedi; resmî bir güvenlik denetimi yerine geçmez.

## Upstream bulguları

| Konu | Bulgu | Sonuç |
|---|---|---|
| Telemetri / dış ağ | Üçünde de yok (tek dış bağlantı: AutoCAD yardım metnindeki ODA indirme linki) | Temiz |
| Dinleyiciler | Revit: `127.0.0.1` + zorunlu rastgele token (v0.8.17'den beri kapatılamaz). Photoshop: `127.0.0.1` WebSocket | Temiz |
| Revit token | Add-in açılışta 32 bayt rastgele token üretip `Addins\<yıl>\revit-mcp-token.txt`'ye yazar; aynı kullanıcının her süreci okuyabilir | Kabul edilebilir (yerel, kullanıcı bağlamı); kaldırmada silinir |
| Photoshop yükleme yolları | Varsayılan olarak **çalışma dizininden** `extensions/` (JS `import()`), `capabilities.json`, `workflows.json` yükler → Claude'un başlattığı dizine bağlı | **Düzeltildi**: üçü kendi klasörümüze sabitlendi, uzantılar `none` |
| Photoshop yetkileri | `READ, EDIT, EXTERNAL (dosya/süreç), DESTRUCTIVE`; varsayılan yalnızca `read,edit` | Kurulum `all` verir (kullanıcı onayıyla) |
| AutoCAD ham komut | `DANGEROUS_COMMANDS_ENABLED=true` silme/kaydetmenin yanında `SHELL, NETLOAD, APPLOAD, VBARUN, SCRIPT` gibi **OS'de kod çalıştırma** yollarını da açar | Varsayılan **kapalı**; kurulumda ayrı, işaretsiz, uyarılı seçenek. Silme/kaydetme/temizleme tipli araçlarla zaten mümkün |
| AutoCAD dosya erişimi | Yol geçişi (`..`, UNC, `\\?\`) engelleri var, sistem dizini koruması var; `ALLOWED_PATHS` boş = tüm yerel sürücüler | Tam yetki gereği bırakıldı |
| Python modül gölgelenmesi | Paketin üst düzey modülü `server`; kullanıcının `PYTHONPATH`/user-site'ı gölgeleyebilirdi | **Düzeltildi**: `python -I` |
| Photoshop `port-holder` | `netstat` çağırır (`shell:false`, sabit argüman), yalnızca başlatma hatasında | Temiz |

## Kalan riskler (kod ile kapatılamaz)

1. **Prompt injection**: açılan dosyadaki metin Claude'u yönlendirebilir. Tam yetkiyle etkisi büyüktür → onay metni ve rehberde uyarı var, yedek önerilir.
2. **Yazma/silme yetkisi** (özellikle Photoshop `destructive`) geri alınamaz olabilir.
3. **Tedarik zinciri**: bağımlılıklar derleme anında npm/PyPI'den çekilir (sürümler kilitli değil: Photoshop `npm ci` lock'lu; AutoCAD için `pip` geçişli bağımlılıklar kilitli değil). Üretim için `pip` constraints dosyası eklenmeli.
4. **Dağıtım**: imzasız `.exe` → SmartScreen/antivirüs uyarısı (kurulumda ve indirme sayfasında anlatılır). Kod imzalama sertifikası alınana dek sürer.
5. Upstream projeler tek kişilik; güvenlik yamaları bizim yeni sürüm yayınlamamıza bağlı.

## Bu repodaki kod

- Claude config yazımı: yedek + atomik değiştirme, bozuk JSON'a dokunmaz, yalnızca `archmcp-` önekli kayıtları yönetir (9 test).
- Kaldırma adımları birbirinden bağımsız (kilitli Revit DLL'i config temizliğini engellemez).
- Sessiz kurulumda da `/ACCEPTTERMS=1` zorunlu (CI'da test edilir).

## Sonradan eklenen beş entegrasyon (Blender, FreeCAD, OpenSCAD, Godot, Unity)

Aynı yöntem (hedefli tarama + çalıştırarak doğrulama). Sürümler `versions.json`'da kilitli.

| Konu | Bulgu | Sonuç |
|---|---|---|
| **Blender telemetri** | `mcp-for-blender` varsayılan olarak anonim kullanım kaydı gönderir (kurulum kimliği, araç adı, süre, sürümler, işletim sistemi; uç nokta Supabase). İçerik toplama opt-in; ancak veri "yapay zekâ eğitimi dahil" kullanılabileceğini yazıyor | **Kapatıldı**: `DISABLE_TELEMETRY=true` (test ediliyor) |
| **Unity telemetri** | `mcpforunityserver` varsayılan olarak `api-prod.coplay.dev`'e telemetri gönderir | **Kapatıldı**: `DISABLE_TELEMETRY` + `UNITY_MCP_DISABLE_TELEMETRY` |
| Blender eklentisi (Blender içinde) | Kendi güncelleme kontrolünü ve (kullanıcı açarsa) Poly Haven/Sketchfab/AI üretici çağrılarını yapar; Blender'ın ortamını biz kontrol edemeyiz | Belgelendi; sunucu tarafında `BLENDERMCP_NO_UPDATE_CHECK=1` |
| Blender "Premium" | AI model üretiminde Claude'a ücretli ürünü bir kez anmasını söyleyen ipucu metni ekler | Yalnızca 3B üretim özelliği kullanılırsa; kabul edildi |
| Soket kimlik doğrulaması | Blender eklenti soketi (9876) ve Unity köprüsü (6400) kimlik doğrulamasız; FreeCAD RPC (9875) varsayılan olarak `localhost`, tarayıcı isteklerini reddediyor | Yalnızca loopback; aynı bilgisayardaki herhangi bir süreç Blender/FreeCAD'de kod çalıştırabilir. Güvenli mod (Blender) panelde seçenek |
| Kod çalıştırma | Blender `execute_blender_code` ve FreeCAD `execute_code` tasarım gereği keyfi Python çalıştırır | Yetki onayında açıkça yazılı; Blender için Güvenli mod |
| Godot | `execFile`/`spawn` ile **argüman dizisi** (shell yok), dış ağ yok | Temiz |
| OpenSCAD | `subprocess.run` ile `openscad` çalıştırır (argüman dizisi, `stdin=DEVNULL`); dış çağrı yok | Temiz |
| Unity Python sunucusu | Pencere odağı için süreç çalıştırır (`focus_nudge`); telemetri dışında dış çağrı yok | Kabul edildi |
| Unity Editor eklentisi (C#) | Unity içinden GitHub'a güncelleme/beceri senkronu ve Roslyn indirme yapabilir | Belgelendi (onay metni); eklenti projeye *gömülü paket* olarak kopyalanır |
| Genel isim çakışması | AutoCAD (`server`, `config`, `security`...) ve Unity (`main`, `core`, `utils`, `models`...) paketleri genel adlı üst düzey modüller bırakır | **Çözüldü**: ikisi kendi klasörüne taşınır (`ARCHMCP_SITE`), diğer üçü ad alanlı; beşi birlikte çözülüp (86 paket) gerçek MCP el sıkışmasıyla doğrulandı |

## Kontrol paneli (yerel web arayüzü)

Claude yapılandırmasını yazabildiği ve eklenti kurabildiği için saldırı yüzeyidir; önlemler:
`127.0.0.1`'e bağlı, her başlatmada rastgele token (URL parçasında, sunucuya hiç gitmez), `Host` ve `Origin` doğrulaması
(DNS rebinding / çapraz site), yalnızca beyaz listedeki statik dosyalar, CSP `default-src 'self'`, tüm girdiler şemaya göre
doğrulanır, tarayıcıdan gelen hedef yollar (eklenti hedefi, yedek dosyası, açılacak URL/klasör) yalnızca bizim bulduğumuz/
tanımladığımız değerlerle eşleşirse kullanılır, 64 KB gövde sınırı, arayüz kapanınca 45 sn içinde sunucu kendini kapatır.
32 testin 12'si bunları doğrular.

## Üçüncü bölüm: MCP paketleri (Store) ve tedarik zinciri

### Tedarik zinciri kontrolleri (hepsi otomatik, CI'da)
| Katman | Kontrol |
|---|---|
| Node / Python çalışma ortamı | SHA-256 doğrulaması (Node: resmî SHASUMS; Python: yayıncının .sha256) |
| Python paketleri (çekirdek + her paket) | `build/lock_packs.py` ile **sürüm + SHA-256 kilitli** (`build/locks/*.txt`); kurulum `pip --require-hashes --no-deps`, yalnızca wheel. Windows'a özgü koşullu bağımlılıklar (colorama, pywin32...) işaretleyici denetimiyle tamamlanır |
| npm paketleri | `package-lock.json` bütünlük (integrity) kilitli, `npm ci --ignore-scripts` |
| Git kaynakları | Tam commit SHA'ya sabit; kaynak `compile` edilir (bozuk upstream commit'i inşayı durdurur) |
| Sürüm ikilileri / tek dosyalar | SHA-256 sabitli (`--pin` ile bir kez kaydedilir) |
| Yamalar | Tam eşleşme zorunlu; upstream değişirse derleme durur |
| Katalog | Ed25519 imzalı (`catalog.sig`), uygulamaya gömülü açık anahtar(lar); imzasız/bozuk katalog yok sayılır |
| Paket kurulumu | İndirme: boyut ve SHA-256 katalogla eşleşmeli → güvenli açma (zip-slip, mutlak yol, sembolik bağ reddi) → `pack.json` içindeki **her dosyanın** SHA-256'sı → atomik yer değiştirme. Başarısızlıkta hiçbir iz kalmaz |
| GitHub Actions | Tam commit SHA'ya sabit |
| SBOM | CycloneDX 1.5 (`sbom.json`): 700+ bileşen, sürüm ve hash |
| Kod imzalama | Yükleyici ve kaldırıcı Authenticode imzalı (sertifika sağlandığında); `signtool verify` CI'da |
| Başarısız paketler | Windows'ta MCP el sıkışması yapamayan paket **kataloğa girmez** |

### Paket bulguları
- **Bozuk upstream**: Ansys sunucusunun son commit'inde kaynak dosyaya yapay zekâ çıktısı kesintisi ("...tokens truncated...") yapışmış, dosya derlenmiyor. Çalışan son commit'e sabitlendi; derleme zamanı sözdizimi denetimi eklendi.
- **MCP 1.x / 2.x ayrımı**: Rhino, Archicad, NX MCP 2.x ister; Bonsai, QGIS, Altium, Fusion, Abaqus MCP 1.x'e göre yazılmış (FastMCP API'si değişti). Ortak ortam imkânsız → her paket kendi tam bağımlılık setiyle izole (`python -I -S`, paket klasörü sys.path'in başında).
- **Telemetri**: Ableton sunucusu varsayılan olarak anonim kullanım gönderir → `ABLETON_MCP_DISABLE_TELEMETRY=1`. (Blender/Unity önceki bölümde.)
- **Port çakışmaları**: Blender, Bonsai, Fusion ve QGIS aynı varsayılan portu (9876) kullanır; port yöneticisi çözer, eklenti dosyaları (Fusion, QGIS, Bonsai, Ableton) yeni portla yeniden yazılır.
- **Kod çalıştırma**: MATLAB, Unreal, Maya, Rhino, Inventor, FreeCAD, Blender keyfi kod çalıştırır; Archicad `execute_script` sandbox'sızdır. Onay metninde yazılıdır.
- **Yapısal yazılımlar**: ETABS/OpenSees/Ansys/Abaqus sonuçları mühendis onayı gerektirir (onay metni, rehber ve panelde uyarı).
- **Kendi sunucumuz (OpenSeesPy)**: betik güvenli modda AST ile denetlenir (os/subprocess/socket/open/eval vb. reddedilir), izole çalışma klasörü, zaman aşımı, çıktı sınırı, yol kaçışı koruması (12 test).
- **Panel çökmesi**: Node'un HTTP istemcisinde (undici) bir iç doğrulama hatası paneli çökertmişti → indirme okuyucu döngüsüyle yeniden yazıldı ve süreç düzeyinde güvenlik ağı eklendi.

### Dışarıda bırakılanlar ve nedenleri
KiCad (Python bağımlılıkları KiCad'in kendi Python sürümüne bağlı; yarı manuel rehber), OpenFOAM (Windows'ta WSL/Docker gerekir), SAP2000 / Civil 3D (olgun MCP yok; rehber), Abaqus dışı CAE'ler henüz eklenmedi (COMSOL ve LTspice artık paket olarak var). OASiS ve PESIM: kaynak bulunamadı.

## Dördüncü bölüm: çoklu AI uygulaması, gerçek katalog anahtarı, yayın hattı

### Birden çok AI uygulamasına yazma (Claude, Codex, Antigravity, OpenCode)
- Her uygulamanın kendi dosyası ve biçimi vardır (JSON `mcpServers`, TOML `[mcp_servers.*]`, OpenCode `mcp`); biz yalnızca `archmcp-` ile başlayan kayıtlara dokunuruz.
- Yazma: değişiklik olmuyorsa hiçbir şey yazılmaz; değişiyorsa **yedek** (aynı milisaniyede ikinci yedek ilkini ezmez) → **atomik** yazma. Ayrıştırılamayan dosyaya **asla** yazılmaz.
- Codex TOML'u için kütüphane yok: ArchMCP'nin bölümü işaretli bir blok olarak yönetilir; blok dışında kalmış `[mcp_servers.archmcp-*]` tabloları temizlenir (yinelenen tablo Codex'in tüm dosyayı reddetmesine yol açar). Çıktı testlerde Python `tomllib` ile doğrulanır; Windows yolları, tırnak ve Türkçe karakterler dahil.
- OpenCode'da varsayılan 5 sn araç-listesi zaman aşımı Python sunucularının ilk açılışı için kısadır → 90 sn yazılır; Codex için `startup_timeout_sec = 90`.
- Kapatılan uygulamadan kayıtlar silinir, kullanıcının kendi sunucuları kalır; kaldırıcı bütün uygulamalardan siler. CI bunu gerçek Windows kurulumunda doğrular.
- **Doğrulanmadı**: Codex, Antigravity ve OpenCode'un gerçek sürümleriyle uçtan uca deneme yapılmadı. Biçimler resmî belgelerden alındı; Antigravity için belgeler iki konum gösteriyor (`~/.gemini/config/mcp_config.json` güncel, `~/.gemini/antigravity/` eski), ikisi de desteklenir.

### Katalog imza anahtarı
Geliştirme anahtarı kaldırıldı; `app/lib/catalog-key.mjs` içinde gerçek (`archmcp-2026-10`) açık anahtar var. Özel anahtar `build/keys/` altında (git dışı) ve CI sırrı `CATALOG_SIGNING_KEY` olmalı. Yayın hattı, sırrın repodaki açık anahtarla eşleştiğini `build/verify-catalog.mjs` ile **yayından önce** doğrular (eşleşmezse tüm uygulamalar kataloğu reddederdi).

### Yayın hattı (yönetimsel yükü azaltmak için)
- `publish-catalog.yml`: Windows'ta tüm paketleri derler, gerçek MCP el sıkışmasıyla dener, başarısızları dışarıda bırakır, **gerçek anahtarla** imzalar ve repodaki "catalog" adlı kayan sürüme yükler. Anahtar yoksa **yayınlamayı reddeder**.
- Yükleyici derlemesi katalog adresini `GITHUB_REPOSITORY`'den kendisi türetir (`.../releases/download/catalog`); elle adres girmek gerekmez. Panelin Store sayfası oturum başına bir kez yeni imzalı kataloğu sessizce arar; çevrimdışıysa gömülü katalog kullanılır.
- `upstream-watch.yml` + `build/check-upstream.mjs`: haftalık, sabitlenmiş commit/sürümlerin yeni sürümü var mı diye **yalnızca raporlar** (otomatik güncelleme yok; sessizce kayan sabit tam olarak önlemek istediğimiz risktir). Bilinçli beklemeler `packs.json` içinde `hold` ile işaretlenir (Ansys bozuk HEAD, Altium MCP 1.5.0).
- Depo **herkese açık** olmalı (kullanıcılar sürüm dosyalarını kimlik doğrulamasız indirir); aksi halde başka bir barındırma adresi `versions.json > catalog.baseUrl` ile verilir.

### Yeni paketler
- **COMSOL** (Ching-Chiang/comsol-mcp, MIT): COMSOL Server'a bağlanır; 50 araç. Gerçek COMSOL ile denenmedi. Server portu `host-manual` olarak port yöneticisine kayıtlı.
- **LTspice / ngspice** (Cognitohazard/ltspice-mcp, **GPL-3.0**, PyPI 0.6.1, 7 araç): ayrı süreç olarak, değiştirilmeden dağıtılır. Upstream'in `run_code` aracı (keyfi Python) **varsayılan KAPALI** (`LTSPICE_MCP_RUN_CODE=false`; panelde uyarılı onayla açılır); dosya erişimi `LTSPICE_MCP_ALLOWED_PATHS` ile kullanıcı klasörlerine (varsayılan Belgeler\LTspice) sınırlı; sunucunun çalışma klasörüne yapılandırma dosyası bırakması kapalı (`LTSPICE_MCP_WRITE_CONFIG=false`).
