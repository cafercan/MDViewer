/**
 * YAML frontmatter desteği: belgenin en başındaki
 *
 *     ---
 *     date: 2026-10-07
 *     tags: [a, b]
 *     ---
 *
 * bloğunu marked'ın <hr> + setext <h2> olarak yorumlamasını engeller ve
 * anahtar/değer tablosu olarak gösterir. Tam bir YAML ayrıştırıcısı değildir:
 * üst düzey "anahtar: değer" satırlarını okur, girintili / "- öğe" devam
 * satırlarını bir önceki anahtarın değerine ekler.
 *
 * Token raw metni kaynağı birebir korur; düzenleme modundaki blok editörü
 * dosyayı token.raw'ları birleştirerek yeniden kurduğu için frontmatter
 * kaydederken bozulmaz.
 *
 * Hem tarayıcıda (global Frontmatter) hem Node'da (module.exports) kullanılabilir.
 */
(function (root) {
    'use strict';

    // Açılış "---", kapanış "---" veya "..."; gövde boş olabilir.
    var RE = /^﻿?---[ \t]*\n((?:[\s\S]*?\n)?)(?:---|\.\.\.)[ \t]*(?:\n|$)/;
    var KEY_RE = /^([A-Za-z0-9_][\w .-]*?)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function unquote(v) {
        var m = /^(["'])([\s\S]*)\1$/.exec(v);
        return m ? m[2] : v;
    }

    /**
     * Dizgenin BAŞINDAKİ frontmatter bloğunu ayrıştırır.
     * @returns {{raw, entries: Array<{key, value}>}|null}
     */
    function parse(src) {
        var m = RE.exec(src);
        if (!m) return null;

        var entries = [];
        var lines = m[1].split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line.trim() || /^\s*#/.test(line)) continue;
            var kv = /^\s/.test(line) || /^-(\s|$)/.test(line) ? null : KEY_RE.exec(line);
            if (kv) {
                entries.push({ key: kv[1], value: unquote((kv[2] || '').trim()) });
            } else if (entries.length) {
                var last = entries[entries.length - 1];
                var part = line.trim();
                last.value = last.value ? last.value + '\n' + part : part;
            } else {
                // İlk anlamlı satır anahtar değilse bu bir frontmatter değil
                // (ör. belge "---" çizgisiyle başlayıp setext başlıkla sürüyor).
                return null;
            }
        }
        return { raw: m[0], entries: entries };
    }

    function render(token) {
        if (!token.entries.length) return '';
        var rows = token.entries.map(function (e) {
            return '<tr><th>' + escapeHtml(e.key) + '</th><td>' +
                escapeHtml(e.value).replace(/\n/g, '<br>') + '</td></tr>';
        }).join('');
        return '<table class="frontmatter"><tbody>' + rows + '</tbody></table>\n';
    }

    /** marked.use({ extensions: [Frontmatter.extension()] }) */
    function extension() {
        return {
            name: 'frontmatter',
            level: 'block',
            tokenizer: function (src) {
                // Yalnız belgenin ilk token'ı olabilir.
                if (this.lexer && this.lexer.tokens && this.lexer.tokens.length) return undefined;
                var t = parse(src);
                if (!t) return undefined;
                return { type: 'frontmatter', raw: t.raw, entries: t.entries };
            },
            renderer: function (token) {
                return render(token);
            }
        };
    }

    var api = { parse: parse, render: render, extension: extension };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.Frontmatter = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
