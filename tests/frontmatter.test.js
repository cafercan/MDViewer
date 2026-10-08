// Çalıştır: node --test tests/*.test.js
// public/frontmatter.js: belge başındaki YAML frontmatter'ın tabloya çevrilmesi.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Frontmatter = require(path.join(__dirname, '..', 'public', 'frontmatter.js'));
const { Marked } = require(path.join(__dirname, '..', 'public', 'vendor', 'marked', 'marked.umd.js'));

const DOC = '---\ndate: 2026-10-07\nstatus: open (rc.2)\ntags: [nss, hmi]\n---\n\n# Başlık\n';

function md() {
    return new Marked({ extensions: [Frontmatter.extension()] });
}

test('parse: anahtar/değer satırları', () => {
    assert.deepEqual(Frontmatter.parse(DOC).entries, [
        { key: 'date', value: '2026-10-07' },
        { key: 'status', value: 'open (rc.2)' },
        { key: 'tags', value: '[nss, hmi]' }
    ]);
    assert.equal(Frontmatter.parse(DOC).raw, '---\ndate: 2026-10-07\nstatus: open (rc.2)\ntags: [nss, hmi]\n---\n');
});

test('parse: blok liste, tırnak, yorum ve BOM', () => {
    const r = Frontmatter.parse('﻿---\ntitle: "A: b"\n# yorum\ntags:\n  - x\n  - y\n...\n');
    assert.deepEqual(r.entries, [{ key: 'title', value: 'A: b' }, { key: 'tags', value: '- x\n- y' }]);
    assert.deepEqual(Frontmatter.parse('---\n---\nmetin').entries, []);
});

test('parse: frontmatter olmayan girdiler', () => {
    assert.equal(Frontmatter.parse('---\nBaşlık\n---\n'), null);   // hr + setext başlık
    assert.equal(Frontmatter.parse('metin\n---\na: b\n---\n'), null);
    assert.equal(Frontmatter.parse('---\na: b\n'), null);           // kapanış yok
});

test('marked: tablo üretir, hr/h2 üretmez, değerler kaçışlanır', () => {
    const html = md().parse(DOC.replace('open (rc.2)', '<b>x</b>'));
    assert.match(html, /^<table class="frontmatter"><tbody><tr><th>date<\/th><td>2026-10-07<\/td><\/tr>/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<hr|<h2/);
    assert.match(html, /<h1>Başlık<\/h1>/);
});

test('marked: yalnız belgenin başında eşleşir, raw kaynağı korur', () => {
    const later = 'giriş\n\n---\na: b\n---\n';
    assert.doesNotMatch(md().parse(later), /frontmatter/);
    const tokens = md().lexer(DOC);
    assert.equal(tokens[0].type, 'frontmatter');
    assert.equal(tokens.map(t => t.raw).join(''), DOC);
});
