; ArchMCP - one installer that wires Revit, AutoCAD, Photoshop (and SketchUp) into Claude Desktop.
; Build:  iscc /DAppVersion=0.1.0 installer\ArchMCP.iss     (after: node build\build-payload.mjs)
;
; Per-user install (no admin prompt): every thing we touch - Claude's config, Revit's Addins folder,
; the Photoshop plugin - lives in the user's profile anyway.

#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif
#define AppName "ArchMCP"
#define Payload "..\payload"
; Code signing: iscc /DSIGN=1 "/Ssigntool=signtool.exe sign /f cert.pfx /p ... /tr ... $f"  (see .github/workflows)
#define SketchupUrl "https://claude.com/marketplace/connectors/sketchup"

[Setup]
AppId={{B7D1E0A4-5C32-4F1B-9A55-3E8C2F6D7A10}
AppName={#AppName}
AppVersion={#AppVersion}
SetupIconFile=archmcp.ico
UninstallDisplayIcon={app}\archmcp.ico
AppPublisher=ArchMCP
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
SolidCompression=yes
DisableProgramGroupPage=yes
WizardStyle=modern
OutputDir=..\dist
OutputBaseFilename=ArchMCP-Setup-{#AppVersion}
UninstallDisplayName={#AppName}
CloseApplications=no
MinVersion=10.0
#ifdef SIGN
SignTool=signtool
SignedUninstaller=yes
#endif

[Languages]
; LicenseFile = the terms + full-authority consent. Setup cannot proceed past it without "I accept".
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"; LicenseFile: "docs\TERMS.tr.txt"; InfoBeforeFile: "docs\BEFORE.tr.txt"; InfoAfterFile: "docs\AFTER.tr.txt"
Name: "en"; MessagesFile: "compiler:Default.isl"; LicenseFile: "docs\TERMS.en.txt"; InfoBeforeFile: "docs\BEFORE.en.txt"; InfoAfterFile: "docs\AFTER.en.txt"

[Messages]
tr.LicenseLabel=Lütfen devam etmeden önce kullanım koşullarını ve YETKİ ONAYINI dikkatle okuyun.
en.LicenseLabel=Please read the terms of use and PERMISSION CONSENT carefully before continuing.
tr.LicenseAccepted=Koşulları okudum, anladım; Claude'a yukarıda açıklanan TAM YETKİYİ bilerek &veriyorum
en.LicenseAccepted=I have read and understood the terms and knowingly &grant the FULL AUTHORITY described above
tr.LicenseNotAccepted=Koşulları &kabul etmiyorum (kurulum yapılamaz)
en.LicenseNotAccepted=I &do not accept (setup cannot continue)

[CustomMessages]
tr.CompCore=Çekirdek (Node.js çalışma ortamı + yapılandırma araçları)
en.CompCore=Core (Node.js runtime + setup tools)
tr.CompRevit=Autodesk Revit (2025 / 2026 / 2027)
en.CompRevit=Autodesk Revit (2025 / 2026 / 2027)
tr.CompAutocad=Autodesk AutoCAD 2026 (yalnızca 2026; Python çalışma ortamı dahil)
en.CompAutocad=Autodesk AutoCAD 2026 (2026 only; includes Python runtime)
tr.TaskGroup=Gelişmiş (önerilmez)
en.TaskGroup=Advanced (not recommended)
tr.TaskUnsafe=AutoCAD ham komut kısıtlamasını kaldır (SHELL, NETLOAD, APPLOAD gibi bilgisayarda program çalıştıran komutlara izin verir; güvenliği ciddi şekilde düşürür)
en.TaskUnsafe=Remove AutoCAD raw-command restriction (allows commands that run programs on this PC such as SHELL, NETLOAD, APPLOAD; seriously lowers security)
tr.NeedTerms=Sessiz kurulum için koşulların kabulü gerekir: /ACCEPTTERMS=1 parametresini ekleyerek koşulları ve tam yetki onayını kabul ettiğinizi belirtin.
en.NeedTerms=Silent setup requires accepting the terms: add /ACCEPTTERMS=1 to confirm you accept the terms and the full-authority consent.
tr.ConfirmUninstall=ArchMCP kaldırılacak:%n - Claude yapılandırmanızdaki archmcp kayıtları%n - Revit eklentisi (Revit kapalı olmalı)%n - Photoshop eklentisi%n%nDiğer MCP sunucularınıza dokunulmaz. Devam edilsin mi?
en.ConfirmUninstall=ArchMCP will be removed:%n - the archmcp entries in your Claude config%n - the Revit add-in (Revit must be closed)%n - the Photoshop plugin%n%nYour other MCP servers are untouched. Continue?
tr.GuideName=Kullanım Kılavuzu
en.GuideName=User Guide
tr.CompBlender=Blender (eklenti otomatik kurulur ve etkinleştirilir)
en.CompBlender=Blender (add-on installed and enabled automatically)
tr.CompFreecad=FreeCAD (eklenti otomatik kurulur)
en.CompFreecad=FreeCAD (add-on installed automatically)
tr.CompOpenscad=OpenSCAD (OpenSCAD'in ayrıca kurulu olması gerekir)
en.CompOpenscad=OpenSCAD (OpenSCAD itself must be installed)
tr.CompGodot=Godot (godot.exe yolunu ArchMCP panelinden seçersiniz)
en.CompGodot=Godot (pick the godot.exe path in the ArchMCP panel)
tr.CompUnity=Unity (paket, projelere ArchMCP panelinden eklenir)
en.CompUnity=Unity (package is added to projects from the ArchMCP panel)
tr.TaskClientsGroup=Hangi AI uygulamalarına bağlansın? (sonra ArchMCP > Ayarlar'dan değiştirebilirsiniz)
en.TaskClientsGroup=Which AI apps should be connected? (you can change this later in ArchMCP > Settings)
tr.TaskDesktop=Masaüstüne ArchMCP kısayolu ekle
en.TaskDesktop=Create an ArchMCP shortcut on the desktop
tr.LaunchApp=ArchMCP'yi şimdi başlat (bağlantıları buradan seçip Claude'a uygularsınız)
en.LaunchApp=Start ArchMCP now (choose connections here and apply them to Claude)
tr.AppShortcut=ArchMCP
en.AppShortcut=ArchMCP
tr.CompPhotoshop=Adobe Photoshop (eklenti otomatik kurulur)
en.CompPhotoshop=Adobe Photoshop (plugin installed automatically)
tr.OpenSketchup=SketchUp bağlayıcısını Claude'da ekle (tarayıcıda açılır)
en.OpenSketchup=Add the SketchUp connector in Claude (opens browser)
tr.NoClaude=Claude Desktop bulunamadı. Kurulum yine de tamamlandı, ancak sunucuların Claude'a bağlanması için önce Claude Desktop'ı kurup bu kurulumu yeniden çalıştırın.
en.NoClaude=Claude Desktop was not found. Setup finished, but to connect the servers to Claude, install Claude Desktop and run this installer again.
tr.NeedsManual=Kurulum tamamlandı ancak bazı adımlar elle tamamlanmalı (örn. Photoshop eklentisi veya geçersiz bir Claude yapılandırma dosyası). Ayrıntı için başlat menüsündeki "ArchMCP Tanılama" aracını çalıştırın.
en.NeedsManual=Setup finished, but some steps need manual follow-up (e.g. the Photoshop plugin or an invalid Claude config file). Run "ArchMCP Doctor" from the Start menu for details.
tr.Failed=Yapılandırma başarısız oldu. Günlük: %1
en.Failed=Configuration failed. Log: %1
tr.RestartClaude=Önemli: Revit/Photoshop açıksa kapatıp yeniden başlatın ve Claude Desktop'ı tamamen kapatıp (sistem tepsisinden de çıkın) yeniden açın. Codex, Antigravity veya OpenCode seçtiyseniz onları da kapatıp yeniden açın.
en.RestartClaude=Important: restart Revit/Photoshop if open, and fully quit Claude Desktop (also from the system tray) and reopen it. If you chose Codex, Antigravity or OpenCode, reopen those too.
tr.DoctorName=ArchMCP Tanılama
en.DoctorName=ArchMCP Doctor

[Components]
Name: "core"; Description: "{cm:CompCore}"; Types: full custom; Flags: fixed
Name: "revit"; Description: "{cm:CompRevit}"; Types: full custom
Name: "revit\r2025"; Description: "Revit 2025"; Types: full custom
Name: "revit\r2026"; Description: "Revit 2026"; Types: full custom
Name: "revit\r2027"; Description: "Revit 2027"; Types: full custom
Name: "autocad"; Description: "{cm:CompAutocad}"; Types: full custom
Name: "photoshop"; Description: "{cm:CompPhotoshop}"; Types: full custom
Name: "blender"; Description: "{cm:CompBlender}"; Types: full custom
Name: "freecad"; Description: "{cm:CompFreecad}"; Types: full custom
Name: "openscad"; Description: "{cm:CompOpenscad}"; Types: full custom
Name: "godot"; Description: "{cm:CompGodot}"; Types: full custom
Name: "unity"; Description: "{cm:CompUnity}"; Types: full custom

[Tasks]
Name: "desktopicon"; Description: "{cm:TaskDesktop}"
Name: "client_claude"; Description: "Claude Desktop"; GroupDescription: "{cm:TaskClientsGroup}"
Name: "client_codex"; Description: "OpenAI Codex (CLI / IDE)"; GroupDescription: "{cm:TaskClientsGroup}"; Flags: unchecked
Name: "client_antigravity"; Description: "Google Antigravity"; GroupDescription: "{cm:TaskClientsGroup}"; Flags: unchecked
Name: "client_opencode"; Description: "OpenCode"; GroupDescription: "{cm:TaskClientsGroup}"; Flags: unchecked
Name: "autocadunsafe"; Description: "{cm:TaskUnsafe}"; GroupDescription: "{cm:TaskGroup}"; Components: autocad; Flags: unchecked

[Files]
Source: "docs\GUIDE.*.html"; DestDir: "{app}\docs"; Components: core; Flags: ignoreversion
Source: "archmcp.ico"; DestDir: "{app}"; Components: core; Flags: ignoreversion
Source: "{#Payload}\runtime\node\*"; DestDir: "{app}\runtime\node"; Components: core; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\app\*"; DestDir: "{app}\app"; Components: core; Flags: recursesubdirs ignoreversion
Source: "..\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Components: core; Flags: ignoreversion
Source: "{#Payload}\versions.json"; DestDir: "{app}"; Components: core; Flags: ignoreversion
Source: "{#Payload}\sbom.json"; DestDir: "{app}"; Components: core; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#Payload}\catalog\*"; DestDir: "{app}\catalog"; Components: core; Flags: ignoreversion skipifsourcedoesntexist
; Revit
Source: "{#Payload}\servers\revit\*"; DestDir: "{app}\servers\revit"; Components: revit; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\servers\revit-addin\2025\*"; DestDir: "{app}\servers\revit-addin\2025"; Components: revit\r2025; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\servers\revit-addin\2026\*"; DestDir: "{app}\servers\revit-addin\2026"; Components: revit\r2026; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\servers\revit-addin\2027\*"; DestDir: "{app}\servers\revit-addin\2027"; Components: revit\r2027; Flags: recursesubdirs ignoreversion
; Photoshop
Source: "{#Payload}\servers\photoshop\*"; DestDir: "{app}\servers\photoshop"; Components: photoshop; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\servers\photoshop-plugin\*"; DestDir: "{app}\servers\photoshop-plugin"; Components: photoshop; Flags: recursesubdirs ignoreversion
; Python runtime (shared by every Python-based MCP; carries Blender, FreeCAD and OpenSCAD packages)
; The bare interpreter is always installed (downloadable packs run on it); the big shared package set only with the integrations that use it
Source: "{#Payload}\runtime\python\*"; DestDir: "{app}\runtime\python"; Excludes: "Lib\site-packages\*"; Components: core; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\runtime\python\Lib\site-packages\*"; DestDir: "{app}\runtime\python\Lib\site-packages"; Components: autocad blender freecad openscad unity; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\servers\autocad\*"; DestDir: "{app}\servers\autocad"; Components: autocad; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\servers\unity\*"; DestDir: "{app}\servers\unity"; Components: unity; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\servers\unity-package\*"; DestDir: "{app}\servers\unity-package"; Components: unity; Flags: recursesubdirs ignoreversion
Source: "{#Payload}\servers\freecad-addon\*"; DestDir: "{app}\servers\freecad-addon"; Components: freecad; Flags: recursesubdirs ignoreversion
; Godot (Node based)
Source: "{#Payload}\servers\godot\*"; DestDir: "{app}\servers\godot"; Components: godot; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\{cm:AppShortcut}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\app\gui\launch.vbs"""; IconFilename: "{app}\archmcp.ico"; WorkingDir: "{app}"
Name: "{autodesktop}\{cm:AppShortcut}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\app\gui\launch.vbs"""; IconFilename: "{app}\archmcp.ico"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{group}\{cm:DoctorName}"; Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\app\cli\doctor.mjs"" --app-dir ""{app}"""; WorkingDir: "{app}"; IconFilename: "{app}\archmcp.ico"
Name: "{group}\{cm:GuideName}"; Filename: "{app}\docs\GUIDE.{language}.html"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\app\gui\launch.vbs"""; Description: "{cm:LaunchApp}"; Flags: postinstall nowait skipifsilent
Filename: "{#SketchupUrl}"; Description: "{cm:OpenSketchup}"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
; stop a running control panel first so its files can be deleted
Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\app\cli\setup.mjs"" --action uninstall --app-dir ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "ArchMCPUnconfigure"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function ProgFiles(): String;
begin
  Result := ExpandConstant('{commonpf64}');
end;

function AnyMatch(const Dir, Pattern: String): Boolean;
var
  R: TFindRec;
begin
  Result := False;
  if FindFirst(Dir + '\' + Pattern, R) then
  try
    Result := True;
  finally
    FindClose(R);
  end;
end;

function RevitInstalled(Year: Integer): Boolean;
begin
  Result := FileExists(ProgFiles() + '\Autodesk\Revit ' + IntToStr(Year) + '\Revit.exe');
end;

function Autocad2026Installed(): Boolean;
begin
  Result := FileExists(ProgFiles() + '\Autodesk\AutoCAD 2026\acad.exe');
end;

function BlenderInstalled(): Boolean;
begin
  Result := AnyMatch(ProgFiles() + '\Blender Foundation', 'Blender *');
end;

function FreecadInstalled(): Boolean;
begin
  Result := AnyMatch(ProgFiles(), 'FreeCAD *') or AnyMatch(ExpandConstant('{localappdata}\Programs'), 'FreeCAD*');
end;

function OpenscadInstalled(): Boolean;
begin
  Result := AnyMatch(ProgFiles(), 'OpenSCAD*') or AnyMatch(ExpandConstant('{localappdata}\Programs'), 'OpenSCAD*');
end;

function UnityInstalled(): Boolean;
begin
  Result := DirExists(ProgFiles() + '\Unity\Hub\Editor');
end;

function PhotoshopInstalled(): Boolean;
begin
  Result := AnyMatch(ProgFiles() + '\Adobe', 'Adobe Photoshop *');
end;

function CodexInstalled(): Boolean;
begin
  Result := DirExists(ExpandConstant('{%USERPROFILE}\.codex')) or FileExists(ExpandConstant('{userappdata}\npm\codex.cmd'));
end;

function AntigravityInstalled(): Boolean;
begin
  Result := DirExists(ExpandConstant('{%USERPROFILE}\.gemini')) or AnyMatch(ExpandConstant('{localappdata}\Programs'), '*ntigravity*');
end;

function OpencodeInstalled(): Boolean;
begin
  Result := DirExists(ExpandConstant('{%USERPROFILE}\.config\opencode')) or FileExists(ExpandConstant('{userappdata}\npm\opencode.cmd'));
end;

function ClaudeInstalled(): Boolean;
begin
  Result := DirExists(ExpandConstant('{userappdata}\Claude')) or
            AnyMatch(ExpandConstant('{localappdata}\Packages'), 'Claude_*') or
            FileExists(ExpandConstant('{localappdata}\AnthropicClaude\claude.exe')) or
            AnyMatch(ExpandConstant('{localappdata}\Programs'), 'claude*');
end;

procedure AddComp(var List: String; const Item: String);
begin
  if List <> '' then List := List + ',';
  List := List + Item;
end;

{ Pre-tick only what is actually on this PC; the user can still tick anything else. }
procedure InitializeWizard();
var
  Any: Boolean;
  Y: Integer;
  Id: String;
begin
  Any := False;
  for Y := 2025 to 2027 do
  begin
    Id := 'revit\r' + IntToStr(Y);
    if RevitInstalled(Y) then begin WizardSelectComponents(Id); Any := True; end
    else WizardSelectComponents('!' + Id);
  end;
  if Any then WizardSelectComponents('revit') else WizardSelectComponents('!revit');
  if Autocad2026Installed() then WizardSelectComponents('autocad') else WizardSelectComponents('!autocad');
  if PhotoshopInstalled() then WizardSelectComponents('photoshop') else WizardSelectComponents('!photoshop');
  if BlenderInstalled() then WizardSelectComponents('blender') else WizardSelectComponents('!blender');
  if FreecadInstalled() then WizardSelectComponents('freecad') else WizardSelectComponents('!freecad');
  if OpenscadInstalled() then WizardSelectComponents('openscad') else WizardSelectComponents('!openscad');
  if UnityInstalled() then WizardSelectComponents('unity') else WizardSelectComponents('!unity');
  WizardSelectComponents('!godot'); { a loose godot.exe cannot be detected reliably: opt-in }
  { AI apps: Claude Desktop stays on; the others are pre-ticked only when they are on this PC }
  if CodexInstalled() then WizardSelectTasks('client_codex');
  if AntigravityInstalled() then WizardSelectTasks('client_antigravity');
  if OpencodeInstalled() then WizardSelectTasks('client_opencode');
end;

{ "claude,codex,..." - the AI apps the servers are written to (app\cli\setup.mjs --clients). }
function GetClientsArg(Param: String): String;
begin
  Result := '';
  if WizardIsTaskSelected('client_claude') then AddComp(Result, 'claude');
  if WizardIsTaskSelected('client_codex') then AddComp(Result, 'codex');
  if WizardIsTaskSelected('client_antigravity') then AddComp(Result, 'antigravity');
  if WizardIsTaskSelected('client_opencode') then AddComp(Result, 'opencode');
end;

{ "revit:2025+2026,photoshop,autocad:unsafe,blender,..." - the format app\cli\setup.mjs parses. }
function GetComponentsArg(Param: String): String;
var
  Years: String;
begin
  Result := '';
  Years := '';
  if WizardIsComponentSelected('revit\r2025') then Years := Years + '+2025';
  if WizardIsComponentSelected('revit\r2026') then Years := Years + '+2026';
  if WizardIsComponentSelected('revit\r2027') then Years := Years + '+2027';
  if Years <> '' then AddComp(Result, 'revit:' + Copy(Years, 2, Length(Years)));
  if WizardIsComponentSelected('photoshop') then AddComp(Result, 'photoshop');
  if WizardIsComponentSelected('autocad') then
  begin
    if WizardIsTaskSelected('autocadunsafe') then AddComp(Result, 'autocad:unsafe') else AddComp(Result, 'autocad');
  end;
  if WizardIsComponentSelected('blender') then AddComp(Result, 'blender');
  if WizardIsComponentSelected('freecad') then AddComp(Result, 'freecad');
  if WizardIsComponentSelected('openscad') then AddComp(Result, 'openscad');
  if WizardIsComponentSelected('godot') then AddComp(Result, 'godot');
  if WizardIsComponentSelected('unity') then AddComp(Result, 'unity');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Msg: String;
begin
  if CurStep <> ssPostInstall then Exit;
  if not Exec(ExpandConstant('{app}\runtime\node\node.exe'),
      ExpandConstant('"{app}\app\cli\setup.mjs" --action install --app-dir "{app}" --consent --components "') + GetComponentsArg('') + '" --clients "' + GetClientsArg('') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := 1;
  if Code = 1 then
    MsgBox(FmtMessage(CustomMessage('Failed'), [ExpandConstant('{app}\logs\setup-install.log')]), mbError, MB_OK)
  else
  begin
    Msg := CustomMessage('RestartClaude');
    if Code = 2 then Msg := CustomMessage('NeedsManual') + #13#10#13#10 + Msg;
    if WizardIsTaskSelected('client_claude') and not ClaudeInstalled() then Msg := CustomMessage('NoClaude') + #13#10#13#10 + Msg;
    if not WizardSilent() then MsgBox(Msg, mbInformation, MB_OK);
  end;
end;

{ The control panel runs on the bundled node.exe: stop it before files are replaced or deleted. }
procedure StopControlPanel();
var
  Code: Integer;
  AppDir: String;
begin
  AppDir := ExpandConstant('{app}');
  Exec('powershell.exe',
    '-NoProfile -WindowStyle Hidden -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' + AppDir + '\runtime\node\*'' } | Stop-Process -Force"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopControlPanel();
  Result := '';
end;

{ Consent is enforced in silent mode too: no /ACCEPTTERMS=1, no install. }
function InitializeSetup(): Boolean;
begin
  Result := True;
  if WizardSilent() and (ExpandConstant('{param:ACCEPTTERMS|0}') <> '1') then
  begin
    MsgBox(CustomMessage('NeedTerms'), mbError, MB_OK);
    Result := False;
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := UninstallSilent() or (MsgBox(CustomMessage('ConfirmUninstall'), mbConfirmation, MB_YESNO) = IDYES);
  if Result then StopControlPanel();
end;
