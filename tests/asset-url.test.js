// Çalıştır: node --test tests/*.test.js
// public/asset-url.js içindeki yol çözümleme mantığı (tarayıcı + Node ortak).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const AssetUrl = require(path.join(__dirname, '..', 'public', 'asset-url.js'));

const DOC = 'D:\\docs\\HOME.md';

test('resolveLocalPath: göreli yol belgenin klasörüne göre çözülür', () => {
    assert.equal(AssetUrl.resolveLocalPath('DOCS-MANIFEST.md', DOC), 'D:\\docs\\DOCS-MANIFEST.md');
    assert.equal(AssetUrl.resolveLocalPath('sub/README.md', DOC), 'D:\\docs\\sub\\README.md');
    assert.equal(AssetUrl.resolveLocalPath('../compliance/x.yml', DOC), 'D:\\compliance\\x.yml');
});

test('resolveLocalPath: %20 kodlaması açılır, mutlak yol aynen kalır', () => {
    assert.equal(AssetUrl.resolveLocalPath('a%20b.md', DOC), 'D:\\docs\\a b.md');
    assert.equal(AssetUrl.resolveLocalPath('C:/other/x.md', DOC), 'C:/other/x.md');
});

test('resolveLocalPath: şema, sayfa içi ve belge yokken null', () => {
    assert.equal(AssetUrl.resolveLocalPath('https://example.com/a.md', DOC), null);
    assert.equal(AssetUrl.resolveLocalPath('mailto:a@b.c', DOC), null);
    assert.equal(AssetUrl.resolveLocalPath('#baslik', DOC), null);
    assert.equal(AssetUrl.resolveLocalPath('x.md', ''), null);
});

test('classifyLink: türler', () => {
    assert.deepEqual(AssetUrl.classifyLink('#baslik', DOC), { kind: 'anchor', target: 'baslik' });
    assert.deepEqual(AssetUrl.classifyLink('https://example.com', DOC), { kind: 'external', target: 'https://example.com' });
    assert.deepEqual(AssetUrl.classifyLink('DOCS-MANIFEST.md', DOC), { kind: 'markdown', target: 'D:\\docs\\DOCS-MANIFEST.md' });
    assert.deepEqual(AssetUrl.classifyLink('sub/README.markdown#bolum', DOC), { kind: 'markdown', target: 'D:\\docs\\sub\\README.markdown', anchor: 'bolum' });
    assert.deepEqual(AssetUrl.classifyLink('../x/device-profile.yml', DOC), { kind: 'file', target: 'D:\\x\\device-profile.yml' });
});

test('classifyLink: belge yokken göreli bağlantı çözülemez', () => {
    assert.deepEqual(AssetUrl.classifyLink('x.md', ''), { kind: 'unresolved', target: 'x.md' });
});

test('resolveAssetUrl mevcut davranışı korur', () => {
    assert.equal(AssetUrl.resolveAssetUrl('img/a.svg', DOC), '/api/asset?file=' + encodeURIComponent('D:\\docs\\img\\a.svg'));
    assert.equal(AssetUrl.resolveAssetUrl('https://x/y.png', DOC), null);
});
