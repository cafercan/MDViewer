/**
 * Obsidian tarzı wikilink desteği: [[not]], [[not|takma ad]], [[not#başlık]],
 * [[klasör/not]] ve ![[görsel.png]] gömmeleri.
 *
 * marked için inline eklenti üretir. Bağlantı hedefi burada çözülmez; HTML'e
 * data-wiki / data-wiki-anchor olarak yazılır, tıklamada app.js hedefi belgenin
 * klasöründe ve gezgin kökünde (vault) arar. href="#" olduğu için DOMPurify
 * öznitelikleri korur (data-* varsayılan olarak izinli).
 *
 * Hem tarayıcıda (global Wikilink) hem Node'da (module.exports) kullanılabilir.
 */
(function (root) {
    'use strict';

    // ![[ ... ]] veya [[ ... ]]; köşeli parantez ve satır sonu içeremez.
    var RE = /^(!?)\[\[([^\[\]\n]+?)\]\]/;
    var IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function basename(p) {
        return String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    }

    /**
     * Dizgenin BAŞINDAKİ wikilink'i ayrıştırır.
     * @returns {{raw, target, anchor, alias, embed}|null}
     */
    function parse(src) {
        var m = RE.exec(src);
        if (!m) return null;
        var inner = m[2];
        var alias = '';
        var pipe = inner.indexOf('|');
        if (pipe !== -1) {
            alias = inner.slice(pipe + 1).trim();
            inner = inner.slice(0, pipe);
        }
        var anchor = '';
        var hash = inner.indexOf('#');
        if (hash !== -1) {
            anchor = inner.slice(hash + 1).trim();
            inner = inner.slice(0, hash);
        }
        var target = inner.trim();
        if (!target) return null;
        return {
            raw: m[0],
            target: target,
            anchor: anchor,
            alias: alias || target,
            embed: m[1] === '!'
        };
    }

    function render(token) {
        if (token.embed && IMAGE_RE.test(token.target)) {
            return '<img src="' + escapeHtml(token.target) + '" alt="' +
                escapeHtml(basename(token.target)) + '" class="wikilink-embed">';
        }
        var cls = token.embed ? 'wikilink wikilink-embed' : 'wikilink';
        var html = '<a href="#" class="' + cls + '" data-wiki="' + escapeHtml(token.target) + '"';
        if (token.anchor) html += ' data-wiki-anchor="' + escapeHtml(token.anchor) + '"';
        html += '>' + escapeHtml(token.alias) + '</a>';
        return html;
    }

    /** marked.use({ extensions: [Wikilink.extension()] }) */
    function extension() {
        return {
            name: 'wikilink',
            level: 'inline',
            start: function (src) {
                var m = /!?\[\[/.exec(src);
                return m ? m.index : undefined;
            },
            tokenizer: function (src) {
                var t = parse(src);
                if (!t) return undefined;
                return {
                    type: 'wikilink',
                    raw: t.raw,
                    target: t.target,
                    anchor: t.anchor,
                    alias: t.alias,
                    embed: t.embed
                };
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
        root.Wikilink = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
