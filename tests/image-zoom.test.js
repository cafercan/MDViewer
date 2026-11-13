const test = require('node:test');
const assert = require('node:assert');
const ImageZoom = require('../public/image-zoom.js');

test('fitView büyük görseli küçültür ve ortalar', () => {
    const v = ImageZoom.fitView(2000, 1000, 1080, 680, 40);
    assert.strictEqual(v.scale, 0.5);
    assert.strictEqual(v.x, (1080 - 1000) / 2);
    assert.strictEqual(v.y, (680 - 500) / 2);
});

test('fitView küçük görseli büyütmez', () => {
    const v = ImageZoom.fitView(100, 50, 1000, 800);
    assert.strictEqual(v.scale, 1);
    assert.strictEqual(v.x, 450);
    assert.strictEqual(v.y, 375);
});

test('zoomAt imlecin altındaki noktayı yerinde tutar', () => {
    const view = { scale: 1, x: 100, y: 50 };
    const cx = 300;
    const cy = 200;
    const imgPoint = { x: (cx - view.x) / view.scale, y: (cy - view.y) / view.scale };
    const z = ImageZoom.zoomAt(view, 2, cx, cy);
    assert.strictEqual(z.scale, 2);
    assert.strictEqual(z.x + imgPoint.x * z.scale, cx);
    assert.strictEqual(z.y + imgPoint.y * z.scale, cy);
});

test('ölçek sınırların dışına çıkmaz', () => {
    assert.strictEqual(ImageZoom.zoomAt({ scale: 10, x: 0, y: 0 }, 100, 0, 0).scale, ImageZoom.MAX_SCALE);
    assert.strictEqual(ImageZoom.zoomAt({ scale: 0.1, x: 0, y: 0 }, 0.001, 0, 0).scale, ImageZoom.MIN_SCALE);
});
