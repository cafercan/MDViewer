// Çalıştır: node --test tests/*.test.js
// public/i18n.js ve public/locales/*.js: arayüz dili.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');

/** Sayfadaki gibi yükler: seçili dil localStorage'dan gelir. */
function load(lang) {
    const ctx = vm.createContext({ Intl, localStorage: { getItem: () => lang, setItem() {} } });
    vm.runInContext(read('i18n.js'), ctx);
    for (const f of fs.readdirSync(path.join(pub, 'locales'))) vm.runInContext(read('locales/' + f), ctx);
    return ctx;
}

test('Node\'da ve varsayılan dilde Türkçe metin aynen döner', () => {
    const I = require(path.join(pub, 'i18n.js'));
    assert.equal(I.lang, 'tr');
    assert.equal(I.t('Kapat'), 'Kapat');
    assert.equal(I.t('{n} dk okuma', { n: 3 }), '3 dk okuma');
    assert.equal(load('tr').T('Kapat'), 'Kapat');
});

test('seçili dilin sözlüğü kullanılır, yer tutucular doldurulur', () => {
    const c = load('de');
    assert.equal(c.I18N.lang, 'de');
    assert.equal(c.T('Kapat'), 'Schließen');
    assert.equal(c.T('Yeni ad: {name}', { name: 'a.md' }), 'Neuer Name: a.md');
});

test('çoğul biçim sayıya göre seçilir', () => {
    const c = load('en');
    assert.equal(c.T('{w} kelime', { w: '1', n: 1 }), '1 word');
    assert.equal(c.T('{w} kelime', { w: '1,200', n: 1200 }), '1,200 words');
});

test('sözlükte olmayan metin İngilizceye, o da yoksa Türkçeye düşer', () => {
    const c = load('az');
    c.I18N.add('en', { 'Yalnız İngilizcede': 'English only' });
    assert.equal(c.T('Yalnız İngilizcede'), 'English only');
    assert.equal(c.T('Hiçbir sözlükte yok'), 'Hiçbir sözlükte yok');
});

test('bilinmeyen dil kodu Türkçeye döner', () => {
    assert.equal(load('xx').I18N.lang, 'tr');
});

test('her dil dosyası listede ve çevirilerde yer tutucular korunur', () => {
    const codes = Array.from(load('tr').I18N.languages, (l) => l.code).filter((c) => c !== 'tr');
    const files = fs.readdirSync(path.join(pub, 'locales')).map((f) => f.replace(/\.js$/, ''));
    assert.deepEqual(files.sort(), codes.slice().sort());
    const marks = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    for (const code of codes) {
        const dict = {};
        vm.runInContext(read(`locales/${code}.js`), vm.createContext({ I18N: { add: (_, d) => Object.assign(dict, d) } }));
        for (const [key, value] of Object.entries(dict)) {
            for (const v of typeof value === 'string' ? [value] : Object.values(value)) {
                assert.ok(marks(v).split(',').every((m) => !m || marks(key).includes(m)), `${code}: ${key} → ${v}`);
                if (typeof value === 'string') assert.equal(marks(v), marks(key), `${code}: ${key} → ${v}`);
            }
        }
    }
});
