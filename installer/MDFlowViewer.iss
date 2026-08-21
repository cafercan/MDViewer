; MD Flow Viewer - Inno Setup kurulum betiği (pywebview / Python sürümü)
; Program Files'a kurar, kurulum klasörü seçilebilir, Ekle/Kaldır'da görünür,
; .md/.markdown için sağ tık "Birlikte Aç" girişi ve varsayılan atanabilir kayıt ekler.
; Kendi penceresi WebView2 kullanır; ayrı Node.js / .NET gerekmez.

#define AppName "MD Flow Viewer"
#define AppVersion "2.2.2"
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

// WebView2 Runtime kontrolü (Evergreen). Kurulum 32-bit çalışır; EdgeUpdate
// anahtarı WOW6432Node altında olduğundan HKLM okuması doğrudan oraya gider.
// Ayrıca HKCU (kullanıcı bazlı kurulum) kontrol edilir.
function IsWebView2Installed(): Boolean;
var
  pv: String;
  guid: String;
begin
  guid := '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := False;
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + guid, 'pv', pv) then
    if (pv <> '') and (pv <> '0.0.0.0') then Result := True;
  if not Result then
    if RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + guid, 'pv', pv) then
      if (pv <> '') and (pv <> '0.0.0.0') then Result := True;
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
