#!/usr/bin/env bash
# MD Flow Viewer - macOS paketi (Apple Silicon). Repo kökünden: bash packaging/macos/build-dmg.sh
# Çıktı: dist/MDViewer-v<sürüm>-macos-arm64.dmg ("MD Flow Viewer.app" + Applications kısayolu)
#
# .app'i Tauri üretir (src-tauri/tauri.macos.conf.json). Uygulama Apple
# Developer kimliğiyle imzalı değil, yalnızca ad-hoc imzalı. Tarayıcıdan
# indirilen DMG'yi macOS ilk açılışta engeller (README'de nasıl açılacağı
# anlatılıyor); C Launcher ile kurulunca bu uyarı çıkmaz.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VERSION="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
[ -n "$VERSION" ] || { echo "Sürüm okunamadı (src-tauri/tauri.conf.json)" >&2; exit 1; }
APP_NAME="MD Flow Viewer"
APP="dist/$APP_NAME.app"
DMG="dist/MDViewer-v$VERSION-macos-arm64.dmg"

npx tauri build --bundles app
# cargo'nun hedef klasörü: bir cargo ayarı onu repo dışına taşıyabilir.
TARGET="$(cargo metadata --format-version 1 --no-deps | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).target_directory')"
BUILT="$TARGET/release/bundle/macos/$APP_NAME.app"
[ -d "$BUILT" ] || { echo "Paket bulunamadı: $BUILT" >&2; exit 1; }

mkdir -p dist
rm -rf "$APP"
cp -R "$BUILT" "$APP"

PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -replace CFBundleVersion -string "$VERSION" "$PLIST"
plutil -replace LSMinimumSystemVersion -string "11.0" "$PLIST"
# .md dosyaları için "Birlikte Aç" menüsünde görün (varsayılan uygulama yapmaz)
plutil -replace CFBundleDocumentTypes -json '[{"CFBundleTypeName":"Markdown","CFBundleTypeRole":"Editor","LSHandlerRank":"Alternate","LSItemContentTypes":["net.daringfireball.markdown","public.plain-text"],"CFBundleTypeExtensions":["md","markdown"]}]' "$PLIST"
# Info.plist değişince imza bozulur: yeniden ad-hoc imzala
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

# Paketlenmiş uygulamanın arayüzü içinde mi (pencere açmadan dener)
"$APP/Contents/MacOS/$(plutil -extract CFBundleExecutable raw "$PLIST")" --selftest

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
STAGE="$BUILD/dmg"
mkdir "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
echo "$DMG"
