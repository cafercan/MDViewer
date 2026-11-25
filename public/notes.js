/**
 * Not işlemleri (masaüstü + telefon): yeni not, günün notu, yeniden adlandırma,
 * çöpe taşıma, sabitleme. app.js'in fonksiyonlarını çağırır; telefon arayüzü
 * `hooks` ile çekmeceyi kapatmayı ve klasör adını kendine göre verir.
 */
(function (root) {
    'use strict';

    var hooks = {
        placeName: function (dir) { return basename(dir) || dir; },
        beforeOpen: function () {},
        menu: function (title, items) {
            showContextMenu(menuAt.x, menuAt.y, [{ label: title, disabled: true }].concat(items));
        }
    };
    var pinned = [];
    var menuAt = { x: 80, y: 120 };     // son sağ tık: "Taşı…" menüsü orada açılır

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
        if (text) return;
        if (!isEditMode) btnEditMode.click();
        LiveEditor.setCursorLine(Infinity);
        LiveEditor.focus();
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
        commitCell();
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

    // --- klasörler ve taşıma ---------------------------------------------------
    /** from'un kendisi ya da altındaysa yeni karşılığı (to null: null), değilse undefined. */
    function remap(p, from, to) {
        var win = from.indexOf('\\') >= 0;
        var a = win ? p.toLowerCase() : p;
        var b = win ? from.toLowerCase() : from;
        if (a !== b && !(a.indexOf(b) === 0 && /[\\/]/.test(p.charAt(from.length)))) return undefined;
        return to === null ? null : to + p.slice(from.length);
    }

    function fail(title, r) {
        UiDialog.alert(title + ': ' + ((r && r.error) || 'bilinmeyen hata'));
    }

    /** Yolu değiştiren işlem: açık not diske iner, sonra sabitler, ağaç ve açık not yeni yola geçer. */
    async function relocate(path, title, call) {
        var open = currentFilePath && remap(currentFilePath, path, path) !== undefined ? currentFilePath : '';
        if (open) {
            if (!(await settle(open))) return null;
            if (stopWatch) { stopWatch(); stopWatch = null; }   // Windows izlenen klasörü taşıtmaz
        }
        var r = null;
        try {
            r = await call(nativeApi());
        } catch (error) {
            r = { error: String(error) };
        }
        if (!r || !r.success) {
            if (open) setupFileWatcher(open);
            fail(title, r);
            return null;
        }
        setPinned(pinned.map(function (p) {
            var next = remap(p, path, r.path);
            return next === undefined ? p : next;
        }));
        saveSettings();
        remapOpenDirs(function (p) { return remap(p, path, r.path); });
        await refreshExplorer();
        if (open) await loadFile(remap(open, path, r.path), { replaceHistory: true });
        return r.path;
    }

    async function createFolder(dir) {
        var parent = dir || rootDir();
        if (!nativeApi() || !parent) {
            showToast('Önce bir klasör açın');
            return;
        }
        var name = await UiDialog.prompt('Yeni klasör · ' + hooks.placeName(parent),
            { placeholder: 'Klasör adı', okText: 'Oluştur' });
        if (name === null || !name.trim()) return;
        var r = await nativeApi().create_folder(parent, name);
        if (!r || !r.success) return fail('Klasör oluşturulamadı', r);
        openDirs.add(parent);
        await refreshExplorer();
        await revealInExplorer(r.path);
        showToast('Klasör oluşturuldu: ' + basename(r.path));
    }

    async function renameFolder(path) {
        var old = basename(path);
        var name = await UiDialog.prompt('Klasörü yeniden adlandır',
            { placeholder: 'Klasör adı', okText: 'Kaydet', value: old });
        if (name === null || !name.trim() || name.trim() === old) return;
        var next = await relocate(path, 'Yeniden adlandırılamadı', function (n) { return n.rename_folder(path, name); });
        if (next) showToast('Yeni ad: ' + basename(next));
    }

    async function move(path, dir) {
        if (samePlace(dirname(path), dir)) return;
        openDirs.add(dir);
        var next = await relocate(path, 'Taşınamadı', function (n) { return n.move_entry(path, dir); });
        if (next) showToast(noteName(next) + ' → ' + hooks.placeName(dir));
    }

    function samePlace(a, b) {
        var norm = function (p) { return String(p).replace(/[\\/]+/g, '/').replace(/\/+$/, ''); };
        return norm(a) === norm(b);
    }

    /** "Taşı…": klasörlerin içine inilerek hedef seçilir. */
    async function pickMove(path, dir) {
        dir = dir || rootDir();
        if (!dir) return;
        var data = await nativeApi().list_dir(dir);
        if (!data || !data.success) return fail('Klasör okunamadı', data);
        var items = [];
        if (!samePlace(dirname(path), dir)) {
            items.push({ label: 'Buraya taşı', icon: 'done', action: function () { move(path, dir); } }, { separator: true });
        }
        if (!samePlace(dir, rootDir())) {
            items.push({ label: '.. ' + hooks.placeName(dirname(dir)), icon: 'up', action: function () { pickMove(path, dirname(dir)); } });
        }
        data.dirs.filter(function (d) { return d.path !== path; }).forEach(function (d) {
            items.push({ label: d.name, icon: 'folder', action: function () { pickMove(path, d.path); } });
        });
        if (!items.length) items.push({ label: 'Taşınacak başka klasör yok', disabled: true });
        hooks.menu('Taşı: ' + noteName(path) + ' · ' + hooks.placeName(dir), items);
    }

    async function trashFolder(path) {
        var name = basename(path);
        if (!(await UiDialog.confirm('"' + name + '" klasörü içindeki her şeyle birlikte silinsin mi? Klasör, bulunduğu yerdeki gizli .trash klasörüne taşınır.',
            { okText: 'Sil', cancelText: 'Vazgeç' }))) return;
        var open = currentFilePath && remap(currentFilePath, path, path) !== undefined ? currentFilePath : '';
        if (open) {
            if (!(await settle(open))) return;
            if (stopWatch) { stopWatch(); stopWatch = null; }
        }
        var r = await nativeApi().trash_folder(path);
        if (!r || !r.success) {
            if (open) setupFileWatcher(open);
            return fail('Silinemedi', r);
        }
        setPinned(pinned.filter(function (p) { return remap(p, path, null) === undefined; }));
        saveSettings();
        remapOpenDirs(function (p) { return remap(p, path, null); });
        refreshExplorer();
        showToast('Klasör silindi');
        if (open) await leaveDeleted();
    }

    // Açık not silindi: son açılan nota, yoksa karşılamaya geç.
    async function leaveDeleted() {
        if (isEditMode) btnReadMode.click();
        var recents = ((await nativeApi().recent_list()) || {}).files || [];
        var next = recents.length ? await nativeApi().open_file_path(recents[0]) : null;
        await loadFile(next || '', { replaceHistory: true });
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
        if (path === currentFilePath) await leaveDeleted();
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
            { label: isPinned(path) ? 'Sabitlemeyi kaldır' : 'Sabitle', icon: 'pin', action: function () { togglePin(path); } },
            { label: 'Yeniden adlandır…', icon: 'edit', action: function () { rename(path); } },
            { label: 'Taşı…', icon: 'move', action: function () { pickMove(path); } },
            { label: 'Kopyasını oluştur', icon: 'copy', action: function () { duplicate(path); } },
            { separator: true },
            { label: 'Wikilink kopyala', icon: 'wikilink', action: function () { copyText('[[' + noteName(path) + ']]', 'Bağlantı kopyalandı'); } },
            copyPathItem(path),
            { label: 'Dosya yöneticisinde göster', icon: 'external', action: function () { nativeApi().open_in_file_manager(dirname(path)); } },
            { separator: true },
            { label: 'Sil…', icon: 'trash', danger: true, action: function () { trash(path); } }
        ];
    }

    async function copyText(text, done) {
        showToast((await copyToClipboard(text)) ? done : 'Panoya kopyalanamadı');
    }
    function copyPathItem(path) {
        return { label: 'Tam yolu kopyala', icon: 'link', action: function () { copyText(path, 'Yol kopyalandı: ' + basename(path)); } };
    }

    async function duplicate(path) {
        if (!(await settle(path))) return;
        var native = nativeApi();
        var source = await native.content(path);
        if (!source || !source.success) return fail('Kopyalanamadı', source);
        var made = await native.create_note(dirname(path), noteName(path) + ' kopya');
        if (!made || !made.success) return fail('Kopyalanamadı', made);
        var saved = await native.save(made.path, source.content);
        refreshExplorer();
        if (!saved || !saved.success) return fail('Kopyalanamadı', saved);
        showToast('Kopyalandı: ' + noteName(made.path));
    }

    /** Klasör satırının sağ tık menüsü (masaüstü). */
    function folderMenuItems(path) {
        var items = [
            { label: 'Buraya yeni not…', icon: 'newNote', action: function () { create(path); } },
            { label: 'Buraya yeni klasör…', icon: 'newFolder', action: function () { createFolder(path); } },
            { separator: true },
            { label: 'Yeniden adlandır…', icon: 'edit', action: function () { renameFolder(path); } },
            { label: 'Taşı…', icon: 'move', action: function () { pickMove(path); } }
        ];
        if (explorerState && !explorerState.locked) {
            items.push({ label: 'Bu klasörü kök yap', icon: 'target', action: function () { explorerEnter(path); } });
        }
        return items.concat([
            copyPathItem(path),
            { label: 'Dosya yöneticisinde aç', icon: 'external', action: function () { nativeApi().open_in_file_manager(path); } },
            { separator: true },
            { label: 'Sil…', icon: 'trash', danger: true, action: function () { trashFolder(path); } }
        ]);
    }

    /** Gezginin boş yerinin sağ tık menüsü (masaüstü). */
    function rootMenuItems() {
        return [
            { label: 'Yeni not…', icon: 'newNote', action: function () { create(rootDir()); } },
            { label: 'Yeni klasör…', icon: 'newFolder', action: function () { createFolder(); } },
            { label: 'Bugünün notu', icon: 'day', action: today },
            { separator: true },
            { label: 'Dosya aç…', icon: 'openFile', action: openFileDialog },
            { label: 'Klasör aç…', icon: 'openFolder', action: openFolderDialog },
            { label: 'Dosya yöneticisinde aç', icon: 'external', action: function () { nativeApi().open_in_file_manager(rootDir()); } },
            { separator: true },
            { label: 'Yenile', icon: 'sync', action: refreshExplorer },
            { label: 'Tüm klasörleri kapat', icon: 'collapse', action: function () { openDirs.clear(); refreshExplorer(); } }
        ];
    }

    root.document.addEventListener('contextmenu', function (e) { menuAt = { x: e.clientX, y: e.clientY }; }, true);

    root.Notes = {
        createFolder: createFolder, renameFolder: renameFolder, trashFolder: trashFolder, move: move, pickMove: pickMove,
        folderMenuItems: folderMenuItems, rootMenuItems: rootMenuItems,
        hooks: hooks, fold: fold, noteName: noteName, pathUnder: pathUnder, open: open,
        create: create, createAndOpen: createAndOpen, today: today, settle: settle,
        rename: rename, trash: trash, menuItems: menuItems,
        isPinned: isPinned, togglePin: togglePin, setPinned: setPinned,
        pins: function () { return pinned.slice(); }, renderPins: renderPins
    };
})(globalThis);
