/**
 * Büyük betikleri (Mermaid ~3 MB) gerektiğinde yükler.
 *
 * Hem tarayıcıda (global LazyScript) hem Node'da (module.exports) kullanılabilir.
 */
(function (root) {
    'use strict';
    // Arayüz dili (i18n.js); Node'da (testler) hep Türkçe.
    var T = root.I18N ? root.I18N.t
        : typeof require === 'function' ? require('./i18n.js').t : function (s) { return s; };

    var pending = {};

    /**
     * `src` için `load` yalnız bir kez çağrılır; eşzamanlı çağrılar aynı
     * Promise'i paylaşır. Yükleme başarısız olursa kayıt silinir, sonraki
     * çağrı yeniden dener.
     * @param {string} src
     * @param {function(string): Promise<void>} [load]  varsayılan: <script> ekle
     * @returns {Promise<void>}
     */
    function once(src, load) {
        if (!pending[src]) {
            pending[src] = Promise.resolve()
                .then(function () { return (load || injectScript)(src); })
                .catch(function (err) {
                    delete pending[src];
                    throw err;
                });
        }
        return pending[src];
    }

    function injectScript(src) {
        return new Promise(function (resolve, reject) {
            var el = document.createElement('script');
            el.src = src;
            el.onload = function () { resolve(); };
            el.onerror = function () {
                el.remove();
                reject(new Error(T('Betik yüklenemedi: {src}', { src: src })));
            };
            document.head.appendChild(el);
        });
    }

    var api = { once: once };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.LazyScript = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
