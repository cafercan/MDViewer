# MD Flow Viewer — pywebview (Python) yeniden yazım tasarımı

Tarih: 2026-08-20
Durum: Onaylandı (implementasyon başlıyor)

## Amaç

Uygulamanın **arayüzü ve amacı aynı** kalacak. Değişen tek şey **kabuk**:
Edge `--app` yerine, **kendi penceresi olan** bir masaüstü uygulaması. Böylece:

- Görev çubuğu ikonu **%100 bizim** (`mdflow.ico`) — Edge/IE değil.
- Pencere kapanınca **süreç tamamen biter** — arka planda sunucu kalmaz.
- `.NET 8` ve `node.exe` bağımlılıkları ortadan kalkar.

## Mimari (3 katman)

### 1. Frontend — değişmez
`public/` aynen kalır: `index.html`, `app.js`, `style.css`,
`vendor/{marked,mermaid,highlight.js,dompurify}`. `fetch('/api/*')` sözleşmesi
korunduğu için frontend'e dokunulmaz. Güvenlik: DOMPurify sanitize + mermaid
`strict` (mevcut).

### 2. Backend — Python (Flask), `server.js`'in birebir karşılığı
`127.0.0.1` üzerinde rastgele boş portta, ayrı bir daemon thread'de çalışan
Flask (werkzeug `make_server(threaded=True)`). Uçlar `server.js` ile aynı:

| Uç | Davranış |
|----|----------|
| `GET /api/health` | `{success, app, port}` |
| `GET /api/files?file=` | Belgenin klasöründeki `.md/.markdown` listesi |
| `GET /api/content?file=` | Dosya içeriği; `file` yoksa `sample.md` |
| `GET /api/asset?file=` | Yerel görsel/varlık servis |
| `GET /api/css?path=` | Özel CSS oku |
| `POST /api/save` | `{path, content}` yaz |
| `GET /api/watch?file=` | SSE; dosya değişince `event: change` |
| statik | `public/` altındaki dosyalar |

**Güvenlik (server.js'ten taşınır):**
- Yalnızca `127.0.0.1` dinle (ağ dışına açılmaz).
- **Kök hapsi:** çalışma kökü = açılan ilk belgenin klasörü; tüm dosya erişimi
  bu alt ağaca hapsedilir, dışarısı `403`. Mutlak/`..` yollar çözülüp kontrol
  edilir.

**Dosya izleme:** SSE üreticisinde `mtime` yoklaması (~400ms). Ek bağımlılık
yok (watchdog gerekmez). Değişince `event: change` gönderir.

### 3. Kabuk — pywebview (WebView2 / EdgeChromium backend)
`main.py`:
1. Argümandan dosya yolunu al (`MDFlowViewer.exe "C:\dosya.md"`).
2. Boş port seç, Flask'i daemon thread'de başlat, `/api/health` ile hazır olmasını bekle.
3. `webview.create_window("MD Flow Viewer", url=".../?file=<abs>", width, height)`.
4. `webview.start()` (EdgeChromium). Pencere kapanınca `start()` döner → `sys.exit(0)`.

Pencere bizim olduğu için görev çubuğu ikonu PyInstaller `--icon=mdflow.ico`
ile gelen exe ikonudur. Kapanış = süreç sonu = sunucu ölümü (daemon thread).

## Paketleme
- **PyInstaller one-dir**, `--windowed --icon=public/mdflow.ico --name MDFlowViewer`.
- `public/` veri olarak gömülür (`--add-data`).
- Çıktı: `dist/MDFlowViewer/MDFlowViewer.exe` + `_internal/`. Kullanıcıya görünen
  tek exe `MDFlowViewer.exe`; `_internal` içinde `.pyd/.dll` var (exe değil →
  "Birlikte Aç" kirliliği yok, `NoOpenWith` hack'i gereksiz).
- Tek runtime bağımlılığı: **WebView2 Runtime** (Win11'de kurulu; installer'da
  yoksa uyarı/indirme linki).

## Installer (Inno Setup)
Mevcut `.iss` uyarlanır:
- Payload: `node.exe`/`node_modules`/`server.js` yerine PyInstaller `dist/MDFlowViewer/*`.
- `.md`/`.markdown` ilişkilendirme + sağ tık + `Applications\MDFlowViewer.exe` +
  Ekle/Kaldır girişi **aynen** (yollar `{app}\MDFlowViewer.exe`).
- `.NET 8` kontrolü → **WebView2 Runtime** kontrolüne dönüşür.
- `node.exe`/`unins` `NoOpenWith` kayıtları kaldırılır (artık node yok).
- Kurulum klasörü seçilebilir, Program Files'a kurar.

## Repo / sürüm
- Aynı repo `cafercan/MDViewer`. Node backend dosyaları (`server.js`,
  `package.json`, `package-lock.json`, `run.bat`, `launch-hidden.vbs`,
  `install.reg`, `register.bat`, `test/`) kaldırılır; git geçmişi v1'i korur.
- Yeni sürüm **v2.0.0** (v1.0.0 Node release'i durur).
- `.gitignore`: `.venv/`, `__pycache__/`, `*.spec`, `build/`, `dist/`.
- README Python kurulum/derleme ile güncellenir.

## Kabul kriterleri
1. `.md`'ye çift tık → kendi pencerede açılır; **görev çubuğunda `mdflow.ico`**.
2. Pencere kapanınca **arka planda süreç kalmaz** (ölçülür).
3. Canlı yenileme (SSE), oku/düzenle/kaydet, mermaid, TOC, özel CSS **çalışır**.
4. Kök hapsi: belge klasörü dışı okuma/yazma `403` (test edilir).
5. Installer: Program Files'a kurar, klasör seçilir, Ekle/Kaldır'da `MDViewer`,
   `.md` sağ tık/varsayılan atanabilir.
6. `.NET 8` / kullanıcı-Node gerekmez.

## Test planı
- Backend: port testleri — health, content(in/out→403), save(in/out→403),
  css/asset(out→403), files listesi, watch SSE değişiklik yayını.
- Kabuk: exe başlat → pencere ikon handle'ı, kapat → süreç bitti mi.
- Paket: PyInstaller exe bağımsız (venv dışı) çalışır mı.
