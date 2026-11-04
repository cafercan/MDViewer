#!/usr/bin/env bash
# MD Flow Viewer - Debian/Ubuntu .deb paketi
# Çıktı: dist/mdflowviewer_<sürüm>_amd64.deb
#
# 3.0'dan itibaren uygulama tek ikilidir (Rust/Tauri, arayüz içine gömülü):
# /usr/bin/mdflowviewer. WebKitGTK ve GTK dağıtımın kendi paketlerinden
# (Depends) gelir; güvenlik güncellemeleri apt ile gelir. 2.x'in Python
# paketinin (Architecture: all, /usr/lib/mdflowviewer) yerine geçer.
#
# Derleme:  bash packaging/linux/build-deb.sh   (Rust, Node.js, WebKitGTK -dev paketleri)
# Kurulum:  sudo apt install ./dist/mdflowviewer_<sürüm>_amd64.deb
set -euo pipefail
umask 022

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# Tek sürüm kaynağı: src-tauri/tauri.conf.json
VERSION="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
[ -n "$VERSION" ] || { echo "Sürüm okunamadı (src-tauri/tauri.conf.json)" >&2; exit 1; }
case "$(uname -m)" in
  x86_64) ;;
  *) echo "yalnız x86_64 paketlenir" >&2; exit 1 ;;
esac

PKG=mdflowviewer
OUT="$ROOT/dist/${PKG}_${VERSION}_amd64.deb"

npx tauri build --no-bundle
# cargo'nun hedef klasörü: bir cargo ayarı onu repo dışına taşıyabilir.
TARGET="$(cargo metadata --format-version 1 --no-deps | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).target_directory')"
BIN="$TARGET/release/mdflowviewer"
[ -x "$BIN" ] || { echo "İkili bulunamadı: $BIN" >&2; exit 1; }
"$BIN" --selftest

# Paket ağacı geçici dizinde kurulur: repo FAT/NTFS gibi izin bitlerini
# tutmayan bir diskte olabilir; dpkg-deb ise DEBIAN/ betiklerinin 0755
# olmasını şart koşar.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAGE="$TMP/${PKG}_${VERSION}_amd64"
install -d "$STAGE/DEBIAN" \
           "$STAGE/usr/bin" \
           "$STAGE/usr/share/applications" \
           "$STAGE/usr/share/doc/$PKG"

# --- Uygulama ---
install -m 755 "$BIN" "$STAGE/usr/bin/$PKG"

# --- Masaüstü entegrasyonu (menü girişi, .md "Birlikte Aç", ikon) ---
install -m 644 "$ROOT/packaging/linux/$PKG.desktop" "$STAGE/usr/share/applications/$PKG.desktop"
for size in 32 192 512; do
    d="$STAGE/usr/share/icons/hicolor/${size}x${size}/apps"
    install -d "$d"
    install -m 644 "$ROOT/public/favicon-$size.png" "$d/$PKG.png"
done
install -d "$STAGE/usr/share/icons/hicolor/scalable/apps"
install -m 644 "$ROOT/public/favicon.svg" "$STAGE/usr/share/icons/hicolor/scalable/apps/$PKG.svg"
install -m 644 "$ROOT/LICENSE" "$STAGE/usr/share/doc/$PKG/copyright"

SIZE_KB="$(du -sk "$STAGE/usr" | cut -f1)"
cat > "$STAGE/DEBIAN/control" <<CTRL
Package: $PKG
Version: $VERSION
Section: text
Priority: optional
Architecture: amd64
Maintainer: cafercan <cafer.gemici@uestco.com>
Installed-Size: $SIZE_KB
Depends: libwebkit2gtk-4.1-0, libgtk-3-0, xdg-utils
Homepage: https://github.com/cafercan/MDViewer
Description: Markdown viewer and editor with live preview
 Fast, local Markdown viewer/editor in its own window (Tauri + WebKitGTK).
 Live reload when the file changes on disk, Mermaid diagrams, syntax
 highlighting, block editing, Obsidian-style wikilinks and a folder explorer.
CTRL

# Menü, MIME ve ikon önbelleklerini tazele (dpkg tetikleyicileri çoğu
# dağıtımda bunu zaten yapar; yine de eksik kalmasın).
cat > "$STAGE/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
exit 0
POST
cp "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/postrm"
sed -i 's/if \[ "\$1" = "configure" \]; then/if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then/' "$STAGE/DEBIAN/postrm"
chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/postrm"

mkdir -p "$ROOT/dist"
dpkg-deb --root-owner-group --build "$STAGE" "$OUT"
echo "OK: $OUT"
