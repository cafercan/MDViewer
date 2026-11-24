/**
 * marked eklentileri: GitHub/Obsidian bilgi kutuları ve ==vurgu==.
 *
 *   > [!NOTE]                 kutu (başlık türden gelir)
 *   > [!TIP] Kendi başlığım   kendi başlığıyla
 *   > [!WARNING]- Başlık      katlanır, kapalı başlar (+ ile açık)
 *
 * Kaynak metin (token.raw) değişmez: blok düzenleyici aynı satırları görür.
 * Hem tarayıcıda (global Callouts) hem Node'da kullanılabilir.
 */
(function (root) {
    'use strict';

    // tür -> [görünüm, Türkçe başlık]. Görünüm adı features.css'teki renktir.
    var TYPES = {
        note: ['note', 'Not'], info: ['note', 'Bilgi'], todo: ['note', 'Yapılacak'],
        abstract: ['note', 'Özet'], summary: ['note', 'Özet'], tldr: ['note', 'Özet'],
        tip: ['tip', 'İpucu'], hint: ['tip', 'İpucu'],
        success: ['tip', 'Tamam'], check: ['tip', 'Tamam'], done: ['tip', 'Tamam'],
        important: ['important', 'Önemli'], example: ['important', 'Örnek'],
        question: ['warning', 'Soru'], help: ['warning', 'Soru'], faq: ['warning', 'Soru'],
        warning: ['warning', 'Uyarı'], attention: ['warning', 'Uyarı'],
        caution: ['caution', 'Dikkat'], danger: ['caution', 'Tehlike'], error: ['caution', 'Hata'],
        bug: ['caution', 'Hata'], failure: ['caution', 'Başarısız'], fail: ['caution', 'Başarısız'],
        missing: ['caution', 'Eksik'],
        quote: ['quote', 'Alıntı'], cite: ['quote', 'Alıntı']
    };
    var ICONS = {
        note: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
        tip: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.7.6 1.2h6c0-.5.2-.9.6-1.2A6 6 0 0 0 12 3z"/>',
        important: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><path d="M12 7v4"/><path d="M12 14h.01"/>',
        warning: '<path d="M10.3 4 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
        caution: '<path d="M8 2.5h8L21.5 8v8L16 21.5H8L2.5 16V8z"/><path d="M12 7.5v5"/><path d="M12 16h.01"/>',
        quote: '<path d="M4 5v14"/><path d="M9 8h11"/><path d="M9 12h11"/><path d="M9 16h7"/>'
    };

    var BLOCK = /^ {0,3}>[^\n]*(?:\n {0,3}>[^\n]*)*/;
    var HEAD = /^\[!([A-Za-z]+)\]([+-]?)(?:[ \t]+([^\n]*))?(?:\n|$)/;

    /** Dizgenin BAŞINDAKİ kutuyu ayrıştırır; bilinmeyen tür sıradan alıntı kalır. */
    function parse(src) {
        var m = BLOCK.exec(src);
        if (!m) return null;
        var inner = m[0].replace(/^ {0,3}> ?/gm, '');
        var h = HEAD.exec(inner);
        var type = h && Object.prototype.hasOwnProperty.call(TYPES, h[1].toLowerCase()) && TYPES[h[1].toLowerCase()];
        if (!type) return null;
        return {
            raw: m[0], kind: type[0], fold: h[2],
            title: (h[3] || '').trim() || type[1],
            body: inner.slice(h[0].length)
        };
    }

    function calloutExtension() {
        return {
            name: 'callout',
            level: 'block',
            tokenizer: function (src) {
                var c = parse(src);
                if (!c) return undefined;
                return {
                    type: 'callout', raw: c.raw, kind: c.kind, fold: c.fold,
                    titleTokens: this.lexer.inline(c.title, []),
                    tokens: this.lexer.blockTokens(c.body, [])
                };
            },
            childTokens: ['titleTokens', 'tokens'],
            renderer: function (t) {
                var title = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
                    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[t.kind] + '</svg><span>' +
                    this.parser.parseInline(t.titleTokens) + '</span>';
                var body = '<div class="callout-body">' + this.parser.parse(t.tokens) + '</div>';
                var cls = 'class="callout callout-' + t.kind + '"';
                if (!t.fold) return '<div ' + cls + '><div class="callout-title">' + title + '</div>' + body + '</div>\n';
                return '<details ' + cls + (t.fold === '+' ? ' open' : '') + '><summary class="callout-title">' + title +
                    '</summary>' + body + '</details>\n';
            }
        };
    }

    // x==1 && y==2 gibi metinler vurgu sayılmasın: işaretin dışı harf/rakam olamaz.
    var MARK = /^==(?=[^\s=])([^\n]*?[^\s=])==(?![\p{L}\p{N}_=])/u;

    function markExtension() {
        return {
            name: 'highlight',
            level: 'inline',
            start: function (src) {
                var i = src.indexOf('==');
                return i < 0 ? undefined : i;
            },
            tokenizer: function (src, tokens) {
                var m = MARK.exec(src);
                if (!m) return undefined;
                var prev = tokens && tokens.length ? tokens[tokens.length - 1].raw : '';
                if (/[\p{L}\p{N}_=]$/u.test(prev)) return undefined;
                return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1], []) };
            },
            renderer: function (t) { return '<mark>' + this.parser.parseInline(t.tokens) + '</mark>'; }
        };
    }

    var api = { parse: parse, extensions: function () { return [calloutExtension(), markExtension()]; } };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Callouts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
