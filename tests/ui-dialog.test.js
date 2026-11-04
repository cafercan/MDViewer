// Çalıştır: node --test tests/*.test.js
// public/ui-dialog.js: uygulama içi onay/uyarı kutularının sırası ve sonuçları.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const UiDialog = require(path.join(__dirname, '..', 'public', 'ui-dialog.js'));

// Gösterilen kutuları kaydeden, elle yanıtlanan sahte görüntüleyici.
function fakeShow() {
    const shown = [];
    const show = (spec) => new Promise((resolve) => shown.push({ spec, answer: resolve }));
    return { shown, show };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('confirm kullanıcının yanıtını boolean olarak döndürür', async () => {
    const { shown, show } = fakeShow();
    const d = UiDialog.create(show);
    const p = d.confirm('Kapatılsın mı?', { okText: 'Kapat', cancelText: 'Vazgeç' });
    await tick();
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0].spec, { kind: 'confirm', message: 'Kapatılsın mı?', okText: 'Kapat', cancelText: 'Vazgeç' });
    shown[0].answer(false);
    assert.equal(await p, false);
});

test('varsayılan düğme metinleri Türkçe', async () => {
    const { shown, show } = fakeShow();
    const d = UiDialog.create(show);
    d.confirm('Emin misiniz?');
    d.alert('Bitti');
    await tick();
    assert.equal(shown[0].spec.okText, 'Evet');
    assert.equal(shown[0].spec.cancelText, 'Vazgeç');
    shown[0].answer(true);
    await tick();
    assert.deepEqual(shown[1].spec, { kind: 'alert', message: 'Bitti', okText: 'Tamam' });
});

test('kutular sırayla gösterilir: ikincisi birincisi kapanmadan açılmaz', async () => {
    const { shown, show } = fakeShow();
    const d = UiDialog.create(show);
    const first = d.confirm('bir');
    const second = d.alert('iki');
    await tick();
    assert.equal(shown.length, 1);
    shown[0].answer(true);
    assert.equal(await first, true);
    await tick();
    assert.equal(shown.length, 2);
    shown[1].answer(true);
    assert.equal(await second, undefined);
});

test('görüntüleyici hata verirse sıra kilitlenmez, confirm "hayır" sayılır', async () => {
    let calls = 0;
    const d = UiDialog.create(() => { calls++; return calls === 1 ? Promise.reject(new Error('dom')) : Promise.resolve(true); });
    assert.equal(await d.confirm('a'), false);
    assert.equal(await d.confirm('b'), true);
});
