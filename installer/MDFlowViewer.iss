; MD Flow Viewer - Inno Setup kurulum betiği
; Program Files'a kurar, kurulum klasörü seçilebilir, Ekle/Kaldır'da görünür,
; .md/.markdown için sağ tık "Birlikte Aç" girişi ve varsayılan atanabilir kayıt ekler.
; Taşınabilir node.exe gömülüdür; hedef makinede Node.js kurulu olması gerekmez.

#define AppName "MD Flow Viewer"
#define AppVersion "1.0.0"
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
Source: "..\build\stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\MD Flow Viewer"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\public\mdflow.ico"
Name: "{group}\{cm:UninstallProgram,MD Flow Viewer}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\MD Flow Viewer"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\public\mdflow.ico"; Tasks: desktopicon

[Registry]
; --- ProgId tanımı ---
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer"; ValueType: string; ValueName: ""; ValueData: "Markdown Belgesi"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\public\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer\shell\open"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer ile Aç"
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\public\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\MDFlow.Viewer\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

; --- Uzantıları "Birlikte Aç" listesine bağla (varsayılanı KULLANICI seçer) ---
Root: HKLM; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "MDFlow.Viewer"; ValueData: ""; Flags: uninsdeletevalue
Root: HKLM; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "MDFlow.Viewer"; ValueData: ""; Flags: uninsdeletevalue

; --- Uygulama kaydı (Birlikte Aç listesinde görünür ad) ---
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\public\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\shell\open"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer ile Aç"
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""
Root: HKLM; Subkey: "Software\Classes\Applications\{#AppExeName}\SupportedTypes"; ValueType: string; ValueName: ".markdown"; ValueData: ""

; --- Gömülü node.exe ve kaldırıcıyı "Birlikte Aç" listesinden gizle ---
; node.exe launcher tarafından dahili kullanılıyor; kullanıcının .md için
; yanlışlıkla node.exe'yi (veya kaldırıcıyı) seçmesini engeller.
Root: HKLM; Subkey: "Software\Classes\Applications\node.exe"; ValueType: string; ValueName: "NoOpenWith"; ValueData: ""; Flags: uninsdeletevalue
Root: HKLM; Subkey: "Software\Classes\Applications\unins000.exe"; ValueType: string; ValueName: "NoOpenWith"; ValueData: ""; Flags: uninsdeletevalue

; --- Sağ tık bağlam menüsü ---
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithMDFlow"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer ile Aç"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithMDFlow"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\public\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithMDFlow\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithMDFlow"; ValueType: string; ValueName: ""; ValueData: "MD Flow Viewer ile Aç"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithMDFlow"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\public\mdflow.ico"
Root: HKLM; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithMDFlow\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,MD Flow Viewer}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
procedure SHChangeNotify(wEventId: Integer; uFlags: Cardinal; dwItem1, dwItem2: Cardinal);
  external 'SHChangeNotify@shell32.dll stdcall';

// Kurulumdan sonra kabuğa dosya ilişkilendirmelerinin değiştiğini bildir ki
// yeni ikon ve "Birlikte Aç" girişi hemen görünsün (SHCNE_ASSOCCHANGED),
// ardından Explorer ilişkilendirme/ikon önbelleğini tazele.
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

// .NET 8 Masaüstü Çalışma Zamanı uyarısı (MDFlowViewer.exe buna bağımlı).
// Not: kurulum 32-bit çalışır; HKLM okuması Wow6432Node'a yönlenir ve 64-bit
// dotnet anahtarını KAÇIRIR. Bu yüzden 64-bit hive için HKLM64 kullanıyoruz,
// ayrıca güvence olarak paylaşılan çalışma zamanı klasörünü de kontrol ediyoruz.
function IsDotNet8DesktopInstalled(): Boolean;
var
  Names: TArrayOfString;
  I: Integer;
  Key: String;
  FindRec: TFindRec;
  BasePath: String;
begin
  Result := False;

  // 1) 64-bit kayıt defteri (native hive)
  Key := 'SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.WindowsDesktop.App';
  if RegGetValueNames(HKLM64, Key, Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Copy(Names[I], 1, 2) = '8.' then
        Result := True;
  if Result then Exit;

  // 2) Dosya sistemi yedeği: 64-bit Program Files altındaki paylaşılan runtime
  BasePath := ExpandConstant('{commonpf64}\dotnet\shared\Microsoft.WindowsDesktop.App');
  if FindFirst(BasePath + '\8.*', FindRec) then
  try
    repeat
      if (FindRec.Attributes and $10) <> 0 then  // FILE_ATTRIBUTE_DIRECTORY
      begin
        Result := True;
        Break;
      end;
    until not FindNext(FindRec);
  finally
    FindClose(FindRec);
  end;
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsDotNet8DesktopInstalled() then
    if MsgBox('MD Flow Viewer için .NET 8 Masaüstü Çalışma Zamanı (Desktop Runtime x64) gerekli ve şu an bulunamadı.'#13#10#13#10 +
              'https://dotnet.microsoft.com/download/dotnet/8.0 adresinden kurabilirsiniz.'#13#10#13#10 +
              'Yine de kuruluma devam edilsin mi?', mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
end;
