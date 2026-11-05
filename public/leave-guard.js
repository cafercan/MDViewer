/**
 * Başka belgeye geçerken "kaydedilmemiş değişiklikleriniz var" sorulmalı mı?
 *
 * Hem tarayıcıda (global LeaveGuard) hem Node'da (module.exports) kullanılabilir.
 */
(function (root) {
    'use strict';

    /**
     * @param {{isEditMode: boolean, blocksChanged: boolean, hasUnsavedChanges: boolean}} s
     *   blocksChanged     : düzenleyicideki bloklar belgeden farklı (yalnız düzenleme modunda anlamlı)
     *   hasUnsavedChanges : diske yazılmamış taslak var (düzenleme ya da geri yüklenmiş taslak)
     * @returns {boolean}
     */
    function mustAsk(s) {
        // Okuma modunda da sor: geri yüklenmiş bir taslak kaydedilmeden bırakılırsa
        // belgeye her dönüşte "taslak bulundu" sorusu tekrar gelir.
        return Boolean(s.hasUnsavedChanges || (s.isEditMode && s.blocksChanged));
    }

    var api = { mustAsk: mustAsk };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.LeaveGuard = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
