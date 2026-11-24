/**
 * Not işlemleri (masaüstü + telefon): yeni not, günün notu, yeniden adlandırma,
 * çöpe taşıma, sabitleme. app.js'in fonksiyonlarını çağırır; telefon arayüzü
 * `hooks` ile çekmeceyi kapatmayı ve klasör adını kendine göre verir.
 */
(function (root) {
    'use strict';

    var hooks = {
        placeName: function (dir) { return basename(dir) || dir; },
        beforeOpen: function () {}
    };
    var pinned = [];

    function noteName(path) { return basename(path).replace(/\.(md|markdown)$/i, ''); }

    // Türkçe harf duyarsız karşılaştırma (I/İ/ı/i tek harf sayılır).
    function fold(s) { return String(s).toLocaleLowerCase('tr').replace(/ı/g, 'i'); }

    function pathUnder(path, dir) {
        var p = normPath(path);
        var d = normPath(dir);
        return p === d || p.indexOf(d + '/') === 0;
    }

    function rootDir() { return explorerState && explorerState.root; }

    /** Not listeden açılır; kök dışındaysa "son açılan" yoluyla (kök ona taşınır). */
    async function open(path) {
        if (rootDir() && pathUnder(path, rootDir())) {
            if (!(await confirmLeaveUnsaved())) return false;
            await loadFile(path);
        } else {
            await openRecentFile(path);
        }
        return path === currentFilePath;
    }

    // dir verilmezse: açık notun klasörü (gezgin kökünün altındaysa), yoksa gezgin kökü.
    // text verilirse (paylaşılan metin) not onunla başlar.
    async function create(dir, suggested, text) {
        var rootPath = rootDir();
        if (!nativeApi() || !rootPath) {
            showToast('Önce bir klasör açın');
            return;
        }
        if (!dir) {
            var here = currentFilePath ? dirname(currentFilePath) : '';
            dir = here && pathUnder(here, rootPath) ? here : rootPath;
        }
        var name = await UiDialog.prompt('Yeni not · ' + hooks.placeName(dir),
            { placeholder: 'Not adı', okText: 'Oluştur', value: suggested });
        if (name === null) return;
        if (!(await confirmLeaveUnsaved())) return;
        await createAndOpen(dir, name, text);
    }

    async function createAndOpen(dir, name, text) {
        var native = nativeApi();
        var result = await native.create_note(dir, name);
        if (!result || !result.success) {
            UiDialog.alert('Not oluşturulamadı: ' + ((result && result.error) || 'bilinmeyen hata'));
            return;
        }
        if (text) {
            var made = await native.content(result.path);
            var saved = made && made.success && await native.save(result.path, made.content + text + '\n');
            if (!saved || !saved.success) UiDialog.alert('Metin nota yazılamadı.');
        }
        hooks.beforeOpen();
        applyExplorerState(explorerState);      // ağaç yeni notu göstersin
        await loadFile(result.path);
        if (!text && !isEditMode) btnEditMode.click();
    }

    // Günün notu: gezgin kökünde YYYY-AA-GG.md; yoksa oluşturulur.
    async function today() {
        var native = nativeApi();
        var rootPath = rootDir();
        if (!native || !rootPath) {
            showToast('Önce bir klasör açın');
            return;
        }
        var d = new Date();
        var name = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
        var path = rootPath.replace(/[\\/]+$/, '') + (rootPath.indexOf('\\') >= 0 ? '\\' : '/') + name + '.md';
        if (path === currentFilePath || !(await confirmLeaveUnsaved())) return;
        var there = await native.inspect_path(path);
        hooks.beforeOpen();
        if (there && there.type === 'file') await loadFile(path);
        else await createAndOpen(rootPath, name);
    }

    // Açık not düzenleniyorsa bekleyen yazı önce diske insin.
    async function settle(path) {
        if (path !== currentFilePath) return true;
        if (isEditMode) closeAllBlockEditors();
        if (!hasUnsavedChanges) return true;
        clearTimeout(autosaveTimer);
        await saveFile();
        if (hasUnsavedChanges) showToast('Not kaydedilemedi');
        return !hasUnsavedChanges;
    }

    async function rename(path) {
        var name = await UiDialog.prompt('Yeniden adlandır',
            { placeholder: 'Not adı', okText: 'Kaydet', value: noteName(path) });
        if (name === null || !name.trim() || name.trim() === noteName(path)) return;
        if (!(await settle(path))) return;
        var r = await nativeApi().rename_note(path, name);
        if (!r || !r.success) {
            UiDialog.alert('Yeniden adlandırılamadı: ' + ((r && r.error) || 'bilinmeyen hata'));
            return;
        }
        if (isPinned(path)) {
            pinned = pinned.map(function (p) { return p === path ? r.path : p; });
            saveSettings();
        }
        applyExplorerState(explorerState);
        if (path === currentFilePath) await loadFile(r.path, { replaceHistory: true });
        showToast('Yeni ad: ' + noteName(r.path));
    }

    async function trash(path) {
        if (!(await UiDialog.confirm('"' + noteName(path) + '" silinsin mi? Not, bulunduğu klasördeki gizli .trash klasörüne taşınır.',
            { okText: 'Sil', cancelText: 'Vazgeç' }))) return;
        if (!(await settle(path))) return;
        var r = await nativeApi().trash_note(path);
        if (!r || !r.success) {
            UiDialog.alert('Silinemedi: ' + ((r && r.error) || 'bilinmeyen hata'));
            return;
        }
        if (isPinned(path)) togglePin(path, true);
        applyExplorerState(explorerState);
        showToast('Not silindi');
        if (path !== currentFilePath) return;
        if (isEditMode) btnReadMode.click();
        var recents = ((await nativeApi().recent_list()) || {}).files || [];
        var next = recents.length ? await nativeApi().open_file_path(recents[0]) : null;
        await loadFile(next || '', { replaceHistory: true });
    }

    // --- sabitlenen notlar ---------------------------------------------------
    function isPinned(path) { return pinned.indexOf(path) >= 0; }

    function setPinned(list) {
        pinned = Array.isArray(list)
            ? list.filter(function (p, i) { return typeof p === 'string' && p && list.indexOf(p) === i; }).slice(0, 50)
            : [];
        renderPins();
    }

    function togglePin(path, quiet) {
        var had = isPinned(path);
        setPinned(had ? pinned.filter(function (p) { return p !== path; }) : pinned.concat(path));
        saveSettings();
        if (!quiet) showToast(had ? 'Sabitleme kaldırıldı' : 'Sabitlendi: ' + noteName(path));
    }

    /** Gezginin üstündeki "Sabitlenenler" bölümü. */
    function renderPins() {
        var box = document.getElementById('pinned-list');
        if (!box) return;
        box.innerHTML = '';
        box.hidden = !pinned.length;
        if (!pinned.length) return;
        var title = document.createElement('div');
        title.className = 'pinned-title';
        title.textContent = 'Sabitlenenler';
        box.appendChild(title);
        pinned.forEach(function (p) {
            box.appendChild(buildFileRow({ name: noteName(p), path: p }, 0));
        });
    }

    /** Dosya satırının sağ tık menüsü (masaüstü). */
    function menuItems(path) {
        return [
            { label: isPinned(path) ? 'Sabitlemeyi kaldır' : 'Sabitle', action: function () { togglePin(path); } },
            { label: 'Yeniden adlandır…', action: function () { rename(path); } },
            { label: 'Tam yolu kopyala', action: async function () {
                showToast((await copyToClipboard(path)) ? 'Yol kopyalandı: ' + basename(path) : 'Panoya kopyalanamadı');
            } },
            { separator: true },
            { label: 'Sil…', action: function () { trash(path); } }
        ];
    }

    root.Notes = {
        hooks: hooks, fold: fold, noteName: noteName, pathUnder: pathUnder, open: open,
        create: create, createAndOpen: createAndOpen, today: today, settle: settle,
        rename: rename, trash: trash, menuItems: menuItems,
        isPinned: isPinned, togglePin: togglePin, setPinned: setPinned,
        pins: function () { return pinned.slice(); }, renderPins: renderPins
    };
})(globalThis);
