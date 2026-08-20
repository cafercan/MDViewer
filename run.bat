@echo off
setlocal EnableExtensions

:: MD Flow Viewer - gelistirme/elle calistirma baslaticisi.
:: MDFlowViewer.exe ile ayni davranisi hedefler: bos bir loopback portu sec,
:: sunucuyu baslat, hazir olmasini bekle, Edge'i app modunda ac.

cd /d "%~dp0"

:: --- On kosullar ----------------------------------------------------------
where node.exe >nul 2>&1
if errorlevel 1 (
    echo HATA: node.exe bulunamadi. Node.js kurulu ve PATH icinde olmali.
    call :wait_and_exit
    exit /b 1
)

if not exist "server.js" (
    echo HATA: server.js bulunamadi: %CD%
    call :wait_and_exit
    exit /b 1
)

if not "%~1" == "" if not exist "%~f1" (
    echo HATA: Dosya bulunamadi: %~f1
    call :wait_and_exit
    exit /b 1
)

:: --- Bos loopback portu sec ----------------------------------------------
set "PORT="
for /f "usebackq delims=" %%p in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$l.Start();$p=$l.LocalEndpoint.Port;$l.Stop();$p"`) do set "PORT=%%p"

:: Port gercekten sayi mi? Bos kalirsa sunucu 3000'e duser ve tarayici yanlis
:: adrese gider; bunu sessizce gecmek yerine burada durduruyoruz.
echo %PORT%| findstr /r /c:"^[1-9][0-9]*$" >nul
if errorlevel 1 (
    echo HATA: Bos port belirlenemedi.
    call :wait_and_exit
    exit /b 1
)

:: --- Sunucuyu baslat ------------------------------------------------------
:: Sunucu yalnizca 127.0.0.1 uzerinde dinler; yerel disk dosyalarini servis
:: ettigi icin aga acilmamalidir.
set "MDVIEWER_AUTO_EXIT=1"
set "SERVER_LOG=%TEMP%\mdviewer-%PORT%.log"

start "" /b node.exe server.js > "%SERVER_LOG%" 2>&1

:: Sabit bir bekleme yerine saglik ucunu yokla: yavas makinede yetismeme,
:: hizli makinede bosuna bekleme olmasin.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0; $i -lt 50; $i++){ try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri ('http://127.0.0.1:' + $env:PORT + '/api/health'); if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { } Start-Sleep -Milliseconds 200 }; if (-not $ok) { exit 1 }"
if errorlevel 1 (
    echo HATA: Sunucu baslatilamadi ^(port %PORT%^).
    echo Ayrinti: "%SERVER_LOG%"
    call :wait_and_exit
    exit /b 1
)

:: --- Adresi kur -----------------------------------------------------------
:: Dosya yolu URL'e kodlanmali: bosluk, ampersan, yuzde ve Turkce karakterler
:: aksi halde adresi bozar. Yol ortam degiskeniyle gecirilerek tirnak sorunu
:: da ortadan kalkiyor.
set "URL=http://127.0.0.1:%PORT%"
if not "%~1" == "" (
    set "MDVIEWER_FILE=%~f1"
    for /f "usebackq delims=" %%u in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "'http://127.0.0.1:' + $env:PORT + '/?file=' + [uri]::EscapeDataString($env:MDVIEWER_FILE)"`) do set "URL=%%u"
)

:: --- Tarayiciyi ac --------------------------------------------------------
set "EDGE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"

if defined EDGE (
    start "" "%EDGE%" --app="%URL%"
) else (
    rem Edge yoksa varsayilan tarayiciya dus; app modu olmaz ama uygulama acilir.
    start "" "%URL%"
)

endlocal
exit /b 0

:: Etkilesimli kullaniciya hatayi okuyacak kadar sure verir, ama gizli
:: pencerede calisirken sonsuza kadar beklemez.
:wait_and_exit
timeout /t 15 >nul 2>&1
exit /b
