// Çalıştır: node --test tests/*.test.js
// public/updater.js: güncelleme akışının kararları.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Updater = require(path.join(__dirname, '..', 'public', 'updater.js'));

function setup(over = {}, native = {}) {
    const log = [];
    const deps = {
        native: {
            update_info: async () => ({ version: '3.1.0', auto: true }),
            update_check: async () => ({ success: true, version: '3.2.0', canInstall: true, ready: false, notes: 'N' }),
            update_download: async () => { log.push('download'); return { success: true }; },
            update_install: async (f) => { log.push('install ' + f); return { success: true }; },
            ...native,
        },
        view: (st) => log.push(st.phase),
        enabled: () => true, eager: true,
        prepare: async () => true, currentFile: () => 'a.md',
        openPage: (u) => log.push('page ' + u),
        snoozed: () => false, snooze: (v) => log.push('snooze ' + v),
        ...over,
    };
    return { log, u: Updater.create(deps) };
}

test('masaüstü: sessizce indirir, hazır der; düğme kurar', async () => {
    const { log, u } = setup();
    await u.check(false);
    assert.deepEqual(log, ['download', 'ready']);
    await u.apply();
    assert.deepEqual(log.slice(2), ['installing', 'install a.md']);
});

test('telefon: indirme kullanıcıyı bekler', async () => {
    const { log, u } = setup({ eager: false });
    await u.check(false);
    assert.deepEqual(log, ['available']);
    await u.apply();
    assert.deepEqual(log.slice(1), ['downloading', 'download', 'installing', 'install a.md']);
});

test('paketi olmayan kurulum indirme sayfasına gider', async () => {
    const { log, u } = setup({}, { update_check: async () => ({ success: true, version: '3.2.0', canInstall: false, notes: 'N' }) });
    await u.check(false);
    await u.apply();
    assert.deepEqual(log, ['available', 'page N']);
});

test('kendiliğinden denetimde hata ve "güncel" sessizdir, elle denetimde görünür', async () => {
    for (const [res, phase] of [[{ success: false, error: 'x' }, 'error'], [{ success: true, version: null }, 'latest']]) {
        const { log, u } = setup({}, { update_check: async () => res });
        await u.check(false);
        assert.deepEqual(log, []);
        await u.check(true);
        assert.deepEqual(log, ['checking', phase]);
    }
});

test('ertelenen sürüm yalnız elle denetimde gösterilir', async () => {
    const { log, u } = setup({ snoozed: () => true });
    await u.check(false);
    assert.deepEqual(log, []);
    await u.check(true);
    assert.equal(log.at(-1), 'ready');
});

test('kaydedilemeyen belge kurulumu durdurur', async () => {
    const { log, u } = setup({ prepare: async () => false });
    await u.check(false);
    await u.apply();
    assert.ok(!log.some((l) => l.startsWith('install ')));
});

test('kurulum hatası gösterilir ve yeniden denenebilir', async () => {
    let n = 0;
    const { log, u } = setup({}, { update_install: async () => (n++ ? { success: true } : { success: false, error: 'izin yok' }) });
    await u.check(false);
    await u.apply();
    assert.equal(log.at(-1), 'error');
    await u.apply();
    assert.equal(n, 2);
});

test('art arda basmak ikinci işi başlatmaz', async () => {
    const { log, u } = setup();
    await Promise.all([u.check(true), u.check(true)]);
    assert.equal(log.filter((l) => l === 'download').length, 1);
});
