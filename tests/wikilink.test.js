// Çalıştır: node --test tests/*.test.js
// public/wikilink.js: Obsidian tarzı [[wikilink]] ayrıştırma ve HTML üretimi.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Wikilink = require(path.join(__dirname, '..', 'public', 'wikilink.js'));

test('parse: sade bağlantı', () => {
    assert.deepEqual(Wikilink.parse('[[vault-log-2026-07-09]] devam'), {
        raw: '[[vault-log-2026-07-09]]', target: 'vault-log-2026-07-09', anchor: '', alias: 'vault-log-2026-07-09', embed: false
    });
});

test('parse: takma ad, başlık ve klasör yolu', () => {
    assert.deepEqual(Wikilink.parse('[[planning/pilot|Pilot planı]]'), {
        raw: '[[planning/pilot|Pilot planı]]', target: 'planning/pilot', anchor: '', alias: 'Pilot planı', embed: false
    });
    assert.deepEqual(Wikilink.parse('[[HOME#Şu an]]'), {
        raw: '[[HOME#Şu an]]', target: 'HOME', anchor: 'Şu an', alias: 'HOME', embed: false
    });
    assert.deepEqual(Wikilink.parse('[[HOME#Şu an|buraya]]').alias, 'buraya');
});

test('parse: embed ve eşleşmeyen girdiler', () => {
    assert.equal(Wikilink.parse('![[sema.png]]').embed, true);
    assert.equal(Wikilink.parse('![[sema.png]]').target, 'sema.png');
    assert.equal(Wikilink.parse('[[]]'), null);
    assert.equal(Wikilink.parse('[[a\nb]]'), null);
    assert.equal(Wikilink.parse('[x](y)'), null);
    assert.equal(Wikilink.parse('metin [[a]]'), null);   // yalnız dizgenin başında eşleşir
});

test('render: bağlantı data-wiki taşır, HTML kaçışlanır', () => {
    const html = Wikilink.render(Wikilink.parse('[[a/b#c|<x> & y]]'));
    assert.equal(html, '<a href="#" class="wikilink" data-wiki="a/b" data-wiki-anchor="c">&lt;x&gt; &amp; y</a>');
});

test('render: görsel embed img, diğer embed bağlantı', () => {
    assert.equal(Wikilink.render(Wikilink.parse('![[img/sema.png]]')), '<img src="img/sema.png" alt="sema.png" class="wikilink-embed">');
    assert.equal(Wikilink.render(Wikilink.parse('![[not]]')), '<a href="#" class="wikilink wikilink-embed" data-wiki="not">not</a>');
});

test('extension: marked eklenti şekli', () => {
    const ext = Wikilink.extension();
    assert.equal(ext.name, 'wikilink');
    assert.equal(ext.level, 'inline');
    assert.equal(ext.start('abc [[x]]'), 4);
    assert.equal(ext.start('abc ![[x]]'), 4);
    assert.equal(ext.start('abc'), undefined);
    const tok = ext.tokenizer('[[x]] rest');
    assert.equal(tok.type, 'wikilink');
    assert.equal(tok.raw, '[[x]]');
    assert.equal(ext.tokenizer('düz'), undefined);
});
