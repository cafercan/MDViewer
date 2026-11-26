/**
 * Arayüz dili. Türkçe metnin kendisi anahtardır: kodda T('Dosya aç') yazılır,
 * Türkçede aynen döner, başka dilde locales/<kod>.js sözlüğünden gelir.
 * Sözlükte olmayan metin İngilizceye, o da yoksa Türkçeye düşer.
 *
 *   T('{n} not', { n: 3 })     yer tutucular {ad} biçimindedir
 *   sözlükte değer { one: '{n} note', other: '{n} notes' } olabilir (çoğul, vars.n'e göre)
 *
 * Seçilen dil localStorage'da tutulur (sayfa çizilmeden bilinsin diye) ve
 * ayar dosyasına da yazılır (settings.js). Dil değişince sayfa yeniden yüklenir.
 * index.html'deki sabit metinler i18n-page.js ile çevrilir.
 * Hem tarayıcıda (global I18N, T) hem Node'da (testler, hep Türkçe) çalışır.
 */
(function (root) {
    'use strict';

    var LANGS = [
        { code: 'tr', name: 'Türkçe', locale: 'tr' },
        { code: 'en', name: 'English', locale: 'en' },
        { code: 'az', name: 'Azərbaycanca', locale: 'az' },
        { code: 'de', name: 'Deutsch', locale: 'de' },
        { code: 'fr', name: 'Français', locale: 'fr' },
        { code: 'es', name: 'Español', locale: 'es' },
        { code: 'pt', name: 'Português', locale: 'pt-BR' },
        { code: 'ru', name: 'Русский', locale: 'ru' },
        { code: 'ja', name: '日本語', locale: 'ja' },
        { code: 'zh', name: '简体中文', locale: 'zh-CN' }
    ];
    var KEY = 'md_lang';
    var dicts = {};

    function known(code) {
        return LANGS.some(function (l) { return l.code === code; });
    }

    function stored() {
        try {
            var v = root.localStorage && root.localStorage.getItem(KEY);
            return known(v) ? v : 'tr';
        } catch (e) { return 'tr'; }
    }

    var lang = stored();
    var info = LANGS.filter(function (l) { return l.code === lang; })[0];

    function fill(s, vars) {
        if (!vars) return s;
        return s.replace(/\{(\w+)\}/g, function (m, k) {
            return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
        });
    }

    var plural = null;
    function pick(v, vars) {
        if (typeof v === 'string') return v;
        if (!v || typeof v !== 'object') return null;
        var n = vars && typeof vars.n === 'number' ? vars.n : 0;
        if (!plural && root.Intl && Intl.PluralRules) plural = new Intl.PluralRules(info.locale);
        var cat = plural ? plural.select(n) : (n === 1 ? 'one' : 'other');
        return v[cat] || v.other || null;
    }

    function lookup(key, code, vars) {
        var d = dicts[code];
        return d && Object.prototype.hasOwnProperty.call(d, key) ? pick(d[key], vars) : null;
    }

    function t(key, vars) {
        key = String(key);
        var s = lang === 'tr' ? null : (lookup(key, lang, vars) || lookup(key, 'en', vars));
        return fill(s == null ? key : s, vars);
    }

    /** Anahtar sözlükte var mı (sabit HTML çevirisi yalnız bilinen metne dokunur). */
    function has(key) {
        return lang !== 'tr' && (lookup(key, lang) != null || lookup(key, 'en') != null);
    }

    var ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];

    /** Sabit HTML'deki metinleri ve title/aria-label/placeholder/alt'ı çevirir. */
    function translateDom(el) {
        if (lang === 'tr' || !el) return;
        var doc = el.ownerDocument || root.document;
        var walker = doc.createTreeWalker(el, 1 | 4); // öğe + metin
        var node = el;
        while (node) {
            if (node.nodeType === 3) {
                var raw = node.nodeValue;
                var key = raw.trim();
                if (key && has(key)) node.nodeValue = raw.replace(key, t(key));
            } else if (node.nodeType === 1) {
                for (var i = 0; i < ATTRS.length; i++) {
                    var a = node.getAttribute(ATTRS[i]);
                    if (a && has(a.trim())) node.setAttribute(ATTRS[i], t(a.trim()));
                }
            }
            node = walker.nextNode();
        }
    }

    var api = {
        languages: LANGS,
        get lang() { return lang; },
        /** Intl/toLocaleString için yerel ayar kodu. */
        get locale() { return info.locale; },
        t: t,
        has: has,
        add: function (code, dict) { dicts[code] = Object.assign(dicts[code] || {}, dict); },
        translateDom: translateDom,
        /** Seçimi saklar; değiştiyse true döner (çağıran sayfayı yeniler). */
        setLang: function (code) {
            if (!known(code) || code === lang) return false;
            try { root.localStorage.setItem(KEY, code); } catch (e) { return false; }
            return true;
        }
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
        return;
    }
    root.I18N = api;
    root.T = t; // 't' kodda yerel değişken olarak çok geçiyor
    var doc = root.document;
    if (doc) {
        doc.documentElement.lang = lang;
        // Sözlük ayrıştırıcıyı bekleterek yüklenir: sonraki betikler hazır bulur.
        if (lang !== 'tr') {
            doc.write('<script src="locales/' + lang + '.js"><\/script>');
            if (lang !== 'en') doc.write('<script src="locales/en.js"><\/script>');
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
