# MD Flow Viewer

Windows için hızlı, yerel bir **Markdown görüntüleyici ve düzenleyici**.
Dosyayı diskte değiştirdiğinizde otomatik yenilenir (canlı takip), Mermaid
diyagramlarını ve kod vurgulamasını yerleşik olarak çizer, blok blok düzenlemeye
izin verir.

`.md` / `.markdown` dosyalarına çift tıklayınca **kendi penceresinde** açılır —
kendi görev çubuğu ikonuyla, tarayıcı sekmesi gibi değil.

![İkon](public/favicon-192.png)

## Özellikler

- 📄 Canlı önizleme + sol tarafta otomatik içindekiler (TOC)
- ✏️ Blok bazlı satır içi düzenleyici, otomatik kaydetme
- 🔄 Dosya diskte değişince otomatik yenileme (SSE)
- 🧜 Mermaid diyagramları, `highlight.js` kod vurgulama
- 🎨 `:::info` `:::warning` `:::danger` kutuları
- 🖼️ Belgeye göreli yerel görselleri servis eder
- 🪟 **Kendi penceresi** (pywebview / WebView2) — kendi ikonu, kapanınca temiz çıkış
- 📂 Üst bardan **dosya aç** (Ctrl+O) — native seçici son açılan klasörde başlar
- 🔍 Üst barda sayfa içi arama: Enter/Shift+Enter veya mini oklarla sonraki/önceki (Ctrl+F)
- 🖨️ PDF olarak dışa aktarma (Ctrl+P) — çıktıda üst bar/kenar çubuğu yok
- 🔢 Satır numaraları (yalnızca düzenleme modu), üst bardan aç/kapa
- 🎨 5 tema (3 açık + 2 koyu) üst barda renk swatch'leriyle; varsayılan açık
- 🎚️ Tema ve satır no tercihi kalıcı (sonraki açılışlarda korunur)
- 🔒 Yalnızca `127.0.0.1` dinler; dosya erişimi açılan belgenin klasörüne hapsedilir

## Kurulum (kullanıcılar)

1. [Releases](https://github.com/cafercan/MDViewer/releases) sayfasından
   **`MDViewer-v2.3.1.exe`** kurulumunu indirin.
2. Çalıştırın. Kurulum klasörünü seçebilir, `Program Files`'a kurabilirsiniz.
3. Bir `.md` dosyasına **sağ tıklayın → Birlikte Aç → MD Flow Viewer**. İsterseniz
   "Her zaman bu uygulamayı kullan" ile varsayılan yapabilirsiniz.

Kurulum **Ekle/Kaldır Programlar** listesinde **MDViewer** olarak görünür ve
temiz kaldırılır (dosya ilişkilendirmeleri dahil).

### Gereksinim

- **Windows x64**
- **Microsoft Edge WebView2 Runtime** — Windows 11'de yerleşik gelir. Yoksa
  kurulum uyarır: <https://developer.microsoft.com/microsoft-edge/webview2/>
- Python veya Node.js **gerekmez** — uygulama tek exe olarak paketlidir.

## Mimari

Üç katman; arayüz saf web (HTML/CSS/JS), kabuk native:

- **Frontend** — `public/` (marked, mermaid, highlight.js, DOMPurify). Çizilen
  HTML DOMPurify ile sanitize edilir, Mermaid `strict` modda.
- **Backend** — `app/server.py`: `127.0.0.1`'de küçük Flask sunucusu; `/api/*`
  uçları (content, save, files, asset, settings, watch/SSE). Tüm dosya erişimi açılan
  belgenin klasörüne **hapsedilir** (path traversal `403`).
- **Kabuk** — `app/main.py`: pywebview ile kendi WebView2 penceresi. Native
  dosya seçici `JsApi` köprüsüyle açılır; seçilen belgenin klasörü yeni çalışma
  kökü olur. Pencere kapanınca süreç tamamen biter; arka planda sunucu kalmaz.

## Geliştirme

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app\main.py path\to\dosya.md
```

## Kaynaktan derleme (installer)

```powershell
# 1) Bağımlılıklar
.venv\Scripts\pip install -r requirements.txt

# 2) Tek exe (PyInstaller one-dir) -> dist\MDFlowViewer\
.\build.ps1

# 3) Inno Setup ile kurulum -> dist\MDViewer-v2.3.1.exe
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\MDFlowViewer.iss
```

## Güvenlik modeli

Yerel bir araç olsa da güvenilmeyen `.md` dosyalarına karşı sertleştirildi:
DOMPurify sanitizasyonu + Mermaid strict, yalnızca loopback dinleme, ve dosya
API'lerinde **kök hapsi** (belge klasörü dışına okuma/yazma reddedilir).

## Lisans

[MIT](LICENSE)
