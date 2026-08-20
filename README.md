# MD Flow Viewer

Windows için hızlı, yerel bir **Markdown görüntüleyici ve düzenleyici**. Dosyayı
diskte değiştirdiğinizde otomatik yenilenir (canlı takip), Mermaid diyagramlarını
ve kod vurgulamasını yerleşik olarak çizer, blok blok düzenlemeye izin verir.

`.md` / `.markdown` dosyalarına çift tıklayınca kendi penceresinde açılır.

![İkon](public/favicon-192.png)

## Özellikler

- 📄 Canlı önizleme + sol tarafta otomatik içindekiler (TOC)
- ✏️ Blok bazlı satır içi düzenleyici, otomatik kaydetme seçeneği
- 🔄 Dosya diskte değişince otomatik yenileme (Server-Sent Events)
- 🧜 Mermaid diyagramları, `highlight.js` kod vurgulama
- 🎨 Özel CSS / tema desteği, `:::info` `:::warning` `:::danger` kutuları
- 🖼️ Belgeye göreli yerel görselleri servis eder
- 🔒 Yalnızca `127.0.0.1` dinler; dosya erişimi açılan belgenin klasörüne hapsedilir

## Kurulum (kullanıcılar)

1. [Releases](https://github.com/cafercan/MDViewer/releases) sayfasından
   **`MDViewer-v1.0.0.exe`** kurulumunu indirin.
2. Çalıştırın. Kurulum klasörünü seçebilir, `Program Files`'a kurabilirsiniz.
3. Kurulumdan sonra bir `.md` dosyasına **sağ tıklayın → Birlikte Aç → MD Flow
   Viewer**. İsterseniz "Her zaman bu uygulamayı kullan" ile varsayılan yapabilirsiniz.

Kurulum **Ekle/Kaldır Programlar** listesinde **MDViewer** olarak görünür ve
temiz şekilde kaldırılabilir (dosya ilişkilendirmeleri dahil).

### Gereksinimler

- **Windows x64**
- **.NET 8 Masaüstü Çalışma Zamanı (Desktop Runtime x64)** — başlatıcı `.exe`
  buna bağlıdır. Kurulumda yoksa uyarı verir:
  <https://dotnet.microsoft.com/download/dotnet/8.0>
- Node.js gerekmez — taşınabilir `node.exe` kuruluma gömülüdür.

## Güvenlik modeli

Bu yerel bir araçtır; yine de güvenilmeyen `.md` dosyalarını açmaya karşı sertleştirildi:

- **HTML sanitizasyonu** — çizilen Markdown, DOM'a girmeden önce DOMPurify ile
  temizlenir; `<script>`, olay öznitelikleri (`onerror` vb.) ve `javascript:`
  bağlantıları düşürülür. Mermaid `strict` modunda çalışır.
- **Yerel ağ hapsi** — sunucu yalnızca `127.0.0.1` üzerinde dinler.
- **Dosya kökü hapsi** — `/api/content`, `/api/save`, `/api/asset`, `/api/css`,
  `/api/watch` yalnızca **açılan belgenin klasörü** ve alt ağacına erişebilir.
  Bu ağacın dışındaki her yol `403` ile reddedilir. Kötü niyetli bir belge, XSS
  ile bile olsa, sistemin başka yerlerine yazamaz/okuyamaz.

## Geliştirme / kaynaktan çalıştırma

```bash
npm install
npm start          # http://127.0.0.1:3000
npm test           # asset servis testleri
```

`run.bat` boş bir port seçip sunucuyu başlatır ve Edge'i uygulama modunda açar.

## Kaynaktan derleme (installer)

Başlatıcı `.exe` C# (WinForms, .NET 8) ile yazılmıştır ve depoda **tutulmaz**;
kurulumu yeniden üretmek için:

```bash
# 1) Başlatıcıyı derle (.NET 8 SDK gerekli)
dotnet publish src/MDFlowViewer/MDFlowViewer.csproj -c Release -o . 
#    -> MDFlowViewer.exe üretir

# 2) Staging klasörünü hazırla: exe + server.js + public + portable node.exe + express
#    (bkz. installer notları)

# 3) Inno Setup ile derle
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\MDFlowViewer.iss
#    -> dist\MDViewer-v1.0.0.exe
```

## Lisans

[MIT](LICENSE)
