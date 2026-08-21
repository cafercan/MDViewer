; MD Flow Viewer - Inno Setup kurulum betiği (pywebview / Python sürümü)
; Program Files'a kurar, kurulum klasörü seçilebilir, Ekle/Kaldır'da görünür,
; .md/.markdown için sağ tık "Birlikte Aç" girişi ve varsayılan atanabilir kayıt ekler.
; Kendi penceresi WebView2 kullanır; ayrı Node.js / .NET gerekmez.

#define AppName "MD Flow Viewer"
#define AppVersion "2.3.0"
#define AppPublisher "cafercan"
#define AppExeName "MDFlowViewer.exe"
#define AppUrl "https://github.com/cafercan/MDViewer"

[Setup]
AppId={{9E7231B5-C614-4AAA-B5EA-B73031BECD16}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}
DefaultDirName={autopf}\MD Flow Viewer
DefaultGroupName=MD Flow Viewer
DisableProgramGroupPage=yes
DisableDirPage=no
AllowNoIcons=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=MDViewer-v{#AppVersion}
SetupIconFile=..\public\mdflow.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName=MDViewer
WizardStyle=modern
Compression=lzma2
SolidCompression=yes

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; Yükseltmede eski PyInstaller çıktısını tamamen sil. Aksi halde eski sürümün
; _internal\ dosyaları yeni bundle'la karışır (belirti: ModuleNotFoundError).
Type: filesandordirs; Name: "{app}\_internal"

[Files]
; PyInstaller one-dir çıktısı (MDFlowViewer.exe + _internal\...)
Source: "..\dist\MDFlowViewer\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; İkonu sabit bir yola da koy (kayıt defteri/kısayollar bunu gösterir)
Source: "..\public\mdflow.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\MD Flow Viewer"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\mdflow.ico"
Name: "{group}\{cm:UninstallProgram,MD Flow Viewer}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\MD Flow Viewer"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\mdflow.ico"; Tasks: desktopicon

[Registry]
; --- ProgId tanımı ---
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer"; ValueType: string; ValueName: ""; ValueData: "Markdown Belgesi"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer\shell\open"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer ile Aç"
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

; --- Uzantıları "Birlikte Aç" listesine bağla (varsayılanı KULLANICI seçer) ---
Root: HKLM; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "MDFlow.Viewer"; ValueData: ""; Flags: uninsdeletevalue
Root: HKLM; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "MDFlow.Viewer"; ValueData: ""; Flags: uninsdeletevalue

; --- Uygulama kaydı (Birlikte Aç listesinde görünür ad) ---
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\shell\open"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer ile Aç"
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\SupportedTypes"; ValueType: string; ValueName: ".markdown"; ValueData: ""

; --- Kaldırıcıyı "Birlikte Aç" listesinden gizle ---
Root: HKLM; Subkey: "Software\Classes\Applications\unins000.exe"; ValueType: string; ValueName: "NoOpenWith"; ValueData: ""; Flags: uninsdeletevalue

; --- Sağ tık bağlam menüsü ---
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithMDFlow"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer ile Aç"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithMDFlow"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithMDFlow\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithMDFlow"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer ile Aç"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithMDFlow"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithMDFlow\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,MD Flow Viewer}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
const
  WV2_GUID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

procedure SHChangeNotify(wEventId: Integer; uFlags: Cardinal; dwItem1, dwItem2: Cardinal);
  external 'SHChangeNotify@shell32.dll stdcall';

// Kurulum sonrası kabuğa ilişkilendirme değişikliğini bildir + ikon önbelleğini tazele.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    SHChangeNotify($08000000, $0000, 0, 0);
    Exec(ExpandConstant('{sys}\ie4uinit.exe'), '-show', '', SW_HIDE, ewNoWait, ResultCode);
  end;
end;

// WebView2 Runtime kontrolü (Evergreen).
// DİKKAT: ArchitecturesInstallIn64BitMode=x64compatible olduğu için sade HKLM
// okuması 64-bit kayıt görünümüne gider; WebView2 ise pv değerini 32-bit
// görünüme (WOW6432Node) yazar. Bu yüzden HKLM32 açıkça sorulur — aksi halde
// runtime kurulu olsa bile "bulunamadı" uyarısı çıkar.
function WebView2Version(RootKey: Integer): String;
var
  pv: String;
begin
  Result := '';
  if RegQueryStringValue(RootKey, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WV2_GUID, 'pv', pv) then
    if (pv <> '') and (pv <> '0.0.0.0') then
      Result := pv;
end;

function IsWebView2Installed(): Boolean;
var
  found: String;
begin
  found := WebView2Version(HKLM32);              // per-machine (normal durum)
  if found = '' then
    found := WebView2Version(HKCU);              // kullanıcı bazlı kurulum
  if (found = '') and IsWin64 then
    found := WebView2Version(HKLM64);            // ileride 64-bit'e taşınırsa
  Result := found <> '';
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsWebView2Installed() then
    if MsgBox('MD Flow Viewer için Microsoft Edge WebView2 Runtime gerekli ve şu an bulunamadı.'#13#10#13#10 +
              'https://developer.microsoft.com/microsoft-edge/webview2/ adresinden ücretsiz kurabilirsiniz.'#13#10#13#10 +
              'Yine de kuruluma devam edilsin mi?', mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
end;
