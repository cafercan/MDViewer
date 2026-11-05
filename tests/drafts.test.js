// Çalıştır: node --test tests/*.test.js
// public/drafts.js: eski sürümlerin tarayıcı deposunda bıraktığı taslakların temizlenmesi.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Drafts = require(path.join(__dirname, '..', 'public', 'drafts.js'));

// window.localStorage benzeri: length, key(i), getItem, setItem, removeItem
function fakeStorage(entries) {
    const m = new Map(Object.entries(entries));
    return {
        get length() { return m.size; },
        key: (i) => [...m.keys()][i] ?? null,
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        keys: () => [...m.keys()]
    };
}

test('yalnız taslak anahtarlarını siler, diğerlerine dokunmaz', () => {
    const s = fakeStorage({
        'md_flow_draft:C:\\d\\a.md': '{"content":"x"}',
        'md_flow_draft:C:\\d\\b.md': '{"content":"y"}',
        'md_viewer_settings': '{"theme":"x"}'
    });
    assert.equal(Drafts.purgeLegacy(s), 2);
    assert.deepEqual(s.keys(), ['md_viewer_settings']);
});

test('taslak yoksa hiçbir şey silmez', () => {
    const s = fakeStorage({ 'md_viewer_settings': '{}' });
    assert.equal(Drafts.purgeLegacy(s), 0);
    assert.deepEqual(s.keys(), ['md_viewer_settings']);
});

test('anahtar listelemeyen yedek depoda (bellek içi) hata vermez', () => {
    const s = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    assert.equal(Drafts.purgeLegacy(s), 0);
});
