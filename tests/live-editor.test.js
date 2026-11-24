const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = path.join(__dirname, '..', 'public');
const ctx = vm.createContext({ console, setTimeout, clearTimeout });
// Paket ve düzenleyici sayfa olmadan yüklenebilmeli
['vendor/codemirror/codemirror.min.js', 'live-editor.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(pub, f), 'utf8'), ctx, { filename: f });
});
const cells = (line) => Array.from(ctx.LiveEditor._cellRanges(line), ([a, b]) => line.slice(a, b).trim());

test('tablo satırı hücrelere bölünür', () => {
    assert.deepStrictEqual(cells('| a | **b** |'), ['a', '**b**']);
    assert.deepStrictEqual(cells('a | b'), ['a', 'b']);
});

test('kaçışlı dikey çizgi hücreyi bölmez', () => {
    assert.deepStrictEqual(cells('| b \\| c | 2 |'), ['b \\| c', '2']);
});

test('boş hücre yerini korur', () => {
    assert.deepStrictEqual(cells('| | x |'), ['', 'x']);
});
