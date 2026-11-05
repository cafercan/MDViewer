#!/usr/bin/env bash
# MD Flow Viewer - Fedora / openSUSE / RHEL .rpm paketi
# Çıktı: dist/mdflowviewer-<sürüm>-1.x86_64.rpm
#
# build-deb.sh ile aynı ikiliyi paketler. Kütüphane bağımlılıkları
# (libwebkit2gtk-4.1.so.0 vb.) rpmbuild tarafından ikiliden otomatik
# çıkarılır; bu sayede paket adları farklı dağıtımlarda da (Fedora:
# webkit2gtk4.1, openSUSE: libwebkit2gtk-4_1-0) doğru çözülür.
#
# Derleme:  bash packaging/linux/build-rpm.sh   (Rust, Node.js, WebKitGTK -dev, rpmbuild)
#           MDFLOW_BIN=yol/mdflowviewer bash packaging/linux/build-rpm.sh   (hazır ikiliyle)
# Kurulum:  sudo dnf install ./dist/mdflowviewer-<sürüm>-1.x86_64.rpm
set -euo pipefail
umask 022

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VERSION="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
[ -n "$VERSION" ] || { echo "Sürüm okunamadı (src-tauri/tauri.conf.json)" >&2; exit 1; }
case "$(uname -m)" in
  x86_64) ;;
  *) echo "yalnız x86_64 paketlenir" >&2; exit 1 ;;
esac
command -v rpmbuild >/dev/null || { echo "rpmbuild yok (Debian/Ubuntu: apt install rpm)" >&2; exit 1; }

PKG=mdflowviewer
# MDFLOW_BIN verilirse hazır ikili paketlenir (ör. CI'da build-deb.sh'in derlediği)
BIN="${MDFLOW_BIN:-}"
if [ -z "$BIN" ]; then
    npx tauri build --no-bundle
    TARGET="$(cargo metadata --format-version 1 --no-deps | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).target_directory')"
    BIN="$TARGET/release/mdflowviewer"
fi
BIN="$(realpath "$BIN")"
[ -x "$BIN" ] || { echo "İkili bulunamadı: $BIN" >&2; exit 1; }
"$BIN" --selftest

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

cat > "$TMP/SPECS/$PKG.spec" <<SPEC
%global debug_package %{nil}
%global _build_id_links none
%global __strip /bin/true

Name:           $PKG
Version:        $VERSION
Release:        1
Summary:        Markdown viewer and editor with live preview
License:        MIT
URL:            https://github.com/cafercan/MDViewer
ExclusiveArch:  x86_64
Requires:       xdg-utils

%description
Fast, local Markdown viewer/editor in its own window (Tauri + WebKitGTK).
Live reload when the file changes on disk, Mermaid diagrams, syntax
highlighting, block editing, Obsidian-style wikilinks and a folder explorer.

%install
install -Dm755 "$BIN" %{buildroot}%{_bindir}/$PKG
install -Dm644 "$ROOT/packaging/linux/$PKG.desktop" %{buildroot}%{_datadir}/applications/$PKG.desktop
for size in 32 192 512; do
  install -Dm644 "$ROOT/public/favicon-\$size.png" %{buildroot}%{_datadir}/icons/hicolor/\${size}x\${size}/apps/$PKG.png
done
install -Dm644 "$ROOT/public/favicon.svg" %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/$PKG.svg
install -Dm644 "$ROOT/LICENSE" %{buildroot}%{_datadir}/licenses/$PKG/LICENSE

%post
update-desktop-database -q %{_datadir}/applications >/dev/null 2>&1 || :
gtk-update-icon-cache -q -t -f %{_datadir}/icons/hicolor >/dev/null 2>&1 || :

%postun
update-desktop-database -q %{_datadir}/applications >/dev/null 2>&1 || :
gtk-update-icon-cache -q -t -f %{_datadir}/icons/hicolor >/dev/null 2>&1 || :

%files
%{_bindir}/$PKG
%{_datadir}/applications/$PKG.desktop
%{_datadir}/icons/hicolor/*/apps/$PKG.*
%license %{_datadir}/licenses/$PKG/LICENSE
SPEC

rpmbuild --define "_topdir $TMP" -bb "$TMP/SPECS/$PKG.spec"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/$PKG-$VERSION-1.x86_64.rpm"
cp "$TMP/RPMS/x86_64/$PKG-$VERSION-1.x86_64.rpm" "$OUT"
echo "OK: $OUT"
