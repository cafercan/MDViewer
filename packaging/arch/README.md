# Arch Linux / AUR paketleri

- `mdflowviewer/` — kaynaktan derler (Release etiketinin tarball'u, `cargo build`).
- `mdflowviewer-bin/` — Release'teki `.deb`'i yeniden paketler, derleme yok.

## Yeni sürümde

Her iki klasörde `pkgver`'i güncelle, `pkgrel=1` yap, sonra:

```bash
updpkgsums                          # sha256sums'ı yeniden hesaplar (pacman-contrib)
makepkg -f                          # dene
makepkg --printsrcinfo > .SRCINFO
```

`-bin` paketi Release'teki `.deb`'e bağlı: önce Release iş akışının bitmesini bekle.

## AUR'a gönderme (ilk sefer)

```bash
git clone ssh://aur@aur.archlinux.org/mdflowviewer-bin.git
cp packaging/arch/mdflowviewer-bin/{PKGBUILD,.SRCINFO} mdflowviewer-bin/
cd mdflowviewer-bin && git add PKGBUILD .SRCINFO && git commit -m "3.0.2" && git push
```

`mdflowviewer` için de aynısı. AUR hesabına SSH anahtarı eklenmiş olmalı.
