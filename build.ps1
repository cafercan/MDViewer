# MD Flow Viewer - PyInstaller derleme betiği (repo kökünden çalıştır)
# Çıktı: dist\MDFlowViewer\MDFlowViewer.exe (+ _internal\)
pyinstaller --noconfirm --clean --windowed `
  --name MDFlowViewer `
  --icon public/mdflow.ico `
  --add-data "public;public" `
  --collect-all webview `
  --distpath dist --workpath build `
  app/main.py
