# MD Flow Viewer - Windows kurulumu (repo kökünden ya da herhangi bir yerden çalışır)
# Çıktı: dist\MDViewer-v<sürüm>.exe
#
# Sürüm tek yerden gelir: src-tauri\tauri.conf.json. Exe cargo'nun hedef
# klasöründedir; bir cargo ayarı onu repo dışına taşıyabilir (ör. ortak
# D:\cargo-target\windows), bu yüzden yol cargo metadata'dan alınır.
# Gerekenler: Rust, Node.js (npm ci), Inno Setup 6 (ISCC.exe).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
if (-not $version) { throw "Sürüm okunamadı (src-tauri\tauri.conf.json)" }

$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 (ISCC.exe) bulunamadı" }

npx tauri build --no-bundle
if ($LASTEXITCODE -ne 0) { throw "tauri build başarısız (exit $LASTEXITCODE)" }

$target = (cargo metadata --format-version 1 --no-deps | ConvertFrom-Json).target_directory
if ($LASTEXITCODE -ne 0 -or -not $target) { throw "cargo metadata başarısız" }
$exe = Join-Path $target 'release\mdflowviewer.exe'
if (-not (Test-Path $exe)) { throw "Exe bulunamadı: $exe" }

# Paketlenmiş exe'nin arayüzü içinde mi (pencere açmadan dener). Exe GUI
# alt sistemli: PowerShell onu beklemez ve $LASTEXITCODE eski kalır; boru
# (| Out-Host) bitmesini ve çıkış kodunu bekletir.
& $exe --selftest | Out-Host
if ($LASTEXITCODE -ne 0) { throw "selftest başarısız" }

& $iscc "/DAppVersion=$version" "/DTargetDir=$target" installer\MDFlowViewer.iss
if ($LASTEXITCODE -ne 0) { throw "ISCC başarısız (exit $LASTEXITCODE)" }

$setup = "dist\MDViewer-v$version.exe"
if (-not (Test-Path $setup)) { throw "Kurulum bulunamadı: $setup" }
$mb = [math]::Round((Get-Item $setup).Length / 1MB, 2)
"Kurulum: $setup ($mb MB)"
