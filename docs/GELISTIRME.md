# Geliştirme

## Mimari

Arayüz saf web (HTML/CSS/JS), kabuk Rust (Tauri 2):

- **Frontend** — `public/` (marked, mermaid, highlight.js, DOMPurify). Çizilen
  HTML DOMPurify ile sanitize edilir, Mermaid `strict` modda ve yalnız diyagramlı
  belgede (ya da pencere boştayken) yüklenir. `public/bridge.js` uygulama
  komutlarına (`invoke`) köprüdür.
  Düzenleyici `public/live-editor.js`tir (CodeMirror 6); CodeMirror paketi
  `scripts/codemirror` içinde `npm ci && npm run build` ile yeniden üretilir.
- **Çekirdek** — `core/` (`mdflow-core`): Tauri'den bağımsız, birim testli
  mantık — ayar dosyası, kök hapsi ve gezgin, wikilink çözümü, satır sonu/BOM
  koruyan atomik belge okuma/yazma.
- **Kabuk** — `src-tauri/`: pencere, IPC komutları, belgeye göreli görseller
  için `mdasset://` protokolü, dosya izleyici (atomik kaydeden editörlere
  dayanıklı), gezinme koruması. Eşitleme kapalıyken ağ portu açılmaz; komutlar yalnız ana pencereye
  izinlidir (`src-tauri/capabilities/default.json`).

## Çalıştırma ve test

Gerekenler: Rust (stable), Node.js 22; Linux'ta `libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `librsvg2-dev`.

```bash
npm install
npx tauri dev                    # pencereyi kaynaktan aç
cargo test --workspace           # Rust testleri
node --test tests/*.test.js      # arayüz yardımcılarının testleri
```

Komut satırından belgeyle açmak için derlenmiş ikiliye yolu verin:
`mdflowviewer dosya.md`.

## Kaynaktan derleme (kurulum)

Sürüm tek yerden gelir: `src-tauri/tauri.conf.json` içindeki `version`.
Betikler exe'yi cargo'nun hedef klasöründen alır (`cargo metadata`), bu klasör
bir cargo ayarıyla repo dışına taşınmış olabilir.

```powershell
# Windows (Inno Setup 6 gerekir) -> dist\MDViewer-v<sürüm>.exe
.\scripts\build-installer.ps1
```

```bash
bash packaging/linux/build-deb.sh     # -> dist/mdflowviewer_<sürüm>_amd64.deb
bash packaging/linux/build-rpm.sh     # -> dist/mdflowviewer-<sürüm>-1.x86_64.rpm
bash packaging/macos/build-dmg.sh     # -> dist/MDViewer-v<sürüm>-macos-arm64.dmg
```

## Android paketi

APK uygulama içinden güncellenir. Şu an yerelde derlenip imzalanır ve release
oluşturulurken eklenir (`MDViewer-vX.Y.Z-android.apk`); iş akışı bunu
`SHA256SUMS.txt`'e katar:

```bash
npx tauri android build --apk --target aarch64 armv7
gh release create vX.Y.Z dist/MDViewer-vX.Y.Z-android.apk
```

Yayınlanan APK'lar hep **aynı anahtarla** imzalanmalıdır: farklı anahtarla imzalı
APK kurulu uygulamanın üstüne kurulamaz. Derlemeyi iş akışına bırakmak için bu
anahtar depoya Actions secret'ı olarak eklenir (yoksa APK adımı atlanır):
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`.

## Güvenlik modeli

- Eşitleme varsayılan kapalıdır. Açılınca bilgisayar 47823 (TCP/UDP) kapısını dinler ve yalnız özel ağ
  adreslerini (Tailscale'in 100.64/10 aralığı dahil) kabul eder. Eşleştirme kodu SPAKE2 ile doğrulanır (tek kullanım, 5 dk,
  5 deneme); sonrası Noise NNpsk0 (ChaCha20-Poly1305) ile şifrelidir. Anahtarlar `sync.json` içindedir, arayüze verilmez.

Yerel bir araç olsa da güvenilmeyen `.md` dosyalarına karşı sertleştirildi:
DOMPurify sanitizasyonu + Mermaid strict, eşitleme kapalıyken ağ portu yok, sıkı CSP, pencerenin
uygulama dışına gezinmesi engelli (dış bağlantılar sistem tarayıcısında açılır)
ve dosya komutlarında **kök hapsi** (belge klasörü dışına okuma/yazma reddedilir).
