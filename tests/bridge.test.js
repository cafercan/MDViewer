// Çalıştır: node --test tests/*.test.js
// public/bridge.js: dosya izleme dinleyicilerinin birbirine karışmaması.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

// Sahte Tauri: listen() bir tur gecikmeli çözülür (gerçekteki gibi async).
function loadBridge() {
    const listeners = new Set();
    const calls = [];
    const tauri = {
        core: {
            invoke: async (name, args) => { calls.push([name, args]); return { success: true }; },
            convertFileSrc: (p) => 'asset:' + p
        },
        event: {
            listen: (event, cb) => new Promise((resolve) => setTimeout(() => {
                const entry = { event, cb };
                listeners.add(entry);
                resolve(() => listeners.delete(entry));
            }, 5))
        }
    };
    const ctx = { __TAURI__: tauri };
    ctx.globalThis = ctx;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'bridge.js'), 'utf8'), ctx);
    const emit = (event, payload) => {
        for (const l of [...listeners]) if (l.event === event) l.cb({ payload });
    };
    return { native: ctx.MDFlowNative, emit, listeners, calls };
}

test('üst üste izlemede yalnız son dosyanın değişikliği iletilir', async () => {
    const { native, emit, listeners } = loadBridge();
    const seenA = [];
    const seenB = [];
    // app.js setupFileWatcher'ı beklemeden çağırabilir: iki izleme çakışır
    const pa = native.watch('C:\\d\\a.md', (d) => seenA.push(d.file));
    const pb = native.watch('C:\\d\\b.md', (d) => seenB.push(d.file));
    await Promise.all([pa, pb]);
    emit('file-changed', { file: 'C:\\d\\a.md' });
    emit('file-changed', { file: 'C:\\d\\b.md' });
    assert.deepEqual(seenA, []);
    assert.deepEqual(seenB, ['C:\\d\\b.md']);
    assert.equal([...listeners].filter((l) => l.event === 'file-changed').length, 1);
});

test('eski izlemenin stop() çağrısı yeni izlemeyi bozmaz', async () => {
    const { native, emit, calls } = loadBridge();
    const seen = [];
    const stopA = await native.watch('C:\\d\\a.md', () => {});
    await native.watch('C:\\d\\b.md', (d) => seen.push(d.file));
    stopA();
    emit('file-changed', { file: 'C:\\d\\b.md' });
    assert.deepEqual(seen, ['C:\\d\\b.md']);
    assert.equal(calls.filter(([n]) => n === 'unwatch_file').length, 0);
});
