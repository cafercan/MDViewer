/**
 * Okuma yardımcıları (masaüstü + telefon): kod kopyalama, tıklanır görev
 * kutuları, kelime/okuma süresi, okuma yüzdesi, geri bağlantılar, odak modu.
 * app.js her çizimden sonra `rendered()` çağırır.
 */
(function (root) {
    'use strict';
    var doc = root.document;
    var html = doc.documentElement;

    var COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4V4h11v1"/></svg>';
    var DONE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="5 12.5 10 17.5 19 7"/></svg>';

    // --- kod blokları: dil etiketi + kopyala --------------------------------------
    function decorateCode() {
        markdownViewer.querySelectorAll('pre > code').forEach(function (code) {
            var pre = code.parentNode;
            var box = doc.createElement('div');
            box.className = 'code-box';
            // Dil etiketi CSS ile yazılır: sayfa içi aramaya ve panoya karışmaz.
            var lang = /(?:^|\s)language-([^\s]+)/.exec(code.className);
            if (lang && lang[1] !== 'undefined') box.dataset.lang = lang[1];
            pre.parentNode.insertBefore(box, pre);
            box.appendChild(pre);
            var b = doc.createElement('button');
            b.type = 'button';
            b.className = 'code-copy';
            b.title = 'Kodu kopyala';
            b.setAttribute('aria-label', 'Kodu kopyala');
            b.innerHTML = COPY;
            b.addEventListener('click', async function () {
                if (!(await copyToClipboard(code.textContent.replace(/\n$/, '')))) {
                    showToast('Panoya kopyalanamadı');
                    return;
                }
                b.innerHTML = DONE;
                b.classList.add('done');
                setTimeout(function () { b.innerHTML = COPY; b.classList.remove('done'); }, 1400);
            });
            box.appendChild(b);
        });
    }

    // --- okurken görev kutusu: kaynakta [ ] ⇔ [x] çevrilir ve kaydedilir -----------
    var TASK = 'input[type="checkbox"]';
    var saving = Promise.resolve();

    function onTask(e) {
        var box = e.target;
        if (!box.matches || !box.matches(TASK)) return;
        var boxes = Array.from(markdownViewer.querySelectorAll(TASK));
        var index = boxes.indexOf(box);
        var shown = boxes.map(function (b) { return b === box ? !b.checked : b.checked; });
        var next = MdFormat.toggleTask(currentContent, index, shown);
        if (next === null) {
            box.checked = !box.checked;
            showToast('Bu kutu yalnız düzenleme modunda değiştirilebilir');
            return;
        }
        // Bellek hemen, disk sırayla: hızlı tıklamalar birbirini ezmesin.
        var path = currentFilePath;
        currentContent = next;
        markUnsaved();
        updateStats();
        saving = saving.then(async function () {
            if (path !== currentFilePath || !hasUnsavedChanges) return;
            await saveFile(currentContent);
            if (hasUnsavedChanges) {
                showToast('Kaydedilemedi');
                markSaved();
                await loadFile(path, { pushHistory: false });
            }
        });
    }

    // --- istatistik ve okuma yüzdesi ------------------------------------------------
    function stats() { return DocStats.parts(DocStats.count(currentContent, MdFormat.tasks(currentContent))); }

    function updateStats() {
        var text = currentFilePath ? stats().join('  ·  ') : '';
        ['status-stats', 'doc-meta'].forEach(function (id) {
            var el = doc.getElementById(id);
            if (el) el.textContent = text;
        });
        var where = doc.getElementById('status-path');
        if (where) {
            where.textContent = currentFilePath;
            where.title = currentFilePath;
        }
    }

    function updateProgress() {
        var el = doc.getElementById('status-progress');
        if (!el) return;
        var pane = isEditMode ? LiveEditor.scroller() : paneRead;
        var max = pane.scrollHeight - pane.clientHeight;
        el.textContent = max > 40 ? '%' + Math.round(Math.min(1, pane.scrollTop / max) * 100) : '';
    }

    // --- geri bağlantılar: açılınca aranır (her belgede klasör taranmasın) ------------
    var backGen = 0;

    function resetBacklinks() {
        var box = doc.getElementById('backlinks');
        if (!box || box.dataset.path === currentFilePath) return;
        backGen++;
        box.dataset.path = currentFilePath;
        box.open = false;
        box.hidden = !currentFilePath || !nativeApi();
        box.querySelector('.backlinks-list').innerHTML = '';
    }

    async function loadBacklinks(box) {
        var gen = ++backGen;
        var list = box.querySelector('.backlinks-list');
        list.textContent = 'Aranıyor…';
        var r = null;
        try { r = await nativeApi().backlinks(currentFilePath); } catch (e) { console.error('Geri bağlantılar:', e); }
        if (gen !== backGen) return;
        list.textContent = '';
        if (!r || !r.success) {
            list.textContent = 'Bağlantılar okunamadı.';
            return;
        }
        if (!r.files.length) {
            list.textContent = 'Bu nota bağlanan başka not yok.';
            return;
        }
        r.files.forEach(function (n) {
            var b = doc.createElement('button');
            b.type = 'button';
            b.className = 'backlink';
            var name = doc.createElement('b');
            name.textContent = Notes.noteName(n.path);
            var snip = doc.createElement('span');
            snip.textContent = n.snippet;
            b.appendChild(name);
            b.appendChild(snip);
            b.addEventListener('click', function () { Notes.open(n.path); });
            list.appendChild(b);
        });
    }

    // --- odak modu -------------------------------------------------------------------
    function isZen() { return html.classList.contains('zen'); }

    function setZen(on) {
        if (on === isZen()) return;
        html.classList.toggle('zen', on);
        if (on && !html.classList.contains('mobile')) showToast('Odak modu · çıkmak için Esc');
        updateProgress();
    }

    // --- bağlama -----------------------------------------------------------------------
    /** Okuma görünümü yeniden çizildi. */
    function rendered() {
        markdownViewer.querySelectorAll(TASK).forEach(function (c) { c.disabled = !currentFilePath; });
        resetBacklinks();
        updateStats();
        updateProgress();
    }

    function init() {
        markdownViewer.addEventListener('change', onTask);
        [paneRead, LiveEditor.scroller()].forEach(function (p) {
            p.addEventListener('scroll', updateProgress, { passive: true });
        });
        root.addEventListener('resize', updateProgress);
        var box = doc.getElementById('backlinks');
        box.addEventListener('toggle', function () { if (box.open) loadBacklinks(box); });
        ['btn-zen', 'btn-zen-exit'].forEach(function (id) {
            doc.getElementById(id).addEventListener('click', function () { setZen(!isZen()); });
        });
    }

    root.Reader = {
        init: init, decorateCode: decorateCode, rendered: rendered, stats: stats,
        refresh: function () { resetBacklinks(); updateStats(); updateProgress(); },
        isZen: isZen, setZen: setZen
    };
})(globalThis);
