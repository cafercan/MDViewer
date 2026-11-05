/**
 * Eski sürümlerin (3.0.1'e kadar) tarayıcı deposunda bıraktığı taslakları temizler.
 *
 * O sürümler düzenlemeleri "md_flow_draft:<yol>" anahtarıyla saklayıp belge
 * açılınca "taslak geri yüklensin mi?" diye soruyordu. Kullanıcı taslağın
 * içeriğini görmeden karar veriyor, diskteki daha yeni hal ezilebiliyordu.
 * Özellik kaldırıldı; kalan taslaklar açılışta bir kez silinir.
 *
 * Hem tarayıcıda (global Drafts) hem Node'da (module.exports) kullanılabilir.
 */
(function (root) {
    'use strict';

    var PREFIX = 'md_flow_draft:';

    /** @returns {number} silinen taslak sayısı */
    function purgeLegacy(storage) {
        if (!storage || typeof storage.key !== 'function' || typeof storage.length !== 'number') return 0;
        var doomed = [];
        for (var i = 0; i < storage.length; i++) {
            var k = storage.key(i);
            if (typeof k === 'string' && k.indexOf(PREFIX) === 0) doomed.push(k);
        }
        doomed.forEach(function (k) { storage.removeItem(k); });
        return doomed.length;
    }

    var api = { purgeLegacy: purgeLegacy };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.Drafts = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
