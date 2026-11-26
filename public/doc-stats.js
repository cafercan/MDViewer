/**
 * Belge istatistiği: kelime, okuma süresi, görev ilerlemesi. DOM'a dokunmaz.
 * Hem tarayıcıda (global DocStats) hem Node'da kullanılabilir.
 */
(function (root) {
    'use strict';
    // Arayüz dili (i18n.js); Node'da (testler) hep Türkçe.
    var T = root.I18N ? root.I18N.t
        : typeof require === 'function' ? require('./i18n.js').t : function (s) { return s; };

    var WORDS_PER_MINUTE = 200;

    /** @param {Array<{checked: boolean}>} tasks  MdFormat.tasks çıktısı */
    function count(markdown, tasks) {
        var text = String(markdown)
            .replace(/^﻿?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '')  // frontmatter
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')                       // bağlantı adresleri
            .replace(/https?:\/\/\S+/g, ' ');
        var words = (text.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) || []).length;
        var list = tasks || [];
        return {
            words: words,
            minutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0,
            tasks: list.length,
            done: list.filter(function (t) { return t.checked; }).length
        };
    }

    function parts(s) {
        var locale = root.I18N ? root.I18N.locale : 'tr';
        var out = [T('{w} kelime', { w: s.words.toLocaleString(locale), n: s.words })];
        if (s.minutes) out.push(T('{n} dk okuma', { n: s.minutes }));
        if (s.tasks) out.push(T('{done}/{n} görev', { done: s.done, n: s.tasks }));
        return out;
    }

    var api = { count: count, parts: parts };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DocStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
