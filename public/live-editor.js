/**
 * Canlı düzenleyici: belge tek parça yazılır, okuma görünümüne benzer çizilir.
 *
 * İmlecin olmadığı yerde markdown işaretleri (#, **, [](), …) gizlenir; imleç
 * değdiği satırda/öğede geri gelir. Tablo, diyagram, kutu ve ön bilgi (YAML)
 * çizilmiş durur; içine girilince kaynağı açılır. Metin hiç dönüştürülmez:
 * diske yazılan, düzenleyicideki metnin kendisidir.
 *
 * Temel: CodeMirror 6 (public/vendor/codemirror, kaynağı scripts/codemirror).
 */
(function (root) {
    'use strict';
    // Arayüz dili (i18n.js); Node'da (testler) hep Türkçe.
    var T = root.I18N ? root.I18N.t
        : typeof require === 'function' ? require('./i18n.js').t : function (s) { return s; };

    var CM = root.CM;
    var D = CM.Decoration;
    var doc = root.document;

    var view = null;
    var opts = null;
    var loading = false;          // belge yükleniyor: değişiklik sayılmaz
    var dragging = false;         // fareyle seçim sürerken satırlar yer değiştirmesin
    var refresh = CM.StateEffect.define();
    var setFind = CM.StateEffect.define();
    var setFocus = CM.StateEffect.define();
    var gutter = new CM.Compartment();
    var attrs = new CM.Compartment();
    var lineNumbersOn = false;
    var spell = false;

    // --- söz dizimi: [[not]] ve ==vurgu== ------------------------------------------
    var syntax = {
        defineNodes: ['Wikilink', 'WikiMark', 'Highlight', 'HighlightMark'],
        parseInline: [{
            name: 'Wikilink',
            before: 'Link',
            parse: function (cx, next, pos) {
                if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
                var m = /^\[\[([^\[\]\n]+)\]\]/.exec(cx.slice(pos, cx.end));
                if (!m) return -1;
                var end = pos + m[0].length;
                var bar = m[1].indexOf('|');
                var open = pos + 2 + (bar > 0 ? bar + 1 : 0);
                return cx.addElement(cx.elt('Wikilink', pos, end, [
                    cx.elt('WikiMark', pos, open), cx.elt('WikiMark', end - 2, end)
                ]));
            }
        }, {
            name: 'Highlight',
            parse: function (cx, next, pos) {
                if (next !== 61 || cx.char(pos + 1) !== 61) return -1;
                var m = /^==(?=\S)([^\n]*?\S)==/.exec(cx.slice(pos, cx.end));
                if (!m) return -1;
                var end = pos + m[0].length;
                return cx.addElement(cx.elt('Highlight', pos, end, [
                    cx.elt('HighlightMark', pos, pos + 2), cx.elt('HighlightMark', end - 2, end)
                ]));
            }
        }]
    };

    function tree(state) { return CM.ensureSyntaxTree(state, state.doc.length, 40) || CM.syntaxTree(state); }

    function touches(state, from, to) {
        if (!state.field(focusField)) return false;
        return state.selection.ranges.some(function (r) { return r.from <= to && r.to >= from; });
    }

    var focusField = CM.StateField.define({
        create: function () { return false; },
        update: function (v, tr) {
            tr.effects.forEach(function (e) { if (e.is(setFocus)) v = e.value; });
            return v;
        }
    });

    // --- çizilmiş bloklar ------------------------------------------------------------
    function Rendered(kind, src, from) { this.kind = kind; this.src = src; this.from = from; }
    Rendered.prototype = Object.create(CM.WidgetType.prototype);
    Rendered.prototype.eq = function (o) { return o.kind === this.kind && o.src === this.src; };
    Rendered.prototype.ignoreEvent = function () { return true; };
    Object.defineProperty(Rendered.prototype, 'estimatedHeight', {
        get: function () { return this.src.split('\n').length * 28; }
    });
    Rendered.prototype.toDOM = function (v) {
        var box = doc.createElement('div');
        box.className = 'lp-block lp-' + this.kind;
        opts.render(box, this.src);
        var src = this.src;
        if (this.kind === 'table') tableEditing(box, src, v);
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'lp-source';
        b.textContent = T('Kaynak');
        b.title = T('Markdown kaynağını düzenle');
        b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); enter(v, box); });
        box.appendChild(b);
        box.addEventListener('mousedown', function (e) { if (!e.target.closest('input, summary')) e.preventDefault(); });
        box.addEventListener('click', function (e) {
            if (e.target.closest('summary, input, button')) return;
            var a = e.target.closest('a[href]');
            if (a) {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) { opts.openLink(a); return; }
            }
            if (box.classList.contains('lp-table')) return;   // hücre kendi açılır
            enter(v, box);
        });
        // Görsel ve diyagram sonradan boy değiştirir
        if (root.ResizeObserver) {
            var ro = new ResizeObserver(function () { v.requestMeasure(); });
            ro.observe(box);
            box.lpRelease = function () { ro.disconnect(); };
        }
        return box;
    };
    Rendered.prototype.destroy = function (dom) { if (dom.lpRelease) dom.lpRelease(); };

    function enter(v, box) {
        var pos = v.posAtDOM(box);
        v.focus();
        v.dispatch({ selection: { anchor: pos }, effects: setFocus.of(true), scrollIntoView: true });
    }

    // Hücreye dokun, yaz, Tab ile ilerle. Hücrenin markdown'ı korunur.
    function cellRanges(line) {
        var out = [];
        var start = /^\s*\|?/.exec(line)[0].length;
        var i = start;
        for (; i < line.length; i++) {
            if (line.charAt(i) === '\\') { i++; continue; }
            if (line.charAt(i) === '|') { out.push([start, i]); start = i + 1; }
        }
        if (line.slice(start).trim()) out.push([start, line.length]);
        return out;
    }

    function tableEditing(box, src, v) {
        var lines = src.split('\n');
        var rows = Array.from(box.querySelectorAll('tr'));
        rows.forEach(function (tr, r) {
            var lineNo = r === 0 ? 0 : r + 1;
            Array.from(tr.children).forEach(function (cell, c) {
                cell.addEventListener('click', function (e) {
                    if (cell.querySelector('input')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    openCell(cell, lineNo, c, r);
                });
            });
        });

        function openCell(cell, lineNo, c, r) {
            var range = cellRanges(lines[lineNo] || '')[c];
            var old = range ? lines[lineNo].slice(range[0], range[1]).trim() : '';
            var html = cell.innerHTML;
            var input = doc.createElement('input');
            input.className = 'lp-cell';
            input.value = old.replace(/\\\|/g, '|');
            input.setAttribute('aria-label', T('Hücre'));
            cell.textContent = '';
            cell.appendChild(input);
            input.focus();
            var done = false;

            function finish(save, next) {
                if (done) return;
                done = true;
                var value = input.value.trim().replace(/\\?\|/g, '\\|');
                if (!save || value === old) {
                    cell.innerHTML = html;
                } else {
                    var line = lines[lineNo];
                    if (range) {
                        line = line.slice(0, range[0]) + ' ' + value + ' ' + line.slice(range[1]);
                    } else {
                        var have = cellRanges(line).length;
                        line = line.replace(/\s*\|?\s*$/, '') + ' |';
                        for (; have < c; have++) line += '  |';
                        line += ' ' + value + ' |';
                    }
                    var at = v.posAtDOM(box);
                    for (var i = 0; i < lineNo; i++) at += lines[i].length + 1;
                    // Kaynak bu arada değiştiyse dokunma
                    if (v.state.sliceDoc(at, at + lines[lineNo].length) !== lines[lineNo]) return;
                    v.dispatch({ changes: { from: at, to: at + lines[lineNo].length, insert: line }, userEvent: 'input' });
                }
                if (next) {
                    // Değişince tablo yeniden çizilir: yeni DOM'daki hücreye geç
                    var at0 = save && value !== old ? null : box;
                    root.requestAnimationFrame(function () {
                        var host = at0 || Array.from(v.dom.querySelectorAll('.lp-table')).find(function (t) { return t.lpMark === mark; });
                        openNext(host, r, c, next);
                    });
                }
            }
            var mark = box.lpMark;
            input.addEventListener('blur', function () { finish(true); });
            input.addEventListener('keydown', function (e) {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
                else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); }
                else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); finish(true); opts.save(); }
            });
        }
        box.lpMark = v.posAtDOM ? src.split('\n')[1] + rows.length : '';
    }

    function openNext(host, r, c, step) {
        if (!host) return;
        var cells = Array.from(host.querySelectorAll('th, td'));
        var row = host.querySelectorAll('tr')[r];
        if (!row) return;
        var next = cells[cells.indexOf(row.children[c]) + step];
        if (next) next.click();
    }

    var FRONT = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
    var BOX = /^:::(?:info|warning|danger)[ \t]*$/;

    /** Belgedeki çizilecek bloklar: [{from, to, kind}] (satır sınırlarında). */
    function blocksOf(state) {
        var out = [];
        var text = state.doc;
        var head = state.sliceDoc(0, Math.min(text.length, 20000));
        var fm = FRONT.exec(head);
        var fmEnd = 0;
        if (fm && fm[0].indexOf(':') > 0) {
            fmEnd = fm[0].replace(/\n$/, '').length;
            out.push({ from: 0, to: fmEnd, kind: 'front' });
        }
        // Kutular (:::info … :::) ayrıştırıcının bilmediği bir söz dizimi
        var open = 0;
        if (fmEnd || head.indexOf(':::') >= 0 || text.length > head.length) {
            var n = text.lines;
            for (var i = 1; i <= n; i++) {
                var l = text.line(i);
                if (l.from < fmEnd || l.length > 24 || l.text.charCodeAt(0) !== 58) continue;
                if (!open && BOX.test(l.text)) open = l.from + 1;
                else if (open && /^:::[ \t]*$/.test(l.text)) {
                    out.push({ from: open - 1, to: l.to, kind: 'box' });
                    open = 0;
                }
            }
        }
        function inside(pos) { return out.some(function (b) { return pos >= b.from && pos <= b.to; }); }
        var fixed = out.slice();
        tree(state).iterate({
            enter: function (n) {
                if (n.name === 'Document') return true;
                if (fixed.length && fixed.some(function (b) { return n.from >= b.from && n.from <= b.to; })) return false;
                var kind = null;
                if (n.name === 'Table') kind = 'table';
                else if (n.name === 'HTMLBlock') kind = /^\s*<!--/.test(state.sliceDoc(n.from, n.from + 40)) ? null : 'html';
                else if (n.name === 'FencedCode') {
                    if (/^\s*(?:`{3,}|~{3,})\s*mermaid\b/.test(text.lineAt(n.from).text)) kind = 'mermaid';
                } else if (n.name === 'Blockquote') {
                    if (root.Callouts && root.Callouts.parse(state.sliceDoc(n.from, n.to))) kind = 'callout';
                }
                // Yalnız en üst düzey: listedeki tablo kaynak olarak kalır
                if (kind && n.node.parent && n.node.parent.name === 'Document') {
                    out.push({ from: text.lineAt(n.from).from, to: text.lineAt(Math.max(n.from, n.to - (state.sliceDoc(n.to - 1, n.to) === '\n' ? 1 : 0))).to, kind: kind });
                }
                return false;
            }
        });
        out.sort(function (a, b) { return a.from - b.from; });
        return out.filter(function (b, i) { return i === 0 || b.from > out[i - 1].to; });
    }

    function drawBlocks(state) {
        var list = blocksOf(state);
        var deco = [];
        list.forEach(function (b) {
            b.open = touches(state, b.from, b.to);
            if (b.open || b.to <= b.from) return;
            deco.push(D.replace({ widget: new Rendered(b.kind, state.sliceDoc(b.from, b.to), b.from), block: true }).range(b.from, b.to));
        });
        return { list: list, deco: D.set(deco), key: key(state, list) };
    }
    function key(state, list) { return list.map(function (b) { return b.open ? 1 : 0; }).join(''); }

    var blockField = CM.StateField.define({
        create: drawBlocks,
        update: function (v, tr) {
            var forced = tr.effects.some(function (e) { return e.is(refresh) || e.is(setFocus); });
            var parsed = CM.syntaxTree(tr.state) !== CM.syntaxTree(tr.startState);
            if (tr.docChanged || parsed || forced) return drawBlocks(tr.state);
            if (tr.selection && !dragging) {
                var changed = v.list.some(function (b) { return !!b.open !== touches(tr.state, b.from, b.to); });
                if (changed) return drawBlocks(tr.state);
            }
            return v;
        },
        provide: function (f) { return CM.EditorView.decorations.from(f, function (v) { return v.deco; }); }
    });

    // --- satır içi küçük parçalar -----------------------------------------------------
    function Small(type, data) { this.type = type; this.data = data || ''; }
    Small.prototype = Object.create(CM.WidgetType.prototype);
    Small.prototype.eq = function (o) { return o.type === this.type && o.data === this.data; };
    Small.prototype.ignoreEvent = function () { return this.type === 'task'; };
    Small.prototype.toDOM = function (v) {
        var el;
        if (this.type === 'task') {
            el = doc.createElement('input');
            el.type = 'checkbox';
            el.className = 'lp-task';
            el.checked = this.data !== ' ';
            el.setAttribute('aria-label', T('Görev'));
            el.addEventListener('mousedown', function (e) { e.preventDefault(); });
            el.addEventListener('click', function (e) {
                e.preventDefault();
                var line = v.state.doc.lineAt(v.posAtDOM(el));
                var m = /\[([ xX])\]/.exec(line.text);
                if (!m) return;
                var at = line.from + m.index + 1;
                v.dispatch({ changes: { from: at, to: at + 1, insert: m[1] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
            });
            return el;
        }
        if (this.type === 'image') {
            el = doc.createElement('span');
            el.className = 'lp-image';
            opts.render(el, this.data);
            el.querySelectorAll('img').forEach(function (img) { img.addEventListener('load', function () { v.requestMeasure(); }); });
            return el;
        }
        el = doc.createElement('span');
        el.className = 'lp-' + this.type;
        if (this.type === 'bullet') el.textContent = '•';
        return el;
    };

    var HIDE = D.replace({});
    var MARKS = {
        StrongEmphasis: D.mark({ class: 'lp-strong' }),
        Emphasis: D.mark({ class: 'lp-em' }),
        Strikethrough: D.mark({ class: 'lp-strike' }),
        InlineCode: D.mark({ class: 'lp-code' }),
        Highlight: D.mark({ class: 'lp-mark' })
    };
    var SYNTAX = D.mark({ class: 'lp-syntax' });
    var QUIET = /^(?:EmphasisMark|StrikethroughMark|CodeMark|HighlightMark|WikiMark)$/;

    function lineClass(cls, style) {
        var spec = { class: cls };
        if (style) spec.attributes = { style: style };
        return D.line(spec);
    }

    /** Görünen satırların biçimi. */
    function drawInline(v) {
        var state = v.state;
        var text = state.doc;
        var blocks = state.field(blockField).list;
        var focused = state.field(focusField);
        var out = [];
        var lists = {};          // satır no -> {depth, first}

        function blockAt(pos) {
            for (var i = 0; i < blocks.length; i++) if (pos >= blocks[i].from && pos <= blocks[i].to) return blocks[i];
            return null;
        }
        function lineTouched(from, to) {
            return focused && touches(state, text.lineAt(from).from, text.lineAt(to === undefined ? from : to).to);
        }
        function hide(from, to) { if (to > from) out.push(HIDE.range(from, to)); }

        v.visibleRanges.forEach(function (vr) {
            var pos = vr.from;
            while (pos <= vr.to) {
                var line = text.lineAt(pos);
                var b = blockAt(line.from);
                if (b) out.push(lineClass('lp-raw').range(line.from));
                else if (!line.text.trim()) {
                    var prev = line.number > 1 ? text.line(line.number - 1).text : '';
                    if (prev.trim() && line.number < text.lines) out.push(lineClass(/^#{1,6}\s/.test(prev) ? 'lp-gap lp-gap-h' : 'lp-gap').range(line.from));
                }
                pos = line.to + 1;
            }

            tree(state).iterate({
                from: vr.from, to: vr.to,
                enter: function (n) {
                    var name = n.name;
                    if (name === 'Document') return true;
                    var b = blockAt(n.from);
                    if (b && n.to <= b.to + 1) return false;

                    var h = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
                    if (h) {
                        var tight = text.lineAt(n.from).number < text.lines && text.line(text.lineAt(n.from).number + 1).text.trim();
                        var first = text.lineAt(n.from).number === 1;
                        for (var hp = n.from; hp <= n.to;) {
                            var hl = text.lineAt(hp);
                            out.push(lineClass('lp-h lp-h' + h[1] + (tight ? ' lp-h-tight' : '') + (first ? ' lp-first' : '')).range(hl.from));
                            hp = hl.to + 1;
                        }
                        return true;
                    }
                    if (name === 'HeaderMark') {
                        if (/^Setext/.test(n.node.parent.name)) { out.push(SYNTAX.range(n.from, n.to)); return false; }
                        if (lineTouched(n.from)) out.push(SYNTAX.range(n.from, n.to));
                        else {
                            var line = text.lineAt(n.from);
                            var lead = n.from - line.from < 4 && !state.sliceDoc(line.from, n.from).trim();
                            hide(n.from, lead ? Math.min(line.to, n.to + (/\s/.test(state.sliceDoc(n.to, n.to + 1)) ? 1 : 0)) : n.to);
                        }
                        return false;
                    }
                    if (MARKS[name]) {
                        out.push(MARKS[name].range(n.from, n.to));
                        return true;
                    }
                    if (QUIET.test(name)) {
                        var p = n.node.parent;
                        if (p.name === 'FencedCode') return false;
                        if (touches(state, p.from, p.to)) out.push(SYNTAX.range(n.from, n.to));
                        else hide(n.from, n.to);
                        return false;
                    }
                    if (name === 'Wikilink') {
                        out.push(D.mark({ class: 'lp-link', attributes: { 'data-wiki-src': state.sliceDoc(n.from + 2, n.to - 2) } }).range(n.from, n.to));
                        return true;
                    }
                    if (name === 'Image') {
                        if (touches(state, n.from, n.to) || text.lineAt(n.from).to < n.to) out.push(SYNTAX.range(n.from, n.to));
                        else out.push(D.replace({ widget: new Small('image', state.sliceDoc(n.from, n.to)) }).range(n.from, n.to));
                        return false;
                    }
                    if (name === 'Link') {
                        var url = n.node.getChild('URL');
                        if (!url) return true;
                        var href = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '');
                        var marks = n.node.getChildren('LinkMark');
                        out.push(D.mark({ class: 'lp-link', attributes: { 'data-href': href, title: href + ' · ' + T('Ctrl+tık') } }).range(n.from, n.to));
                        if (marks.length >= 2 && text.lineAt(n.from).to >= n.to) {
                            if (touches(state, n.from, n.to)) {
                                out.push(SYNTAX.range(marks[0].from, marks[0].to));
                                out.push(SYNTAX.range(marks[1].from, n.to));
                            } else if (marks[1].from > marks[0].to) {
                                hide(marks[0].from, marks[0].to);
                                hide(marks[1].from, n.to);
                            }
                        }
                        // İçindeki **kalın** vb. için çocuklara in; bağlantı işaretleri aşağıda atlanır
                        return true;
                    }
                    if (name === 'URL' && n.node.parent.name !== 'Link' && n.node.parent.name !== 'Image') {
                        var u = state.sliceDoc(n.from, n.to);
                        out.push(D.mark({ class: 'lp-link', attributes: { 'data-href': u } }).range(n.from, n.to));
                        return false;
                    }
                    if (name === 'HorizontalRule') {
                        if (lineTouched(n.from)) out.push(SYNTAX.range(n.from, n.to));
                        else out.push(D.replace({ widget: new Small('hr') }).range(n.from, n.to));
                        return false;
                    }
                    if (name === 'FencedCode' || name === 'CodeBlock') {
                        drawCode(n, name === 'FencedCode');
                        return false;
                    }
                    if (name === 'Blockquote') {
                        for (var q = n.from; q <= n.to;) {
                            var ql = text.lineAt(q);
                            var edge = (ql.from <= n.from ? ' lp-quote-a' : '') + (ql.to >= n.to ? ' lp-quote-b' : '');
                            out.push(lineClass('lp-quote' + edge).range(ql.from));
                            q = ql.to + 1;
                        }
                        return true;
                    }
                    if (name === 'QuoteMark') {
                        if (lineTouched(n.from)) out.push(SYNTAX.range(n.from, n.to));
                        else hide(n.from, n.to + (state.sliceDoc(n.to, n.to + 1) === ' ' ? 1 : 0));
                        return false;
                    }
                    if (name === 'ListItem') {
                        var depth = 0;
                        for (var pp = n.node.parent; pp; pp = pp.parent) if (pp.name === 'ListItem') depth++;
                        var startNo = text.lineAt(n.from).number;
                        var endNo = text.lineAt(n.to).number;
                        for (var no = startNo; no <= endNo; no++) lists[no] = { depth: depth + 1, first: no === startNo };
                        return true;
                    }
                    if (name === 'ListMark') {
                        var ll = text.lineAt(n.from);
                        var before = state.sliceDoc(ll.from, n.from);
                        if (!before.trim()) hide(ll.from, n.from);
                        var after = /^[ \t]+(\[[ xX]\](?=\s))?/.exec(state.sliceDoc(n.to, Math.min(ll.to, n.to + 12)));
                        var ordered = n.node.parent.parent && n.node.parent.parent.name === 'OrderedList';
                        var taskEnd = after && after[1] ? n.to + after[0].length : 0;
                        var gapEnd = n.to + (after ? (after[1] ? after[0].length + 1 : after[0].length) : 0);
                        gapEnd = Math.min(gapEnd, ll.to);
                        var inMark = focused && state.selection.ranges.some(function (r) { return r.from < gapEnd && r.to >= n.from; });
                        if (taskEnd && !inMark) {
                            out.push(D.replace({ widget: new Small('task', state.sliceDoc(taskEnd - 2, taskEnd - 1)) }).range(n.from, gapEnd));
                            if (/x/i.test(state.sliceDoc(taskEnd - 2, taskEnd - 1)) && ll.to > gapEnd) out.push(D.mark({ class: 'lp-done' }).range(gapEnd, ll.to));
                        } else if (!ordered && !inMark && gapEnd > n.to) {
                            out.push(D.replace({ widget: new Small('bullet') }).range(n.from, gapEnd));
                        } else if (gapEnd > n.from) {
                            out.push(D.mark({ class: 'lp-marker' }).range(n.from, gapEnd));
                        }
                        return false;
                    }
                    if (name === 'HTMLTag' || name === 'Comment' || name === 'CommentBlock' || name === 'Escape' && false) {
                        out.push(SYNTAX.range(n.from, n.to));
                        return false;
                    }
                    return true;
                }
            });
        });

        Object.keys(lists).forEach(function (k) {
            var no = Number(k);
            var line = text.line(no);
            if (line.from > v.viewport.to || line.to < v.viewport.from || !line.text.trim()) return;
            var info = lists[no];
            var last = no >= text.lines || !text.line(no + 1).text.trim();
            out.push(lineClass('lp-li' + (info.first ? ' lp-li-first' : '') + (last ? ' lp-li-last' : ''), '--lp-depth:' + info.depth).range(line.from));
            if (!info.first) {
                var lead = /^[ \t]+/.exec(line.text);
                if (lead && !blockAt(line.from)) hide(line.from, line.from + lead[0].length);
            }
        });

        function drawCode(n, fenced) {
            var a = text.lineAt(n.from);
            var z = text.lineAt(n.to);
            var info = fenced ? n.node.getChild('CodeInfo') : null;
            var lang = info ? state.sliceDoc(info.from, info.to).split(/[\s{]/)[0] : '';
            var open = touches(state, a.from, z.to);
            var marks = fenced ? n.node.getChildren('CodeMark') : [];
            var closed = marks.length > 1;
            for (var no = a.number; no <= z.number; no++) {
                var l = text.line(no);
                var cls = 'lp-pre';
                if (no === a.number) cls += ' lp-pre-a';
                if (no === z.number) cls += ' lp-pre-b';
                var fence = fenced && (no === a.number || (closed && no === z.number));
                if (fence) {
                    cls += ' lp-fence';
                    if (!open && l.length) hide(l.from, l.to);
                    else if (l.length) out.push(SYNTAX.range(l.from, l.to));
                }
                var spec = { class: cls };
                if (no === a.number && lang && !open) spec.attributes = { 'data-lang': lang };
                out.push(D.line(spec).range(l.from));
            }
            if (!fenced || z.number - a.number < 1) return;
            var from = text.line(a.number + 1).from;
            var to = closed ? text.line(z.number).from - 1 : z.to;
            if (to > from) colors(state.sliceDoc(from, to), lang).forEach(function (c) {
                out.push(D.mark({ class: c[2] }).range(from + c[0], from + c[1]));
            });
        }

        return D.set(out, true);
    }

    // Kod renkleri okuma görünümüyle aynı kitaplıktan (highlight.js) gelir.
    var colorCache = new Map();
    function colors(code, lang) {
        var hljs = root.hljs;
        if (!hljs || !lang || !hljs.getLanguage(lang) || code.length > 30000) return [];
        var k = lang + '\n' + code;
        if (colorCache.has(k)) return colorCache.get(k);
        var out = [];
        try {
            var box = doc.createElement('template');
            box.innerHTML = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
            var at = 0;
            (function walk(node) {
                node.childNodes.forEach(function (c) {
                    if (c.nodeType === 3) { at += c.nodeValue.length; return; }
                    var start = at;
                    walk(c);
                    if (at > start) out.push([start, at, c.className]);
                });
            })(box.content);
            if (at !== code.length) out = [];
        } catch (e) { out = []; }
        if (colorCache.size > 60) colorCache.clear();
        colorCache.set(k, out);
        return out;
    }

    var inline = CM.ViewPlugin.fromClass(class {
        constructor(v) { this.decorations = drawInline(v); }
        update(u) {
            var forced = u.transactions.some(function (t) { return t.effects.some(function (e) { return e.is(refresh) || e.is(setFocus); }); });
            var parsed = CM.syntaxTree(u.state) !== CM.syntaxTree(u.startState);
            if (u.docChanged || u.viewportChanged || parsed || forced || (u.selectionSet && !dragging)) this.decorations = drawInline(u.view);
        }
    }, {
        decorations: function (p) { return p.decorations; }
    });

    // --- sayfada ara ---------------------------------------------------------------------
    var findField = CM.StateField.define({
        create: function () { return D.none; },
        update: function (v, tr) {
            v = v.map(tr.changes);
            tr.effects.forEach(function (e) {
                if (!e.is(setFind)) return;
                v = D.set(e.value.ranges.map(function (r, i) {
                    return D.mark({ class: i === e.value.index ? 'lp-find lp-find-now' : 'lp-find' }).range(r[0], r[1]);
                }));
            });
            return v;
        },
        provide: function (f) { return CM.EditorView.decorations.from(f); }
    });

    // --- tuşlar ------------------------------------------------------------------------------
    /** MdFormat eylemi: tek ve en küçük değişiklik olarak uygulanır (geri alınabilir). */
    function replaceWith(v, next) {
        var old = v.state.doc.toString();
        var a = 0;
        var max = Math.min(old.length, next.text.length);
        while (a < max && old.charCodeAt(a) === next.text.charCodeAt(a)) a++;
        var b = 0;
        while (b < max - a && old.charCodeAt(old.length - 1 - b) === next.text.charCodeAt(next.text.length - 1 - b)) b++;
        v.dispatch({
            changes: { from: a, to: old.length - b, insert: next.text.slice(a, next.text.length - b) },
            selection: { anchor: next.start, head: next.end },
            userEvent: 'input', scrollIntoView: true
        });
    }
    function format(name) {
        var s = view.state.selection.main;
        replaceWith(view, MdFormat.apply(name, view.state.doc.toString(), s.from, s.to));
        return true;
    }
    function listLine(v) {
        var line = v.state.doc.lineAt(v.state.selection.main.head);
        return /^\s*(?:[-*+]|\d+[.)])\s/.test(line.text);
    }
    function tab(v) {
        if (listLine(v) || !v.state.selection.main.empty) return CM.indentMore(v);
        v.dispatch(v.state.replaceSelection('    '), { userEvent: 'input' });
        return true;
    }
    // Ok tuşu çizilmiş bloğun üstünden atlamasın, içine girsin.
    function step(dir) {
        return function (v) {
            var s = v.state.selection.main;
            if (!s.empty) return false;
            var line = v.state.doc.lineAt(s.head);
            var no = line.number + dir;
            if (no < 1 || no > v.state.doc.lines) return false;
            var next = v.state.doc.line(no);
            var b = v.state.field(blockField).list.find(function (x) { return !x.open && next.from >= x.from && next.to <= x.to; });
            if (!b) return false;
            // Sarılan uzun satırda önce satırın son/ilk görsel sırasına gelinir
            var moved = v.moveVertically(s, dir > 0);
            if (moved.head >= line.from && moved.head <= line.to && moved.head !== s.head) return false;
            v.dispatch({ selection: { anchor: dir > 0 ? b.from : v.state.doc.lineAt(b.to).from }, scrollIntoView: true });
            return true;
        };
    }

    function extensions() {
        return [
            CM.history(),
            CM.drawSelection({ cursorBlinkRate: 1060 }),
            CM.EditorView.lineWrapping,
            CM.EditorState.tabSize.of(4),
            CM.indentUnit.of('    '),
            CM.markdown({ base: CM.markdownLanguage, extensions: [syntax], addKeymap: false, completeHTMLTags: false, pasteURLAsLink: true }),
            focusField, blockField, inline, findField,
            gutter.of(lineNumbersOn ? numbers() : []),
            attrs.of(contentAttrs()),
            CM.placeholder(T('Yazmaya başla…')),
            CM.Prec.high(CM.keymap.of([
                { key: 'Mod-b', run: function () { return format('bold'); } },
                { key: 'Mod-i', run: function () { return format('italic'); } },
                { key: 'Mod-k', run: function () { return format('link'); }, stopPropagation: true },
                { key: 'Tab', run: tab, shift: CM.indentLess },
                { key: 'ArrowDown', run: step(1) },
                { key: 'ArrowUp', run: step(-1) }
            ])),
            CM.keymap.of(CM.markdownKeymap.concat(CM.defaultKeymap, CM.historyKeymap)),
            CM.EditorView.domEventHandlers({
                mousedown: function (e, v) {
                    if (e.button === 0) dragging = true;
                    var a = e.target.closest && e.target.closest('.lp-link');
                    if (a && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        openAt(a);
                        return true;
                    }
                    return false;
                },
                focus: function (e, v) { later(v, true); },
                blur: function (e, v) { later(v, false); }
            }),
            CM.EditorView.updateListener.of(function (u) {
                if (u.docChanged && !loading) opts.onChange();
                if (u.docChanged || u.selectionSet) opts.onCursor();
            })
        ];
    }
    // Odak olayları çizim sırasında da gelebilir; durum bir sonraki adımda değişir.
    function later(v, on) {
        setTimeout(function () {
            if (v !== view || v.state.field(focusField) === on || v.hasFocus !== on) return;
            v.dispatch({ effects: setFocus.of(on) });
            opts.onFocus(on);
        }, 0);
    }
    function numbers() { return CM.lineNumbers(); }
    function contentAttrs() {
        return CM.EditorView.contentAttributes.of({
            spellcheck: spell ? 'true' : 'false', autocorrect: 'on', autocapitalize: 'sentences',
            'aria-label': T('Not'), class: 'markdown-body'
        });
    }

    function openAt(a) {
        var wiki = a.getAttribute('data-wiki-src');
        if (wiki !== null) {
            var target = wiki.split('|')[0];
            var hash = target.indexOf('#');
            opts.openWiki(hash < 0 ? target.trim() : target.slice(0, hash).trim(), hash < 0 ? '' : target.slice(hash + 1).trim());
            return;
        }
        var link = doc.createElement('a');
        link.setAttribute('href', a.getAttribute('data-href') || '');
        opts.openLink(link);
    }

    function release() {
        if (!dragging) return;
        dragging = false;
        if (view) setTimeout(function () { view.dispatch({ effects: refresh.of(null) }); }, 0);
    }

    // --- dışarıya -------------------------------------------------------------------------------
    function init(host, options) {
        opts = options;
        view = new CM.EditorView({ state: CM.EditorState.create({ doc: '', extensions: extensions() }), parent: host });
        ['mouseup', 'dragend', 'blur'].forEach(function (e) { root.addEventListener(e, release); });
    }

    /** Belgeyi yükler: yeni belge (geri alma geçmişi sıfırlanır). */
    function load(text) {
        loading = true;
        view.setState(CM.EditorState.create({ doc: text, extensions: extensions() }));
        loading = false;
        if (view.hasFocus) later(view, true);
    }

    /** Aynı belge diskte değişti: imleç yerinde kalır. */
    function replaceAll(text) {
        var old = view.state.doc.toString();
        if (old === text) return;
        var a = 0;
        var max = Math.min(old.length, text.length);
        while (a < max && old.charCodeAt(a) === text.charCodeAt(a)) a++;
        var b = 0;
        while (b < max - a && old.charCodeAt(old.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
        loading = true;
        view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) } });
        loading = false;
    }

    function headings() {
        var out = [];
        var state = view.state;
        var list = state.field(blockField).list;
        tree(state).iterate({
            enter: function (n) {
                if (n.name === 'Document') return true;
                var m = /^(ATX|Setext)Heading([1-4])$/.exec(n.name);
                if (m && !list.some(function (b) { return n.from >= b.from && n.from <= b.to; })) {
                    var t = state.sliceDoc(n.from, n.to);
                    t = m[1] === 'ATX' ? t.replace(/^#+\s*/, '').replace(/\s+#+\s*$/, '') : t.replace(/\n[^\n]*$/, '');
                    t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`~]|==/g, '');
                    if (t.trim()) out.push({ level: Number(m[2]), text: t.trim(), pos: n.from });
                }
                return false;
            }
        });
        return out;
    }

    // Konum, belgedeki kesirli satır numarasıdır (1'den başlar).
    function topLine() {
        var top = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
        if (top <= 0) return 1;
        var block = view.lineBlockAtHeight(top);
        var a = view.state.doc.lineAt(block.from).number;
        var z = view.state.doc.lineAt(block.to).number;
        return a + Math.min(0.999, Math.max(0, (top - block.top) / Math.max(1, block.height))) * (z - a + 1);
    }
    function scrollToLine(n) {
        if (n <= 1.01) { view.scrollDOM.scrollTop = 0; return; }
        var no = Math.min(view.state.doc.lines, Math.max(1, Math.floor(n)));
        view.dispatch({ effects: CM.EditorView.scrollIntoView(view.state.doc.line(no).from, { y: 'start', yMargin: 0 }) });
    }
    function scrollToPos(pos) {
        view.dispatch({ effects: CM.EditorView.scrollIntoView(pos, { y: 'start', yMargin: 16 }) });
    }

    root.LiveEditor = {
        init: init, load: load, replaceAll: replaceAll, format: format,
        text: function () { return view.state.doc.toString(); },
        scroller: function () { return view.scrollDOM; },
        focus: function () { view.focus(); },
        blur: function () { view.contentDOM.blur(); },
        hasFocus: function () { return view.hasFocus; },
        setCursorLine: function (n) {
            var no = Math.min(view.state.doc.lines, Math.max(1, Math.floor(n)));
            view.dispatch({ selection: { anchor: view.state.doc.line(no).to } });
        },
        cursorLine: function () { return view.state.doc.lineAt(view.state.selection.main.head).number; },
        undo: function () { CM.undo(view); }, redo: function () { CM.redo(view); },
        headings: headings, topLine: topLine, scrollToLine: scrollToLine, scrollToPos: scrollToPos,
        posTop: function (pos) { return view.lineBlockAt(Math.min(pos, view.state.doc.length)).top + view.documentTop; },
        find: function (ranges, index, jump) {
            var fx = [setFind.of({ ranges: ranges, index: index })];
            if (jump && ranges[index]) fx.push(CM.EditorView.scrollIntoView(ranges[index][0], { y: 'center' }));
            view.dispatch({ effects: fx });
        },
        setLineNumbers: function (on) {
            lineNumbersOn = on;
            if (view) view.dispatch({ effects: gutter.reconfigure(on ? numbers() : []) });
        },
        setSpellcheck: function (on) {
            spell = on;
            if (view) view.dispatch({ effects: attrs.reconfigure(contentAttrs()) });
        },
        redraw: function () { if (view) view.requestMeasure(); },
        _cellRanges: cellRanges
    };
})(globalThis);
