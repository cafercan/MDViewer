// Çalıştır: node --test tests/*.test.js
// public/leave-guard.js: başka belgeye geçerken "kaydedilmemiş değişiklik" sorulmalı mı.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const LeaveGuard = require(path.join(__dirname, '..', 'public', 'leave-guard.js'));

test('okuma modunda geri yüklenmiş (kaydedilmemiş) taslak varsa sorar', () => {
    // Hata: taslak okuma modunda geri yüklenince geçişte hiç sorulmuyor, taslak
    // kalıyor ve belgeye her dönüşte "taslak bulundu" sorusu tekrar geliyordu.
    assert.equal(LeaveGuard.mustAsk({ isEditMode: false, blocksChanged: false, hasUnsavedChanges: true }), true);
});

test('düzenleme modunda kaydedilmemiş değişiklik varsa sorar', () => {
    assert.equal(LeaveGuard.mustAsk({ isEditMode: true, blocksChanged: true, hasUnsavedChanges: false }), true);
    assert.equal(LeaveGuard.mustAsk({ isEditMode: true, blocksChanged: false, hasUnsavedChanges: true }), true);
});

test('kaydedilmemiş bir şey yoksa sormaz', () => {
    assert.equal(LeaveGuard.mustAsk({ isEditMode: false, blocksChanged: false, hasUnsavedChanges: false }), false);
    assert.equal(LeaveGuard.mustAsk({ isEditMode: true, blocksChanged: false, hasUnsavedChanges: false }), false);
});
