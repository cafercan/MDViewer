@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================================
echo          MD Flow Viewer Windows Kurulumu
echo ========================================================
echo.
echo .md ve .markdown dosya iliskilendirmeleri ayarlaniyor...
echo.

"%~dp0MDFlowViewer.exe" --install

echo.
echo Kurulum komutu tamamlandi.
pause
