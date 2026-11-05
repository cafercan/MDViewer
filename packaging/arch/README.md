# Arch Linux / AUR paketleri

- `mdflowviewer/` — kaynaktan derler (Release etiketinin tarball'u, `cargo build`).
- `mdflowviewer-bin/` — Release'teki `.deb`'i yeniden paketler, derleme yok.

## Otomatik güncelleme

GitHub'da release yayınlanınca `.github/workflows/release.yml` içindeki `aur`
işi iki paketi de günceller: buradaki PKGBUILD'leri şablon alır, `pkgver`'i
etiketten yazar, `pkgrel=1`, özetleri (`updpkgsums`) ve `.SRCINFO`'yu yeniden
üretip AUR'a gönderir. `-bin` için `.deb` yüklendikten sonra çalışır.

Gerekli: repo secret'ı `AUR_SSH_PRIVATE_KEY`, açık anahtarı AUR hesabına
(My Account → SSH Public Key) eklenmiş özel bir anahtar. Secret yoksa iş
uyarı verip atlanır. PKGBUILD'de bağımlılık vb. değişince bu klasörü
düzenlemek yeterli; bir sonraki release'te AUR'a gider.

## Elle güncelleme (gerekirse)

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
