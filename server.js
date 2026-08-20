const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTO_EXIT = process.env.MDVIEWER_AUTO_EXIT === '1';
const AUTO_EXIT_DELAY_MS = 3000;
let shutdownTimer = null;
let hasBrowserClient = false;

app.use(express.json());
// Serve static assets with no caching so code changes (app.js/style.css)
// always take effect on reload — this is a local dev/authoring tool.
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')
}));

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        app: 'MD Flow Viewer',
        port: Number(PORT)
    });
});

// Çalışma kökü: açılan ilk belgenin klasörü. Tüm dosya erişimi (oku/yaz/varlık/
// css/izle) bu alt ağaca hapsedilir. Böylece kötü niyetli bir .md dosyası, XSS
// ile bile olsa, kendi klasörü dışına (ör. C:\Windows, kullanıcı Belgeleri)
// okuma/yazma yapamaz. Kök, ilk isteğin `file` parametresinden bir kez belirlenir.
let workspaceRoot = null;

// Helper to resolve absolute or relative path
function getAbsolutePath(filePath) {
    if (!filePath) return null;
    const base = workspaceRoot || process.cwd();
    return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(base, filePath);
}

// İlk belge yolundan çalışma kökünü (bir kez) belirler.
function ensureWorkspaceRoot(filePath) {
    if (workspaceRoot || !filePath) return;
    const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(process.cwd(), filePath);
    workspaceRoot = path.dirname(abs);
}

