#!/usr/bin/env bash
# MD Flow Viewer - macOS paketi (Apple Silicon). Repo kökünden: bash packaging/macos/build-dmg.sh
# Çıktı: dist/MDViewer-v<sürüm>-macos-arm64.dmg ("MD Flow Viewer.app" + Applications kısayolu)
#
# Uygulama Apple Developer kimliğiyle imzalı değil, yalnızca ad-hoc imzalı. Tarayıcıdan
# indirilen DMG'yi macOS ilk açılışta engeller (README'de nasıl açılacağı anlatılıyor);
# C Launcher ile kurulunca bu uyarı çıkmaz.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VERSION="$(sed -n 's/^#define AppVersion "\(.*\)"/\1/p' installer/MDFlowViewer.iss)"
[ -n "$VERSION" ] || { echo "Sürüm okunamadı (installer/MDFlowViewer.iss)" >&2; exit 1; }
APP_NAME="MD Flow Viewer"
APP="dist/$APP_NAME.app"
DMG="dist/MDViewer-v$VERSION-macos-arm64.dmg"
PY="${PYTHON:-python3}"

# Bağımlılıklar bu yorumlayıcıda mı? (yanlış ortamla derlenen bundle sessizce bozuk çıkar)
"$PY" -c "import flask, webview, PyInstaller"

# Simge: favicon-512.png'den .icns
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
ICONSET="$BUILD/mdflow.iconset"
mkdir "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s public/favicon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d public/favicon-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUILD/mdflow.icns"

# --argv-emulation: Finder'dan "Birlikte Aç" ile gelen dosya sys.argv'ye düşer
"$PY" -m PyInstaller --noconfirm --clean --windowed --argv-emulation \
  --name "$APP_NAME" \
  --osx-bundle-identifier com.cafercan.mdflowviewer \
  --icon "$BUILD/mdflow.icns" \
  --add-data "public:public" \
  --collect-all webview \
  --distpath dist --workpath "$BUILD/work" --specpath "$BUILD" \
  app/main.py

PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -replace CFBundleVersion -string "$VERSION" "$PLIST"
plutil -replace LSMinimumSystemVersion -string "11.0" "$PLIST"
# .md dosyaları için "Birlikte Aç" menüsünde görün (varsayılan uygulama yapmaz)
plutil -replace CFBundleDocumentTypes -json '[{"CFBundleTypeName":"Markdown","CFBundleTypeRole":"Editor","LSHandlerRank":"Alternate","LSItemContentTypes":["net.daringfireball.markdown","public.plain-text"],"CFBundleTypeExtensions":["md","markdown"]}]' "$PLIST"
# Info.plist değişince imza bozulur: yeniden ad-hoc imzala
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

STAGE="$BUILD/dmg"
mkdir "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
echo "$DMG"
