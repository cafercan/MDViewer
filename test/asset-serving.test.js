/**
 * Markdown içinde göreli yolla verilen görsellerin (img/x.svg) görüntülenmesi.
 *
 * Çalıştırma:  node test/asset-serving.test.js
 *
 * Bağımlılık yok; sunucuyu boş bir portta ayağa kaldırıp HTTP ile doğrular.
 */

const assert = require('assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const resolveAssetUrl = require(path.join(ROOT, 'public', 'asset-url.js')).resolveAssetUrl;

let failures = 0;

function check(name, fn) {
    try {
        fn();
        console.log('  ok   ' + name);
    } catch (err) {
        failures++;
        console.log('  FAIL ' + name);
        console.log('       ' + err.message);
    }
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

function get(port, urlPath) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                type: res.headers['content-type'] || '',
                body: Buffer.concat(chunks)
            }));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('istek zaman aşımına uğradı')));
    });
}

async function waitForHealth(port, tries = 40) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await get(port, '/api/health');
            if (res.status === 200) return;
        } catch (_) { /* sunucu henüz ayakta değil */ }
        await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('sunucu ayağa kalkmadı');
}

async function main() {
    // --- Geçici çalışma alanı: doc/notes.md + doc/img/chart.svg ------------
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mdviewer-test-'));
    const docDir = path.join(work, 'doc');
    const imgDir = path.join(docDir, 'img');
    fs.mkdirSync(imgDir, { recursive: true });

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
    const svgPath = path.join(imgDir, 'chart.svg');
    fs.writeFileSync(svgPath, svg, 'utf-8');

    const pngPath = path.join(imgDir, 'boşluklu ad.png');
    fs.writeFileSync(pngPath, Buffer.from('89504e470d0a1a0a', 'hex'));

    const mdPath = path.join(docDir, 'notes.md');
    fs.writeFileSync(mdPath, '# Başlık\n\n![grafik](img/chart.svg)\n', 'utf-8');

    console.log('\nURL çözümleme (public/asset-url.js)');

    const win = 'D:\\proje\\doc\\notes.md';

    check('göreli yol markdown klasörüne göre çözülür', () => {
        assert.strictEqual(
            resolveAssetUrl('img/chart.svg', win),
            '/api/asset?file=' + encodeURIComponent('D:\\proje\\doc\\img\\chart.svg'));
    });

    check('üst klasöre çıkan yol (../) çözülür', () => {
        assert.strictEqual(
            resolveAssetUrl('../assets/logo.png', win),
            '/api/asset?file=' + encodeURIComponent('D:\\proje\\assets\\logo.png'));
    });

    check('markdown içindeki %20 kodlaması çözülür', () => {
        assert.strictEqual(
            resolveAssetUrl('img/bo%C5%9Fluklu%20ad.png', win),
            '/api/asset?file=' + encodeURIComponent('D:\\proje\\doc\\img\\boşluklu ad.png'));
    });

    check('http(s) adresleri değiştirilmez', () => {
        assert.strictEqual(resolveAssetUrl('https://example.com/a.png', win), null);
        assert.strictEqual(resolveAssetUrl('//cdn.example.com/a.png', win), null);
    });

    check('data: ve fragment değiştirilmez', () => {
        assert.strictEqual(resolveAssetUrl('data:image/png;base64,AAAA', win), null);
        assert.strictEqual(resolveAssetUrl('#bolum', win), null);
    });

    check('/api/ ile başlayan yol tekrar sarılmaz', () => {
        assert.strictEqual(resolveAssetUrl('/api/asset?file=x', win), null);
    });

    check('Windows mutlak yolu doğrudan kullanılır', () => {
        assert.strictEqual(
            resolveAssetUrl('D:\\baska\\yer\\a.png', win),
            '/api/asset?file=' + encodeURIComponent('D:\\baska\\yer\\a.png'));
    });

    check('POSIX mutlak yolu doğrudan kullanılır', () => {
        assert.strictEqual(
            resolveAssetUrl('/var/data/a.png', '/home/u/doc/notes.md'),
            '/api/asset?file=' + encodeURIComponent('/var/data/a.png'));
    });

    check('açık dosya yokken göreli yol dokunulmadan bırakılır', () => {
        assert.strictEqual(resolveAssetUrl('img/chart.svg', ''), null);
    });

    // --- Sunucu tarafı -----------------------------------------------------
    console.log('\nSunucu (server.js)');

    const port = await freePort();
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: Object.assign({}, process.env, { PORT: String(port), MDVIEWER_AUTO_EXIT: '' }),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const serverLog = [];
    child.stdout.on('data', (d) => serverLog.push(d.toString()));
    child.stderr.on('data', (d) => serverLog.push(d.toString()));

    try {
        await waitForHealth(port);

        const okRes = await get(port, '/api/asset?file=' + encodeURIComponent(svgPath));
        check('/api/asset SVG dosyasını doğru MIME ile döndürür', () => {
            assert.strictEqual(okRes.status, 200, 'status ' + okRes.status);
            assert.ok(/image\/svg\+xml/.test(okRes.type), 'content-type: ' + okRes.type);
            assert.strictEqual(okRes.body.toString('utf-8'), svg);
        });

        const spaceRes = await get(port, '/api/asset?file=' + encodeURIComponent(pngPath));
        check('/api/asset boşluklu/Türkçe dosya adını döndürür', () => {
            assert.strictEqual(spaceRes.status, 200, 'status ' + spaceRes.status);
            assert.ok(/image\/png/.test(spaceRes.type), 'content-type: ' + spaceRes.type);
        });

        const missing = await get(port, '/api/asset?file=' + encodeURIComponent(path.join(imgDir, 'yok.svg')));
        check('/api/asset olmayan dosya için 404 döndürür', () => {
            assert.strictEqual(missing.status, 404, 'status ' + missing.status);
        });

        const dirRes = await get(port, '/api/asset?file=' + encodeURIComponent(imgDir));
        check('/api/asset klasör isteğini reddeder', () => {
            assert.strictEqual(dirRes.status, 404, 'status ' + dirRes.status);
        });

        // Asıl hata: uzantılı bilinmeyen yol index.html ile 200 dönüyordu.
        const stray = await get(port, '/img/chart.svg');
        check('bilinmeyen varlık yolu index.html yerine 404 döndürür', () => {
            assert.strictEqual(stray.status, 404,
                'status ' + stray.status + ' content-type ' + stray.type);
            assert.ok(!/text\/html/.test(stray.type),
                'index.html döndü: ' + stray.body.toString('utf-8').slice(0, 60));
        });

        const spa = await get(port, '/herhangi/bir/rota');
        check('uzantısız rota hâlâ index.html döndürür', () => {
            assert.strictEqual(spa.status, 200, 'status ' + spa.status);
            assert.ok(/text\/html/.test(spa.type), 'content-type: ' + spa.type);
        });

        // Uçtan uca: markdown'ı sunucudan al -> marked ile derle -> img src'yi
        // resolveAssetUrl ile çöz -> o adresi iste. Tarayıcının yaptığı zincirin aynısı.
        const contentRes = await get(port, '/api/content?file=' + encodeURIComponent(mdPath));
        const markdown = JSON.parse(contentRes.body.toString('utf-8')).content;
        const { marked } = require(path.join(ROOT, 'node_modules', 'marked'));
        const html = marked.parse(markdown);
        const srcMatch = /<img[^>]+src="([^"]+)"/.exec(html);

        check('derlenen HTML göreli bir img src içeriyor', () => {
            assert.ok(srcMatch, 'img etiketi bulunamadı: ' + html);
            assert.strictEqual(srcMatch[1], 'img/chart.svg');
        });

        const rewritten = srcMatch ? resolveAssetUrl(srcMatch[1], mdPath) : null;
        const e2e = rewritten ? await get(port, rewritten) : null;
        check('uçtan uca: markdown -> HTML -> çözülmüş URL -> SVG içeriği', () => {
            assert.ok(rewritten, 'src yeniden yazılmadı');
            assert.strictEqual(e2e.status, 200, 'status ' + e2e.status);
            assert.ok(/image\/svg\+xml/.test(e2e.type), 'content-type: ' + e2e.type);
            assert.strictEqual(e2e.body.toString('utf-8'), svg);
        });

        const staticRes = await get(port, '/style.css');
        check('public/ altındaki statik dosyalar bozulmadı', () => {
            assert.strictEqual(staticRes.status, 200, 'status ' + staticRes.status);
            assert.ok(/text\/css/.test(staticRes.type), 'content-type: ' + staticRes.type);
        });
    } finally {
        child.kill();
        fs.rmSync(work, { recursive: true, force: true });
    }

    console.log('');
    if (failures) {
        console.log(failures + ' test başarısız.');
        if (serverLog.length) console.log('--- sunucu çıktısı ---\n' + serverLog.join(''));
        process.exit(1);
    }
    console.log('Tüm testler geçti.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
