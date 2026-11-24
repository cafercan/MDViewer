/**
 * Belge istatistiği: kelime, okuma süresi, görev ilerlemesi. DOM'a dokunmaz.
 * Hem tarayıcıda (global DocStats) hem Node'da kullanılabilir.
 */
(function (root) {
    'use strict';

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
        var out = [s.words.toLocaleString('tr') + ' kelime'];
        if (s.minutes) out.push(s.minutes + ' dk okuma');
        if (s.tasks) out.push(s.done + '/' + s.tasks + ' görev');
        return out;
    }

    var api = { count: count, parts: parts };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DocStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