// Verilen mutlak yol çalışma kökünün içinde mi? Kök henüz yoksa (nadir) izin ver.
function isWithinRoot(absolutePath) {
    if (!workspaceRoot) return true;
    const rel = path.relative(workspaceRoot, absolutePath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Yolu çözer + kök hapsini uygular. Dışarıdaysa null döner (403 için).
function resolveConfined(filePath) {
    const abs = getAbsolutePath(filePath);
    if (abs === null) return null;
    return isWithinRoot(abs) ? abs : false;
}

// Endpoint to list markdown files in the current folder
app.get('/api/files', async (req, res) => {
    try {
        const activeFile = req.query.file;
        ensureWorkspaceRoot(activeFile);
        // Listeleme her zaman çalışma kökü ile sınırlı: dışarıdaki dizinler
        // taranmaz.
        const targetDir = workspaceRoot || process.cwd();

        const dirFiles = await fs.promises.readdir(targetDir, { withFileTypes: true });
        const files = [];
        for (const file of dirFiles) {
            if (file.isFile() && (file.name.endsWith('.md') || file.name.endsWith('.markdown'))) {
                const filePath = path.join(targetDir, file.name);
                files.push({
                    name: file.name,
                    path: filePath,
                    relativePath: path.relative(process.cwd(), filePath)
                });
            }
        }
        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

async function getMarkdownFiles(dir, fileList = []) {
    const files = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const file of files) {
        const filePath = path.join(dir, file.name);
        // Skip node_modules and hidden folders
        if (file.name === 'node_modules' || file.name.startsWith('.')) continue;

        if (file.isDirectory()) {
            await getMarkdownFiles(filePath, fileList);
        } else if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
            fileList.push({
                name: file.name,
                path: filePath,
                relativePath: path.relative(process.cwd(), filePath)
            });
        }
    }
    return fileList;
}

// Endpoint to get content of a markdown file
app.get('/api/content', async (req, res) => {
    let filePath = req.query.file;
    ensureWorkspaceRoot(filePath);

    if (!filePath) {
        // Fallback to sample.md in process.cwd() or create it if not exists
        filePath = path.join(process.cwd(), 'sample.md');
        if (!fs.existsSync(filePath)) {
            // Create a default sample markdown if none exists
            await fs.promises.writeFile(filePath, `# Markdown Viewer Test

Hoş geldiniz! Bu, **Markdown Viewer** uygulamasıdır.

## Özellikler
1. Sol tarafta dinamik başlıklar (TOC)
2. Sağ üstte Düzenle / Oku görünümü toggle butonu
3. Mermaid diyagram desteği
4. Özel CSS kod gösterimleri
5. Dosya arka planda değiştiğinde otomatik yenileme (SSE)

\`\`\`mermaid
graph TD
    A[Dosyayı Değiştir] -->|fs.watch tetiklenir| B(Server-Sent Events)
    B -->|Otomatik Güncelleme| C[Tarayıcı Görünümü Yenilenir]
    C -->|Okuma veya Düzenleme| D[Kullanıcı Arayüzü]
    D -->|Düzenleme Kaydetme| A
\`\`\`

## Tablo Örneği
| Özellik | Destek Durumu |
| :--- | :---: |
| Markdown Raporlama | Evet |
| Mermaid Grafikleri | Evet |
| Canlı Takip | Evet |

## Özel Stil Örnekleri
Süslü bir alert kutusu:
:::info
Bu, özel bir CSS kutusudur. Custom CSS desteği ile bu tarz şablonlar oluşturabilirsiniz.
:::
`);
        }
    }

    const absolutePath = resolveConfined(filePath);
    if (absolutePath === false) {
        return res.status(403).json({ success: false, error: 'Erişim reddedildi: çalışma klasörü dışında.' });
    }
    if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ success: false, error: 'Dosya bulunamadı: ' + absolutePath });
    }

    try {
        const content = await fs.promises.readFile(absolutePath, 'utf-8');
        res.json({
            success: true,
            name: path.basename(absolutePath),
            path: absolutePath,
            content: content
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to serve a local asset (image, etc.) referenced from a markdown file.
// Markdown göreli yolları belgenin klasörüne göredir; istemci bunları mutlak
// yola çevirip buradan ister.
app.get('/api/asset', (req, res) => {
    const assetPath = req.query.file;
    if (!assetPath) {
        return res.status(400).json({ success: false, error: 'Varlık yolu belirtilmedi.' });
    }

    const absolutePath = resolveConfined(assetPath);
    if (absolutePath === false) {
        return res.status(403).json({ success: false, error: 'Erişim reddedildi: çalışma klasörü dışında.' });
    }
    let stat;
    try {
        stat = fs.statSync(absolutePath);
    } catch (error) {
        return res.status(404).json({ success: false, error: 'Varlık bulunamadı: ' + absolutePath });
    }
    if (!stat.isFile()) {
        return res.status(404).json({ success: false, error: 'Varlık bir dosya değil: ' + absolutePath });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(absolutePath, (error) => {
        if (error && !res.headersSent) {
            res.status(404).json({ success: false, error: error.message });
        }
    });
});

// Endpoint to read custom CSS file from local disk
app.get('/api/css', async (req, res) => {
    const cssPath = req.query.path;
    if (!cssPath) {
        return res.status(400).json({ success: false, error: 'CSS yolu belirtilmedi.' });
    }
    const absolutePath = resolveConfined(cssPath);
    if (absolutePath === false) {
        return res.status(403).json({ success: false, error: 'Erişim reddedildi: çalışma klasörü dışında.' });
    }
    if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ success: false, error: 'CSS dosyası bulunamadı: ' + absolutePath });
    }
    try {
        const cssContent = await fs.promises.readFile(absolutePath, 'utf-8');
        res.json({ success: true, css: cssContent });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to save markdown content back to the file
app.post('/api/save', async (req, res) => {
    const { path: filePath, content } = req.body;
    
    if (!filePath || content === undefined) {
        return res.status(400).json({ success: false, error: 'Eksik dosya yolu veya içerik.' });
    }

    const absolutePath = resolveConfined(filePath);
    if (absolutePath === false) {
        return res.status(403).json({ success: false, error: 'Erişim reddedildi: çalışma klasörü dışında.' });
    }
    try {
        await fs.promises.writeFile(absolutePath, content, 'utf-8');
        res.json({ success: true, message: 'Dosya başarıyla kaydedildi.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Store active watches to clean up on SSE disconnect
const activeWatches = new Map();

function scheduleAutoExit() {
    if (!AUTO_EXIT || !hasBrowserClient || activeWatches.size > 0) return;

    clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => {
        if (activeWatches.size === 0) {
            process.exit(0);
        }
    }, AUTO_EXIT_DELAY_MS);
}

// SSE Endpoint for file watching
app.get('/api/watch', (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
        return res.status(400).json({ error: 'İzlenecek dosya belirtilmedi.' });
    }

    ensureWorkspaceRoot(filePath);
    const absolutePath = resolveConfined(filePath);
    if (absolutePath === false) {
        return res.status(403).json({ error: 'Erişim reddedildi: çalışma klasörü dışında.' });
    }
    if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ error: 'İzlenecek dosya bulunamadı.' });
    }

    // SSE Setup headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    res.write('\n');

    let debounceTimer;
    hasBrowserClient = true;
    clearTimeout(shutdownTimer);
    
    // File Watcher
    const watcher = fs.watch(absolutePath, (eventType) => {
        if (eventType === 'change') {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                try {
                    res.write(`event: change\ndata: ${JSON.stringify({ file: absolutePath })}\n\n`);
                } catch (err) {
                    console.error('SSE Gönderim hatası:', err);
                }
            }, 150); // 150ms debounce
        }
    });

    const clientId = Date.now();
    activeWatches.set(clientId, watcher);

    // Clean up when client closes connection
    req.on('close', () => {
        const activeWatcher = activeWatches.get(clientId);
        if (activeWatcher) {
            activeWatcher.close();
            activeWatches.delete(clientId);
        }
        scheduleAutoExit();
    });
});

// Wildcard to serve public/index.html for client side routing if any.
// Dosya gibi görünen (uzantılı) istekler buraya düşerse gerçekten yok demektir;
// bunlara index.html dönmek görselleri sessizce bozar, o yüzden 404 veriyoruz.
app.get('*', (req, res) => {
    const requested = path.basename(req.path);
    if (path.extname(requested)) {
        return res.status(404).type('text/plain').send('Bulunamadı: ' + req.path);
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Yalnızca loopback'e bağlanıyoruz: /api/content ve /api/asset yerel disk
// dosyalarını servis ediyor, bunlar ağdaki başka makinelere açılmamalı.
app.listen(PORT, '127.0.0.1', () => {
    console.log(`Markdown Viewer sunucusu çalışıyor: http://127.0.0.1:${PORT}`);
});
