// Çalıştır: node --test tests/*.test.js
// public/doc-stats.js: kelime sayısı, okuma süresi, görev ilerlemesi.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'public', 'doc-stats.js'));

test('frontmatter, adres ve yorumlar sayılmaz', () => {
    const md = '---\ntitle: bir iki\n---\n# Şöyle bir başlık\n\n[metin](https://a.b/c) <!-- gizli not --> https://x.y/z Ankara\'da\n';
    assert.equal(S.count(md).words, 5);
});

test('boş belge sıfır dakika, kısa belge en az bir dakika', () => {
    assert.deepEqual(S.count(''), { words: 0, minutes: 0, tasks: 0, done: 0 });
    assert.equal(S.count('tek').minutes, 1);
    assert.equal(S.count('söz '.repeat(1000)).minutes, 5);
});

test('görevler özetin sonunda', () => {
    const s = S.count('bir iki', [{ checked: true }, { checked: false }]);
    assert.deepEqual(S.parts(s), ['2 kelime', '1 dk okuma', '1/2 görev']);
});
