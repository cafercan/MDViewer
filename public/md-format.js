/**
 * Markdown metin işlemleri (telefon biçim çubuğu ve dokunulabilir görev
 * kutuları; bkz. mobile.js). DOM'a dokunmaz: metin + seçim alır, yeni metin +
 * seçim döndürür. Hem tarayıcıda (global MdFormat) hem Node'da kullanılabilir.
 */
(function (root) {
    'use strict';

    var ITEM = /^(\s*(?:>\s?)*\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/;
    var TASK = /^(\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)+)\[([ xX])\](?=\s)/;
    var FENCE = /^\s*(?:>\s?)*\s*(?:(?:[-*+]|\d+[.)])\s+)*(`{3,}|~{3,})/;

    function lineStart(text, pos) { return text.lastIndexOf('\n', pos - 1) + 1; }
    function lineEnd(text, pos) {
        var i = text.indexOf('\n', pos);
        return i < 0 ? text.length : i;
    }

    /** Seçimi işaretle sarar (**kalın**); zaten sarılıysa kaldırır. */
    function wrap(s, mark) {
        var n = mark.length;
        var sel = s.text.slice(s.start, s.end);
        var before = s.text.slice(0, s.start);
        var after = s.text.slice(s.end);
        // '*' için '**' komşuluğu italik sayılmaz
        var c = mark.charAt(0);
        var outer = before.slice(-n) === mark && after.slice(0, n) === mark &&
            (n > 1 || (before.slice(-2, -1) !== c && after.charAt(1) !== c) ||
                (before.slice(-3) === c + c + c && after.slice(0, 3) === c + c + c));
        if (outer) {
            return { text: before.slice(0, -n) + sel + after.slice(n), start: s.start - n, end: s.end - n };
        }
        return { text: before + mark + sel + mark + after, start: s.start + n, end: s.end + n };
    }

    /** Seçimin değdiği satırlara fn(satır) uygular. */
    function mapLines(s, fn) {
        var a = lineStart(s.text, s.start);
        var b = lineEnd(s.text, s.end > s.start && s.text.charAt(s.end - 1) === '\n' ? s.end - 1 : s.end);
        var lines = s.text.slice(a, b).split('\n');
        var out = fn(lines);
        var text = s.text.slice(0, a) + out.join('\n') + s.text.slice(b);
        var grow = text.length - s.text.length;
        var end = Math.max(a, s.end + grow);
        var start = s.start === s.end ? end : Math.max(a, s.start + (out[0].length - lines[0].length));
        return { text: text, start: Math.min(start, end), end: end };
    }

    function prefix(s, make, has) {
        return mapLines(s, function (lines) {
            var all = lines.every(function (l) { return has.test(l); });
            var i = 0;
            return lines.map(function (l) {
                var m = /^(\s*)(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?(.*)$/.exec(l);
                return all ? m[1] + m[2] : m[1] + make(++i) + m[2];
            });
        });
    }

    var actions = {
        bold: function (s) { return wrap(s, '**'); },
        italic: function (s) { return wrap(s, '*'); },
        strike: function (s) { return wrap(s, '~~'); },
        code: function (s) {
            if (s.text.slice(s.start, s.end).indexOf('\n') < 0) return wrap(s, '`');
            var a = lineStart(s.text, s.start);
            var b = lineEnd(s.text, s.end);
            return {
                text: s.text.slice(0, a) + '```\n' + s.text.slice(a, b) + '\n```' + s.text.slice(b),
                start: a + 4, end: b + 4
            };
        },
        /** Başlık: yok → # → ## → ### → yok */
        heading: function (s) {
            return mapLines(s, function (lines) {
                return lines.map(function (l) {
                    var m = /^(#{1,6})\s+(.*)$/.exec(l);
                    if (!m) return '# ' + l;
                    return m[1].length >= 3 ? m[2] : m[1] + '# ' + m[2];
                });
            });
        },
        bullet: function (s) { return prefix(s, function () { return '- '; }, /^\s*[-*+]\s+(?!\[[ xX]\]\s)/); },
        number: function (s) { return prefix(s, function (i) { return i + '. '; }, /^\s*\d+[.)]\s+/); },
        task: function (s) { return prefix(s, function () { return '- [ ] '; }, /^\s*[-*+]\s+\[[ xX]\]\s+/); },
        quote: function (s) {
            return mapLines(s, function (lines) {
                var all = lines.every(function (l) { return /^>/.test(l); });
                return lines.map(function (l) { return all ? l.replace(/^>\s?/, '') : '> ' + l; });
            });
        },
        indent: function (s) {
            return mapLines(s, function (lines) { return lines.map(function (l) { return '    ' + l; }); });
        },
        outdent: function (s) {
            return mapLines(s, function (lines) { return lines.map(function (l) { return l.replace(/^(?: {1,4}|\t)/, ''); }); });
        },
        link: function (s) {
            var sel = s.text.slice(s.start, s.end);
            var isUrl = /^https?:\/\/\S+$/.test(sel);
            var out = isUrl ? '[](' + sel + ')' : '[' + sel + ']()';
            var at = isUrl || !sel ? s.start + 1 : s.start + out.length - 1;
            return { text: s.text.slice(0, s.start) + out + s.text.slice(s.end), start: at, end: at };
        },
        wikilink: function (s) {
            var sel = s.text.slice(s.start, s.end);
            var at = s.start + 2 + sel.length;
            return { text: s.text.slice(0, s.start) + '[[' + sel + ']]' + s.text.slice(s.end), start: at, end: at };
        }
    };

    function apply(name, text, start, end) {
        return actions[name]({ text: text, start: start, end: end });
    }

    /**
     * Enter: liste satırında maddeyi sürdürür, boş maddede listeyi bitirir.
     * Liste dışında null (normal satır sonu).
     */
    function newline(text, pos) {
        var a = lineStart(text, pos);
        var line = text.slice(a, lineEnd(text, pos));
        var m = ITEM.exec(line);
        if (!m || pos - a < m[0].length) return null;
        if (!line.slice(m[0].length).trim()) {
            return { text: text.slice(0, a) + m[1] + text.slice(a + line.length), start: a + m[1].length, end: a + m[1].length };
        }
        var mark = m[2] || (Number(m[3]) + 1) + m[4];
        var ins = '\n' + m[1] + mark + ' ' + (m[5] ? '[ ] ' : '');
        return { text: text.slice(0, pos) + ins + text.slice(pos), start: pos + ins.length, end: pos + ins.length };
    }

    /** Kaynaktaki görev maddeleri (kod blokları dışında): [{ at, checked }]. */
    function tasks(text) {
        var out = [];
        var at = 0;
        var fence = null;
        text.split('\n').forEach(function (line) {
            var f = FENCE.exec(line);
            if (fence) {
                if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length &&
                    !line.slice(f[0].length).trim()) fence = null;
            } else if (f) {
                fence = f[1];
            } else {
                var m = TASK.exec(line);
                if (m) out.push({ at: at + m[1].length + 1, checked: m[2] !== ' ' });
            }
            at += line.length + 1;
        });
        return out;
    }

    /**
     * Görünen kutulardan index'inci olanı çevirir. `shown`: sayfadaki kutuların
     * durumu (çevirmeden önce). Kaynakla birebir eşleşmiyorsa null — yanlış
     * satır değişmesin.
     */
    function toggleTask(text, index, shown) {
        var list = tasks(text);
        if (list.length !== shown.length || !list[index]) return null;
        for (var i = 0; i < list.length; i++) if (list[i].checked !== !!shown[i]) return null;
        var t = list[index];
        return text.slice(0, t.at) + (t.checked ? ' ' : 'x') + text.slice(t.at + 1);
    }

    var api = { apply: apply, newline: newline, tasks: tasks, toggleTask: toggleTask };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MdFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
