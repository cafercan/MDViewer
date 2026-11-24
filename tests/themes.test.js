// public/themes.js: tema kataloğu ve türetilen renkler.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const T = require(path.join(__dirname, '..', 'public', 'themes.js'));

test('kimlikler benzersiz, ek doğru, renkler geçerli', () => {
    const ids = T.list.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.length >= 55);
    for (const t of T.list) {
        assert.match(t.id, /^[a-z]+-(light|dark)$/);
        assert.equal(T.isDark(t.id), T.isDarkColor(t.bg), t.id);
        for (const k of ['bg', 'fg', 'ac', 'ac2']) assert.ok(T.isHex(t[k]), t.id + ' ' + k);
    }
});

test('her temada yazı, ikincil yazı, vurgu ve düğme yazısı okunur', () => {
    for (const t of T.list.filter((x) => x.kind === 'generated')) {
        const v = T.vars(t);
        assert.ok(T.contrast(t.fg, t.bg) >= 7, `${t.id} yazı ${T.contrast(t.fg, t.bg)}`);
        assert.ok(T.contrast(v['--text-secondary'], t.bg) >= 4.5, t.id + ' ikincil');
        assert.ok(T.contrast(v['--text-muted'], t.bg) >= 3, t.id + ' soluk');
        for (const k of ['ac', 'ac2']) assert.ok(T.contrast(t[k], t.bg) >= 3.5, `${t.id} ${k} ${T.contrast(t[k], t.bg)}`);
        assert.ok(T.contrast(v['--on-accent'], t.ac) >= 4.2, t.id + ' düğme');
    }
});

test('özel temalar süzülür, CSS sızdırmaz', () => {
    const ok = { id: 'custom-a1-dark', name: 'Benim', bg: '#101010', fg: '#eeeeee', ac: '#ff8800', ac2: '#00aaff' };
    const n = T.list.length;
    const mine = T.setCustom([ok, ok, { ...ok, id: 'custom-a2-dark', bg: 'red;}body{display:none' }, { ...ok, id: 'x"]{}-dark' }, null, 5]);
    assert.deepEqual(mine.map((t) => t.id), ['custom-a1-dark']);
    assert.equal(T.list.length, n + 1);
    assert.ok(T.cssText().includes('[data-theme="custom-a1-dark"]'));
    T.setCustom('bozuk');
    assert.equal(T.list.length, n);
});
