#!/usr/bin/env bash
# MD Flow Viewer - Debian/Ubuntu .deb paketi
# Çıktı: dist/mdflowviewer_<sürüm>_all.deb
#
# Windows sürümünden farkı: PyInstaller bundle YOK. Uygulama saf Python olduğu
# için kaynak /usr/lib/mdflowviewer altına kopyalanır; flask, pywebview ve
# WebKitGTK dağıtımın kendi paketlerinden (Depends) gelir. Böylece GTK/WebKit'i
# paketin içine gömmek gerekmez ve güvenlik güncellemeleri apt ile gelir.
#
# Derleme:  bash packaging/linux/build-deb.sh
# Kurulum:  sudo apt install ./dist/mdflowviewer_<sürüm>_all.deb
set -euo pipefail
umask 022

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Tek sürüm kaynağı: Inno Setup betiği
VERSION="$(sed -n 's/^#define AppVersion "\(.*\)"/\1/p' "$ROOT/installer/MDFlowViewer.iss")"
[ -n "$VERSION" ] || { echo "Sürüm okunamadı (installer/MDFlowViewer.iss)" >&2; exit 1; }

PKG=mdflowviewer
OUT="$ROOT/dist/${PKG}_${VERSION}_all.deb"

# Paket ağacı geçici dizinde kurulur: repo FAT/NTFS gibi izin bitlerini
# tutmayan bir diskte olabilir; dpkg-deb ise DEBIAN/ betiklerinin 0755
# olmasını şart koşar.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAGE="$TMP/${PKG}_${VERSION}_all"
install -d "$STAGE/DEBIAN" \
           "$STAGE/usr/bin" \
           "$STAGE/usr/lib/$PKG/app" \
           "$STAGE/usr/share/applications" \
           "$STAGE/usr/share/doc/$PKG"

# --- Uygulama ---
install -m 644 "$ROOT"/app/*.py "$STAGE/usr/lib/$PKG/app/"
cp -r "$ROOT/public" "$STAGE/usr/lib/$PKG/public"
find "$STAGE/usr/lib/$PKG/public" -type d -exec chmod 755 {} +
find "$STAGE/usr/lib/$PKG/public" -type f -exec chmod 644 {} +
install -m 755 "$ROOT/packaging/linux/$PKG" "$STAGE/usr/bin/$PKG"

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
Architecture: all
Maintainer: cafercan <cafer.gemici@uestco.com>
Installed-Size: $SIZE_KB
Depends: python3 (>= 3.10), python3-flask (>= 2.0), python3-webview (>= 5.0), python3-gi, gir1.2-webkit2-4.1, gir1.2-gtk-3.0, xdg-utils
Homepage: https://github.com/cafercan/MDViewer
Description: Markdown viewer and editor with live preview
 Fast, local Markdown viewer/editor in its own window (pywebview + WebKitGTK).
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
