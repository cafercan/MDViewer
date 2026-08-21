# MD Flow Viewer - PyInstaller derleme betiği (repo kökünden çalıştır)
# Çıktı: dist\MDFlowViewer\MDFlowViewer.exe (+ _internal\)
#
# PyInstaller MUTLAKA .venv yorumlayıcısıyla çalıştırılır. PATH'teki global
# pyinstaller kullanılırsa flask/pywebview o ortamda bulunmadığı için analiz
# sessizce boş geçer ve çalışmayan bir iskelet bundle üretilir (belirti:
# çalıştırınca "No module named 'uuid'" gibi ModuleNotFoundError).

$ErrorActionPreference = 'Stop'
$py = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

if (-not (Test-Path $py)) {
    throw ".venv bulunamadi: $py  ->  python -m venv .venv; .venv\Scripts\pip install -r requirements.txt"
}

# Bağımlılıklar gerçekten bu ortamda mı? (yanlış ortamla derlemeyi baştan kes)
& $py -c "import flask, webview, PyInstaller"
if ($LASTEXITCODE -ne 0) {
    throw ".venv'de flask/pywebview/pyinstaller eksik -> .venv\Scripts\pip install -r requirements.txt"
}

& $py -m PyInstaller --noconfirm --clean --windowed `
  --name MDFlowViewer `
  --icon public/mdflow.ico `
  --add-data "public;public" `
  --collect-all webview `
  --collect-submodules encodings `
  --distpath dist --workpath build `
  app/main.py
if ($LASTEXITCODE -ne 0) { throw "PyInstaller basarisiz (exit $LASTEXITCODE)" }

# --- Bundle doğrulama ---
# Saf Python modülleri _internal\ altında klasör DEĞİL, exe içindeki PYZ
# arşivindedir; bu yüzden klasör bakmak yerine PYZ içeriğini listeliyoruz.
& $py (Join-Path $PSScriptRoot 'installer\verify_bundle.py') (Join-Path $PSScriptRoot 'dist\MDFlowViewer\MDFlowViewer.exe')
if ($LASTEXITCODE -ne 0) {
    throw "Bundle dogrulamasi basarisiz - yanlis Python ortamiyla mi derlendi?"
}

foreach ($must in '_internal\webview', '_internal\public\index.html', 'MDFlowViewer.exe') {
    $p = Join-Path $PSScriptRoot "dist\MDFlowViewer\$must"
    if (-not (Test-Path $p)) { throw "Bundle eksik: $must" }
}

"OK: dist\MDFlowViewer\MDFlowViewer.exe"
