/**
 * Komut paleti (masaüstü): Ctrl+K ile not, komut ve not içi arama tek kutuda.
 * Telefonda karşılığı mobile.js'teki hızlı geçiştir.
 *   ">" ile başlayan sorgu yalnız komutları listeler.
 */
(function (root) {
    'use strict';
    var doc = root.document;
    var box = null;
    var returnFocus = null;

    function commands() {
        var list = [
            ['Yeni not', 'Ctrl+N', function () { Notes.create(); }],
            ['Bugünün notu', '', Notes.today],
            [isEditMode ? 'Okuma moduna geç' : 'Düzenleme moduna geç', 'Ctrl+E', function () { (isEditMode ? btnReadMode : btnEditMode).click(); }],
            ['Odak modu', 'F9', function () { Reader.setZen(!Reader.isZen()); }],
            ['Kenar çubuğunu aç/kapat', 'Ctrl+\\', toggleSidebar],
            ['Dosya aç…', 'Ctrl+O', openFileDialog],
            ['Klasör aç…', 'Ctrl+Shift+O', openFolderDialog],
            ['Yazdır / PDF', 'Ctrl+P', exportToPdf],
            ['Ayarlar', '', openSettingsPanel]
        ];
        if (currentFilePath) {
            var path = currentFilePath;
            list.push(
                [Notes.isPinned(path) ? 'Bu notun sabitlemesini kaldır' : 'Bu notu sabitle', '', function () { Notes.togglePin(path); }],
                ['Bu notu yeniden adlandır…', '', function () { Notes.rename(path); }],
                ['Bu notu sil…', '', function () { Notes.trash(path); }],
                ['Markdown kaynağını kopyala', '', async function () {
                    if (isEditMode) closeAllBlockEditors();
                    showToast((await copyToClipboard(currentContent)) ? 'Markdown kopyalandı' : 'Panoya kopyalanamadı');
                }]
            );
        }
        THEMES.forEach(function (t) { list.push(['Tema: ' + t.name, t.id === currentTheme ? '✓' : '', function () { chooseTheme(t.id); }]); });
        return list.map(function (c) { return { label: c[0], hint: c[1], run: c[2], key: Notes.fold(c[0]), kind: 'command' }; });
    }

    function toggleSidebar() { sidebar.classList.toggle('collapsed'); }

    function close() {
        if (!box) return;
        box.remove();
        box = null;
        if (returnFocus && returnFocus.isConnected && returnFocus.focus) returnFocus.focus();
    }

    async function open(initial) {
        if (box || doc.querySelector('.ui-dialog-backdrop')) return;
        returnFocus = doc.activeElement;
        // Açık blok düzenleyici odağı kaybedince kapanır; ona geri dönülmez.
        if (EditorKeys.isBlock(returnFocus)) returnFocus = null;
        var el = doc.createElement('div');
        el.className = 'palette-backdrop';
        el.innerHTML = '<div class="palette" role="dialog" aria-modal="true" aria-label="Ara ve git">' +
            '<input type="text" class="palette-input" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="palette-list" placeholder="Not ara, komut için &gt; yaz…">' +
            '<div class="palette-list" id="palette-list" role="listbox"></div>' +
            '<div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> gez</span><span><kbd>Enter</kbd> aç</span><span><kbd>Esc</kbd> kapat</span></div></div>';
        doc.body.appendChild(el);
        box = el;
        var input = el.querySelector('input');
        var list = el.querySelector('.palette-list');
        var items = [];
        var active = 0;
        var notes = [];
        var recents = [];
        var cmds = commands();
        var gen = 0;
        var timer = null;

        function setActive(i) {
            if (!items.length) return;
            active = (i + items.length) % items.length;
            items.forEach(function (it, n) {
                it.el.classList.toggle('active', n === active);
                it.el.setAttribute('aria-selected', n === active ? 'true' : 'false');
            });
            input.setAttribute('aria-activedescendant', items[active].el.id);
            items[active].el.scrollIntoView({ block: 'nearest' });
        }
        function run(it) {
            close();
            it.run();
        }
        function section(title) {
            var h = doc.createElement('div');
            h.className = 'palette-section';
            h.textContent = title;
            list.appendChild(h);
        }
        function add(it) {
            var row = doc.createElement('div');
            row.className = 'palette-item';
            row.id = 'palette-item-' + items.length;
            row.setAttribute('role', 'option');
            var label = doc.createElement('span');
            label.className = 'palette-label';
            label.textContent = it.label;
            row.appendChild(label);
            if (it.hint) {
                var hint = doc.createElement('span');
                hint.className = it.kind === 'command' ? 'palette-key' : 'palette-hint';
                hint.textContent = it.hint;
                row.appendChild(hint);
            }
            row.addEventListener('mousedown', function (e) { e.preventDefault(); });
            row.addEventListener('click', function () { run(it); });
            var index = items.length;
            row.addEventListener('mousemove', function () { if (active !== index) setActive(index); });
            items.push({ el: row, run: it.run });
            list.appendChild(row);
        }
        function noteItem(path, hint) {
            return { label: Notes.noteName(path), hint: hint, kind: 'note', run: function () { Notes.open(path); } };
        }

        function render() {
            var raw = input.value.trim();
            var only = raw.charAt(0) === '>';
            var q = Notes.fold(only ? raw.slice(1).trim() : raw);
            var g = ++gen;
            clearTimeout(timer);
            list.innerHTML = '';
            items = [];
            active = 0;

            if (!only) {
                var shown = [];
                if (q) {
                    var starts = [], inside = [];
                    notes.forEach(function (n) {
                        var at = n.key.indexOf(q);
                        if (at === 0) starts.push(n);
                        else if (at > 0 || Notes.fold(n.dir).indexOf(q) >= 0) inside.push(n);
                    });
                    shown = starts.concat(inside).slice(0, 30).map(function (n) { return noteItem(n.path, n.dir); });
                    if (shown.length) section('Notlar');
                    shown.forEach(add);
                } else {
                    var pins = Notes.pins();
                    if (pins.length) section('Sabitlenenler');
                    pins.forEach(function (p) { add(noteItem(p, dirname(p))); });
                    var rest = recents.filter(function (p) { return pins.indexOf(p) < 0 && p !== currentFilePath; }).slice(0, 6);
                    if (rest.length) section('Son açılanlar');
                    rest.forEach(function (p) { add(noteItem(p, dirname(p))); });
                }
            }
            var found = cmds.filter(function (c) { return !q || c.key.indexOf(q) >= 0; });
            if (!only && !q) found = found.slice(0, 9);
            if (found.length) section('Komutlar');
            found.forEach(add);
            if (!items.length) empty('Eşleşme yok');
            setActive(0);
            if (!only && q.length >= 2) timer = setTimeout(function () { searchInside(raw, g); }, 220);
        }
        function empty(text) {
            var e = doc.createElement('div');
            e.className = 'palette-empty';
            e.textContent = text;
            list.appendChild(e);
        }
        async function searchInside(query, g) {
            var r = null;
            try { r = await nativeApi().search_notes(query); } catch (e) { console.error('Arama:', e); }
            if (g !== gen || box !== el) return;
            var files = (r && r.files) || [];
            if (!files.length) return;
            var e = list.querySelector('.palette-empty');
            if (e) e.remove();
            section('Not içinde' + (r.truncated ? ' (ilk ' + files.length + ')' : ''));
            files.forEach(function (n) {
                add({
                    label: Notes.noteName(n.path), hint: n.snippet, kind: 'hit',
                    run: async function () {
                        if (!(await Notes.open(n.path))) return;
                        findInput.value = query;
                        runFind(0, true);
                    }
                });
            });
            setActive(active);
        }

        input.addEventListener('input', render);
        el.addEventListener('keydown', function (e) {
            e.stopPropagation();        // arkadaki kısayollar çalışmasın
            if (e.isComposing) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (items[active]) run(items[active]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
            } else if (e.key === 'Tab' || ((e.ctrlKey || e.metaKey) && /^[a-z]$/i.test(e.key) && !/^[acvxz]$/i.test(e.key))) {
                e.preventDefault();     // odak kutuda kalsın; Ctrl+P tarayıcıya gitmesin
            }
        });
        el.addEventListener('mousedown', function (e) { if (e.target === el) { e.preventDefault(); close(); } });

        input.value = initial || '';
        input.focus();
        render();
        var native = nativeApi();
        if (!native) return;
        try {
            var data = await Promise.all([native.list_notes(), native.recent_list()]);
            notes = (data[0] && data[0].files) || [];
            recents = (data[1] && data[1].files) || [];
            notes.forEach(function (n) { n.key = Notes.fold(Notes.noteName(n.path)); });
        } catch (error) {
            console.error('Not listesi alınamadı:', error);
        }
        if (box === el) render();
    }

    function init() {
        doc.getElementById('btn-palette').addEventListener('click', function () { open(); });
        doc.getElementById('btn-new-note').addEventListener('click', function () { Notes.create(); });
        doc.addEventListener('keydown', function (e) {
            if (box || doc.querySelector('.ui-dialog-backdrop, .img-zoom') || !settingsPanel.classList.contains('hidden')) return;
            var ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
            var key = String(e.key).toLowerCase();
            var act = null;
            if (ctrl && !e.shiftKey && key === 'k' && !EditorKeys.isBlock(e.target)) act = open;
            else if (ctrl && e.shiftKey && key === 'f') act = open;
            else if (ctrl && !e.shiftKey && key === 'n') act = function () { Notes.create(); };
            else if (ctrl && key === '\\') act = toggleSidebar;
            else if (e.key === 'F9') act = function () { Reader.setZen(!Reader.isZen()); };
            else if (e.key === 'Escape' && Reader.isZen() && !contextMenuEl && !e.target.matches('textarea, input:not([type="checkbox"])')) act = function () { Reader.setZen(false); };
            if (!act) return;
            e.preventDefault();
            e.stopPropagation();
            act();
        }, true);
    }

    root.Palette = { init: init, open: open, close: close };
})(globalThis);
