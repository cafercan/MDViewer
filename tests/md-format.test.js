// Çalıştır: node --test tests/*.test.js
// public/md-format.js: biçim çubuğu, liste sürdürme ve görev kutuları.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(__dirname, '..', 'public', 'md-format.js'));

// "a|b|c" → metin + seçim; tek | imleç
function run(name, src) {
    const start = src.indexOf('|');
    let text = src.replace('|', '');
    const second = text.indexOf('|');
    const end = second < 0 ? start : second;
    text = text.replace('|', '');
    const r = F.apply(name, text, start, end);
    return r.start === r.end
        ? r.text.slice(0, r.start) + '|' + r.text.slice(r.start)
        : r.text.slice(0, r.start) + '|' + r.text.slice(r.start, r.end) + '|' + r.text.slice(r.end);
}

test('sarma ekler ve kaldırır', () => {
    assert.equal(run('bold', 'a |b| c'), 'a **|b|** c');
    assert.equal(run('bold', 'a **|b|** c'), 'a |b| c');
    assert.equal(run('italic', '**|b|**'), '***|b|***');
    assert.equal(run('italic', '***|b|***'), '**|b|**');
    assert.equal(run('italic', '*|b|*'), '|b|');
    assert.equal(run('bold', '|'), '**|**');
});

test('satır önekleri çevrilir ve birbirinin yerine geçer', () => {
    assert.equal(run('bullet', 'süt|'), '- süt|');
    assert.equal(run('bullet', '- süt|'), 'süt|');
    assert.equal(run('task', '- süt|'), '- [ ] süt|');
    assert.equal(run('bullet', '- [ ] süt|'), '- süt|');
    assert.equal(run('number', '|a\nb|'), '1. |a\n2. b|');
    assert.equal(run('quote', 'a|'), '> a|');
    assert.equal(run('outdent', '    - a|'), '- a|');
    assert.equal(run('outdent', '|    a'), '|a');
});

test('başlık döngüsü', () => {
    assert.equal(run('heading', 'a|'), '# a|');
    assert.equal(run('heading', '## a|'), '### a|');
    assert.equal(run('heading', '### a|'), 'a|');
});

test('bağlantılar ve kod', () => {
    assert.equal(run('link', '|'), '[|]()');
    assert.equal(run('link', '|ad|'), '[ad](|)');
    assert.equal(run('link', '|https://x.y|'), '[|](https://x.y)');
    assert.equal(run('wikilink', '|not|'), '[[not|]]');
    assert.equal(run('code', '|a\nb|'), '```\n|a\nb|\n```');
});

test('Enter listeyi sürdürür, boş maddede bitirir', () => {
    const nl = (t) => { const r = F.newline(t, t.length); return r && r.text; };
    assert.equal(nl('- a'), '- a\n- ');
    assert.equal(nl('  9. a'), '  9. a\n  10. ');
    assert.equal(nl('- [x] a'), '- [x] a\n- [ ] ');
    assert.equal(nl('- a\n- '), '- a\n');
    assert.equal(nl('düz yazı'), null);
    assert.equal(F.newline('- a', 0), null);
});

test('görev kutusu yalnız kendi satırını değiştirir', () => {
    const src = '- [ ] a\n```\n- [ ] kod\n```\n1. [x] b\n> - [ ] c\n';
    assert.equal(F.tasks(src).length, 3);
    assert.equal(F.toggleTask(src, 1, [false, true, false]), src.replace('[x] b', '[ ] b'));
    assert.equal(F.toggleTask(src, 2, [false, true, false]), src.replace('- [ ] c', '- [x] c'));
});

test('kaynakla uyuşmayan sayfada hiçbir şey değişmez', () => {
    assert.equal(F.toggleTask('- [ ] a\n', 0, [false, false]), null);
    assert.equal(F.toggleTask('- [ ] a\n', 0, [true]), null);
    assert.equal(F.toggleTask('- [ ] a\n', 3, [false]), null);
});
