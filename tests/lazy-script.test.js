// Çalıştır: node --test tests/*.test.js
// public/lazy-script.js: betiği gerektiğinde bir kez yükleme.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const LazyScript = require(path.join(__dirname, '..', 'public', 'lazy-script.js'));

test('eşzamanlı çağrılar betiği bir kez yükler', async () => {
    let calls = 0;
    const load = () => { calls++; return new Promise((r) => setTimeout(r, 10)); };
    await Promise.all([LazyScript.once('/a.js', load), LazyScript.once('/a.js', load)]);
    await LazyScript.once('/a.js', load);
    assert.equal(calls, 1);
});

test('hata sonrası yeniden dener', async () => {
    let calls = 0;
    const load = () => { calls++; return calls === 1 ? Promise.reject(new Error('ağ')) : Promise.resolve(); };
    await assert.rejects(LazyScript.once('/b.js', load));
    await LazyScript.once('/b.js', load);
    assert.equal(calls, 2);
});
