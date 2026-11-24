// Çalıştır: node --test tests/*.test.js
// public/callouts.js: > [!NOTE] kutuları ve ==vurgu==.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const pub = (f) => require(path.join(__dirname, '..', 'public', f));
const C = pub('callouts.js');
const { Marked } = pub('vendor/marked/marked.umd.js');
const M = new Marked({ extensions: C.extensions() });

test('tür, başlık ve katlama ayrıştırılır', () => {
    assert.deepEqual(C.parse('> [!note]\n> içerik\n\nson'), { raw: '> [!note]\n> içerik', kind: 'note', fold: '', title: 'Not', body: 'içerik' });
    const c = C.parse('> [!WARNING]- Dikkat et\n> a');
    assert.equal(c.fold, '-');
    assert.equal(c.title, 'Dikkat et');
});

test('bilinmeyen tür ve düz alıntı olduğu gibi kalır', () => {
    for (const s of ['> [!constructor]\n> x', '> [!foo]\n> x', '> düz', 'metin']) assert.equal(C.parse(s), null);
    assert.match(M.parse('> düz'), /<blockquote>/);
});

test('kutu içeriği markdown olarak çizilir', () => {
    const h = M.parse('> [!TIP] **Kalın**\n> - madde\n> - [ ] görev\n\nsonra');
    assert.match(h, /callout-tip/);
    assert.match(h, /<strong>Kalın<\/strong>/);
    assert.match(h, /type="checkbox"/);
    assert.match(h, /<p>sonra<\/p>/);
    assert.match(M.parse('> [!NOTE]- x\n> y'), /<details class="callout callout-note">/);
    assert.match(M.parse('> [!NOTE]+ x\n> y'), /<details [^>]* open>/);
});

test('kaynak metin token\'lardan birebir kurulur', () => {
    for (const src of ['# a\n\n> [!NOTE]\n> x\n\nson ==v== metin\n', '> [!TIP]\n> x\ndevam\n\n\n> y\n', 'p\n> [!TIP]\n> x']) {
        assert.equal(M.lexer(src).map((t) => t.raw).join(''), src);
    }
});

test('vurgu: kelime içi ve boşluklu == vurgu sayılmaz', () => {
    assert.match(M.parse('bu ==önemli **şey**== işte'), /<mark>önemli <strong>şey<\/strong><\/mark>/);
    for (const s of ['x==1 && y==2', 'a == b == c', '====', '`==kod==`', 'a ==b==c']) assert.doesNotMatch(M.parse(s), /<mark>/, s);
});
