/**
 * Telefon arayüzü (Android).
 *
 * Masaüstü arayüzünün (app.js) üstüne oturur; yalnız Android'de çalışır.
 * <html class="mobile"> koyar (görünüm: mobile.css), üst bara menü/mod/⋮
 * düğmelerini, alta gezinme çubuğunu ekler, kenar çubuğunu soldan kayan
 * çekmeceye çevirir. app.js'e dokunmaz: onun fonksiyonlarını çağırır.
 *
 * Android'e özgü işler (klasör/dosya seçici, depolama izni, bağlantı açma,
 * yazdırma, sistem çubuğu rengi, geri tuşu) MainActivity'nin verdiği
 * `MDFlowAndroid` nesnesinden geçer; MainActivity de sonuçları
 * `MDFlowMobile.emit(olay, veri)` ile geri bildirir.
 */
(function (root) {
    'use strict';

    if (!/Android/i.test(root.navigator.userAgent)) return;
    var doc = root.document;
    var html = doc.documentElement;
    html.classList.add('mobile');
    // Ayarlar yüklenene kadar son kullanılan tema görünsün (açılışta renk sıçramasın).
    try {
        var lastTheme = root.localStorage.getItem('md_mobile_theme');
        if (lastTheme) html.setAttribute('data-theme', lastTheme);
    } catch (e) { /* depolama kapalı: varsayılan tema */ }

    var android = root.MDFlowAndroid || null;
    var waiters = {};       // olay -> bekleyen çözücü (aynı anda tek istek)
    var listeners = {};     // olay -> kalıcı dinleyici

    function once(event) {
        return new Promise(function (resolve) {
            if (waiters[event]) waiters[event](null);
            waiters[event] = resolve;
        });
    }

    var api = {
        /** MainActivity'den gelen olay. */
        emit: function (event, data) {
            var w = waiters[event];
            if (w) {
                delete waiters[event];
                w(data);
            } else if (listeners[event]) {
                listeners[event](data);
            }
        },
        /** Geri tuşu: açık bir şey kapatıldıysa true (false → önceki not / uygulamadan çık). */
        back: function () { return false; }
    };
    root.MDFlowMobile = api;

    function icon(body, size) {
        return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
    }
    var ICON = {
        menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
        more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
        edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
        read: '<path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H10a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H2z"/><path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H14a2 2 0 0 0-2 2v15a2 2 0 0 1 2-2h8z"/>',
        back: '<polyline points="15 18 9 12 15 6"/>',
        forward: '<polyline points="9 18 15 12 9 6"/>',
        plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
        search: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
        toc: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
        folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
        clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
        recentFolder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 11 12 14 14 15"/>',
        palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.6-9-7.6z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>',
        print: '<polyline points="6 9 6 3 18 3 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
        note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
        newNote: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/>',
        target: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="10 11 13 14 10 17"/>',
        share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><line x1="8.4" y1="10.7" x2="15.6" y2="6.4"/><line x1="8.4" y1="13.3" x2="15.6" y2="17.6"/>',
        trash: '<polyline points="4 7 20 7"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
        copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4V4h11v1"/>',
        day: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
        heading: '<path d="M6 5v14"/><path d="M18 5v14"/><path d="M6 12h12"/>',
        bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
        italic: '<line x1="10" y1="5" x2="17" y2="5"/><line x1="7" y1="19" x2="14" y2="19"/><line x1="14" y1="5" x2="10" y2="19"/>',
        strike: '<line x1="4" y1="12" x2="20" y2="12"/><path d="M16.5 7.5C16 6 14.5 5 12 5 9 5 7.5 6.5 7.5 8.3"/><path d="M7.5 16c.5 2 2 3 4.5 3 3 0 4.7-1.5 4.7-3.5"/>',
        bullet: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
        number: '<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 4.5 5.5 4v5"/><path d="M4 15.2c2.5-1 3 1 0 4h3"/>',
        task: '<rect x="4" y="4" width="16" height="16" rx="3"/><polyline points="8 12.5 11 15.5 16.5 9"/>',
        quote: '<line x1="5" y1="5" x2="5" y2="19"/><line x1="10" y1="8" x2="20" y2="8"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="16" x2="16" y2="16"/>',
        code: '<polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/>',
        link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
        wikilink: '<path d="M8 4H4v16h4"/><path d="M16 4h4v16h-4"/><line x1="9" y1="12" x2="15" y2="12"/>',
        indent: '<line x1="11" y1="6" x2="20" y2="6"/><line x1="11" y1="12" x2="20" y2="12"/><line x1="11" y1="18" x2="20" y2="18"/><polyline points="4 9 7 12 4 15"/>',
        outdent: '<line x1="11" y1="6" x2="20" y2="6"/><line x1="11" y1="12" x2="20" y2="12"/><line x1="11" y1="18" x2="20" y2="18"/><polyline points="7 9 4 12 7 15"/>',
        undo: '<polyline points="8 5 4 9 8 13"/><path d="M4 9h10a5.5 5.5 0 0 1 0 11h-3"/>',
        redo: '<polyline points="16 5 20 9 16 13"/><path d="M20 9H10a5.5 5.5 0 0 0 0 11h3"/>',
        done: '<polyline points="5 12.5 10 17.5 19 7"/>',
        chevron: '<polyline points="6 9 12 15 18 9"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
    };

    function button(id, name, label, onClick, size) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.id = id;
        b.className = 'm-btn';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.innerHTML = icon(ICON[name], size);
        b.addEventListener('click', onClick);
        return b;
    }

    // Türkçe harf duyarsız karşılaştırma (I/İ/ı/i tek harf sayılır).
    function fold(s) {
        return String(s).toLocaleLowerCase('tr').replace(/ı/g, 'i');
    }

    // Alttan açılan menü: app.js'in showContextMenu'sunu kullanır, sonra
    // satırlara ikon (item.icon) ya da tema önizlemesi (item.swatch) ve
    // isteğe bağlı bir başlık ekler.
    function sheet(title, items) {
        showContextMenu(0, 0, items);
        var menu = contextMenuEl;
        if (!menu) return;
        var rows = menu.querySelectorAll('.context-menu-item');
        items.filter(function (it) { return !it.separator; }).forEach(function (it, i) {
            var row = rows[i];
            if (!row) return;
            if (it.swatch) {
                var sw = doc.createElement('span');
                sw.className = 'm-swatch';
                sw.style.setProperty('--sw-bg', it.swatch.bg);
                sw.style.setProperty('--sw-ac', it.swatch.ac);
                row.insertBefore(sw, row.firstChild);
            } else if (it.icon) {
                var ic = doc.createElement('span');
                ic.className = 'm-ico';
                ic.innerHTML = icon(ICON[it.icon], 22);
                row.insertBefore(ic, row.firstChild);
            }
            if (it.tile) row.classList.add('m-tile');
            if (it.danger) row.classList.add('m-danger');
            if (it.current) row.classList.add('m-current');
        });
        if (title) {
            var h = doc.createElement('div');
            h.className = 'm-menu-title';
            h.textContent = title;
            menu.insertBefore(h, menu.firstChild);
        }
    }

    // ------------------------------------------------------------------
    // Köprü: masaüstünde uygulamanın yaptığı işlerin Android karşılıkları
    // ------------------------------------------------------------------
    function invoke(name, args) {
        return root.__TAURI__.core.invoke(name, args || {});
    }

    async function ensureStorage() {
        if (!android) return false;
        if (android.hasStorageAccess()) return true;
        var ok = await UiDialog.confirm(
            'Telefondaki klasörleri ve notları açabilmek için "Tüm dosyalara erişim" izni gerekiyor.\n' +
            'Açılan ekranda MD Flow Viewer için izni açıp geri dönün.',
            { okText: 'İzin ver', cancelText: 'Vazgeç' });
        if (!ok) return false;
        var granted = once('storage');
        android.requestStorageAccess();
        if (await granted) return true;
        showToast('İzin verilmedi');
        return false;
    }

    // kind: 'file' | 'folder' → seçilen yerin gerçek yolu ya da null.
    async function pick(kind) {
        if (!(await ensureStorage())) return null;
        var picked = once('picked');
        if (kind === 'folder') android.pickFolder(); else android.pickFile();
        var result = await picked;
        if (!result) return null;
        if (result.error) {
            UiDialog.alert(result.error);
            return null;
        }
        if (result.copied) showToast('Kopyası açıldı: Notlar/Gelenler');
        return result.path || null;
    }

    var notesDir = null;

    function patchBridge() {
        var native = root.MDFlowNative;
        if (!native) return;

        native.open_folder = async function () {
            var path = await pick('folder');
            return path ? invoke('open_folder_path', { path: path }) : null;
        };
        native.open_file = async function () {
            var path = await pick('file');
            return path ? invoke('open_file_path', { path: path }) : null;
        };
        native.list_notes = function () { return invoke('list_notes'); };
        native.create_note = function (dir, name) { return invoke('create_note', { dir: dir, name: name }); };

        if (!android) return;
        native.open_external = function (url) { return Promise.resolve(android.openUrl(String(url))); };
        native.print_page = function () {
            android.print(doc.title || 'MD Flow Viewer');
            return Promise.resolve(true);
        };

        // "Birlikte aç" ile gelen dosya açılış belgesinin önüne geçer.
        var initialFile = native.initial_file;
        native.initial_file = async function () {
            notesDir = await invoke('notes_dir');
            var opened = takeIntentFile();
            if (opened) {
                var path = await invoke('open_file_path', { path: opened });
                if (path) return path;
            }
            return initialFile();
        };

        // İlk açılışta tema telefonun açık/koyu modunu izlesin.
        var getSettings = native.getSettings;
        native.getSettings = async function () {
            var d = await getSettings();
            if (d && d.settings && d.settings.theme === undefined && d.settings.followSystem === undefined) {
                d.settings.followSystem = true;
            }
            // Seçilmemişse telefonun kendi temaları (uygulama simgesinin renkleri)
            if (d && d.settings && d.settings.lightTheme === undefined) d.settings.lightTheme = 'oak-light';
            if (d && d.settings && d.settings.darkTheme === undefined) d.settings.darkTheme = 'lantern-dark';
            return d;
        };
    }

    function parseOpened(json) {
        try {
            var r = JSON.parse(json || '{}');
            if (r.copied && r.path) setTimeout(function () { showToast('Kopyası açıldı: Notlar/Gelenler'); }, 600);
            return r.path || '';
        } catch (e) {
            return '';
        }
    }

    function takeIntentFile() {
        return parseOpened(android.takeIntentFile(notesDir ? notesDir + '/Gelenler' : ''));
    }

    // ------------------------------------------------------------------
    // Çekmece (kenar çubuğu): açık ⇔ .collapsed yok. app.js klasör açınca ya
    // da klasör bağlantısına gidince sınıfı kendisi kaldırır; çekmece açılır.
    // ------------------------------------------------------------------
    var drawerPlace = null;     // çekmece başlığının altındaki klasör adı

    function drawerOpen() { return !sidebar.classList.contains('collapsed'); }
    function openDrawer(tab) {
        if (tab) setSidebarTab(tab, false);
        if (doc.activeElement && doc.activeElement.blur) doc.activeElement.blur();
        if (drawerPlace) drawerPlace.textContent = placeName(explorerState && explorerState.root);
        sidebar.classList.remove('collapsed');
    }
    function closeDrawer() { sidebar.classList.add('collapsed'); }

    function buildDrawer() {
        closeDrawer();

        var head = doc.createElement('div');
        head.className = 'm-drawer-head';
        var brand = doc.createElement('div');
        brand.className = 'm-brand';
        brand.innerHTML = '<img src="logo-mobile.png" alt=""><span><b>MD Flow</b><small></small></span>';
        drawerPlace = brand.querySelector('small');
        head.appendChild(brand);
        head.appendChild(button('m-settings', 'gear', 'Ayarlar', function () {
            closeDrawer();
            openSettingsPanel();
        }, 20));
        sidebar.insertBefore(head, sidebar.firstChild);

        var find = doc.createElement('button');
        find.type = 'button';
        find.className = 'm-drawer-find';
        find.innerHTML = icon(ICON.search, 18) + '<span>Notlarda ara</span>';
        find.addEventListener('click', function () { closeDrawer(); openSwitcher(); });
        head.insertAdjacentElement('afterend', find);

        var foot = doc.createElement('div');
        foot.className = 'm-drawer-foot';
        [
            ['folder', 'Klasör aç', openFolderDialog],
            ['file', 'Dosya aç', openFileDialog],
            ['home', 'Notlarım', function () { if (notesDir) openWorkspacePath(notesDir); }]
        ].forEach(function (item) {
            var b = doc.createElement('button');
            b.type = 'button';
            b.innerHTML = icon(ICON[item[0]], 20) + '<span>' + item[1] + '</span>';
            b.addEventListener('click', function () {
                closeDrawer();
                item[2]();
            });
            foot.appendChild(b);
        });
        sidebar.appendChild(foot);

        var scrim = doc.createElement('div');
        scrim.id = 'm-scrim';
        scrim.addEventListener('click', closeDrawer);
        sidebar.parentNode.insertBefore(scrim, sidebar.nextSibling);

        // Ağaçta not adları uzantısız görünür.
        function trimNames() {
            explorerTree.querySelectorAll('.tree-file > span').forEach(function (el) {
                var name = el.textContent.replace(/\.(md|markdown)$/i, '');
                if (name !== el.textContent) el.textContent = name;
            });
        }
        new MutationObserver(trimNames).observe(explorerTree, { childList: true, subtree: true });
        trimNames();

        // Not ya da başlık seçilince çekmece kapanır.
        explorerTree.addEventListener('click', function (e) {
            if (e.target.closest('.tree-file')) closeDrawer();
        });
        tocList.addEventListener('click', function (e) {
            if (e.target.closest('.toc-link')) closeDrawer();
        });

        // Nota uzun basış: not menüsü (app.js'in masaüstü menüsünün yerine)
        explorerTree.addEventListener('contextmenu', function (e) {
            var row = e.target.closest('.tree-file');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            openNoteMenu(row.getAttribute('data-path'));
        }, true);

        // Klasöre uzun basış: masaüstündeki üçlü tıklamanın karşılığı.
        explorerTree.addEventListener('contextmenu', function (e) {
            var row = e.target.closest('.tree-dir');
            if (!row) return;
            e.preventDefault();
            var path = row.getAttribute('data-path');
            var items = [{ label: 'Buraya yeni not', icon: 'newNote', action: function () { newNote(path); } }];
            if (explorerState && !explorerState.locked) {
                items.push({ label: 'Bu klasörü kök yap', icon: 'target', hint: path, action: function () { explorerEnter(path); } });
            }
            sheet(basename(path), items);
        });

        // Okuma alanında sağa kaydır: çekmece açılır; çekmecede sola kaydır: kapanır.
        var start = null;
        doc.addEventListener('touchstart', function (e) {
            start = null;
            if (e.touches.length !== 1 || doc.querySelector('.m-sheet, .img-zoom, .ui-dialog-backdrop, .context-menu')) return;
            if (!settingsPanel.classList.contains('hidden')) return;
            var t = e.touches[0];
            start = { x: t.clientX, y: t.clientY, at: Date.now(), free: !scrollsSideways(e.target) };
        }, { passive: true });
        doc.addEventListener('touchend', function (e) {
            if (!start) return;
            var t = e.changedTouches[0];
            var dx = t.clientX - start.x;
            var dy = t.clientY - start.y;
            var quick = Date.now() - start.at < 600 && Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5;
            var s = start;
            start = null;
            if (!quick) return;
            var selecting = root.getSelection && String(root.getSelection()).length > 0;
            if (dx < 0 && drawerOpen()) closeDrawer();
            else if (dx > 0 && !drawerOpen() && s.free && !selecting) openDrawer();
        }, { passive: true });
    }

    // Dokunulan öğe (ya da bir üstü) yatay kaydırılıyorsa hareket ona aittir.
    function scrollsSideways(el) {
        for (; el && el !== doc.body; el = el.parentElement) {
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return true;
            if (el.scrollWidth > el.clientWidth + 4) {
                var ox = root.getComputedStyle(el).overflowX;
                if (ox === 'auto' || ox === 'scroll') return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------
    // Üst bar ve alt bar
    // ------------------------------------------------------------------
    var modeBtn = null;

    function syncMode() {
        modeBtn.innerHTML = icon(ICON[isEditMode ? 'read' : 'edit']);
        var label = isEditMode ? 'Okuma moduna geç' : 'Düzenle';
        modeBtn.title = label;
        modeBtn.setAttribute('aria-label', label);
        modeBtn.classList.toggle('active', isEditMode);
        html.classList.toggle('m-editing', isEditMode);
    }

    // Klasörün kullanıcıya gösterilen adı: uygulamanın not klasörü "Notlarım".
    function placeName(dir) {
        if (!dir) return '';
        if (notesDir && normPath(dir) === normPath(notesDir)) return 'Notlarım';
        if (notesDir && pathUnder(dir, notesDir)) return 'Notlarım' + normPath(dir).slice(normPath(notesDir).length);
        return basename(dir) || dir;
    }

    // Üst bardaki başlık: üstte klasör, altta uzantısız not adı. app.js
    // #file-name-display'i yazmaya devam eder; burada ondan türetilir.
    var titleEl = null;
    var crumbEl = null;
    function syncTitle() {
        var name = fileNameDisplay.textContent || '';
        titleEl.textContent = name.replace(/\.(md|markdown)$/i, '');
        crumbEl.textContent = currentFilePath ? placeName(dirname(currentFilePath)) : '';
    }

    function buildTitle() {
        crumbEl = doc.createElement('span');
        crumbEl.className = 'm-crumb';
        var title = doc.createElement('span');
        title.className = 'm-title';
        titleEl = doc.createElement('span');
        title.appendChild(titleEl);
        title.insertAdjacentHTML('beforeend', icon(ICON.chevron, 16));
        currentFileBadge.appendChild(crumbEl);
        currentFileBadge.appendChild(title);
        new MutationObserver(syncTitle).observe(fileNameDisplay, { childList: true, characterData: true, subtree: true });
        syncTitle();
    }

    // Okuma ilerlemesi ve kaydırınca beliren üst bar çizgisi
    function trackScroll() {
        var header = doc.querySelector('.app-header');
        var bar = doc.createElement('div');
        bar.id = 'm-progress';
        header.appendChild(bar);
        var pane = doc.querySelector('.read-pane');
        var queued = false;
        function update() {
            queued = false;
            var max = pane.scrollHeight - pane.clientHeight;
            var top = pane.scrollTop;
            html.classList.toggle('m-scrolled', top > 4);
            html.style.setProperty('--m-read', max > 40 ? Math.min(1, top / max).toFixed(4) : '0');
        }
        pane.addEventListener('scroll', function () {
            if (!queued) { queued = true; root.requestAnimationFrame(update); }
        }, { passive: true });
        new MutationObserver(function () { root.requestAnimationFrame(update); })
            .observe(pane, { childList: true, subtree: false });
        root.addEventListener('resize', update);
        update();
    }

    function setFindOpen(open) {
        html.classList.toggle('m-find', open);
        if (open) {
            findInput.focus();
            findInput.select();
        } else {
            clearFind(true);
            findInput.blur();
        }
    }

    // Not içi aramadan gelindi: eşleşme notta da boyalı görünsün.
    function showFind(query) {
        html.classList.add('m-find');
        findInput.value = query;
        runFind(0, true);
    }

    function buildBars() {
        var left = doc.querySelector('.header-left');
        var center = doc.querySelector('.header-center');
        var right = doc.querySelector('.header-right');

        left.appendChild(button('m-menu', 'menu', 'Menü', function () { openDrawer(); }));
        center.insertBefore(button('m-find-close', 'back', 'Aramayı kapat', function () { setFindOpen(false); }), center.firstChild);
        currentFileBadge.addEventListener('click', openSwitcher);
        buildTitle();
        trackScroll();

        modeBtn = button('m-mode', 'edit', 'Düzenle', function () {
            (isEditMode ? btnReadMode : btnEditMode).click();
        });
        right.appendChild(modeBtn);
        right.appendChild(button('m-more', 'more', 'Diğer', openMoreMenu));
        // Mod başka yoldan da değişir (geri tuşu, yazdırma): düğmeyi app.js'in
        // tıklama işleyicisi bittikten sonra eşitle.
        [btnReadMode, btnEditMode].forEach(function (b) {
            b.addEventListener('click', function () { setTimeout(syncMode, 0); });
        });
        syncMode();

        var bar = doc.createElement('nav');
        bar.id = 'm-bar';
        bar.appendChild(button('m-back', 'back', 'Geri', function () { navigateHistory(-1); }));
        bar.appendChild(button('m-forward', 'forward', 'İleri', function () { navigateHistory(1); }));
        bar.appendChild(button('m-new', 'plus', 'Yeni not', function () { newNote(); }, 26));
        bar.appendChild(button('m-find', 'search', 'Sayfada ara', function () { setFindOpen(true); }));
        bar.appendChild(button('m-toc', 'toc', 'İçindekiler', function () { openDrawer('toc'); }));
        doc.querySelector('.app-container').appendChild(bar);

        // Klavye açılınca görünüm kısalır: alt bar yerini yazıya bırakır.
        var full = root.innerHeight;
        function onResize() {
            if (root.innerHeight > full) full = root.innerHeight;
            html.classList.toggle('m-kbd', root.innerHeight < full - 140);
        }
        root.addEventListener('resize', onResize);
        if (root.visualViewport) root.visualViewport.addEventListener('resize', onResize);
    }

    function openMoreMenu() {
        var recentAnchor = doc.getElementById('m-more');
        sheet(null, [
            { label: 'Yeni not', icon: 'newNote', tile: true, action: function () { newNote(); } },
            { label: 'Not ara', icon: 'search', tile: true, action: openSwitcher },
            { label: 'Bugün', icon: 'day', tile: true, action: openToday },
            { label: 'Tema', icon: 'palette', tile: true, action: openThemeMenu },
            { separator: true },
            { label: 'Bu not', icon: 'note', hint: 'Paylaş, yeniden adlandır, sil', action: function () { openNoteMenu(currentFilePath); } },
            { label: 'Klasör aç', icon: 'folder', action: openFolderDialog },
            { label: 'Dosya aç', icon: 'file', action: openFileDialog },
            { label: 'Son açılan dosyalar', icon: 'clock', action: function () { showRecentMenu('file', recentAnchor); } },
            { label: 'Son açılan klasörler', icon: 'recentFolder', action: function () { showRecentMenu('folder', recentAnchor); } },
            { separator: true },
            { label: 'Yazdır / PDF', icon: 'print', action: exportToPdf },
            { label: 'Ayarlar', icon: 'gear', action: openSettingsPanel }
        ]);
    }

    function openThemeMenu() {
        sheet('Tema', THEMES.map(function (t) {
            return {
                label: t.name,
                swatch: { bg: t.bg, ac: t.ac },
                current: t.id === currentTheme,
                action: function () { chooseTheme(t.id); }
            };
        }));
    }

    // ------------------------------------------------------------------
    // Yeni not
    // ------------------------------------------------------------------
    function promptText(message, placeholder, okText, value) {
        return new Promise(function (resolve) {
            var backdrop = doc.createElement('div');
            backdrop.className = 'ui-dialog-backdrop m-prompt';
            var box = doc.createElement('div');
            box.className = 'ui-dialog';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            var text = doc.createElement('p');
            text.className = 'ui-dialog-message';
            text.style.marginBottom = '0.75rem';
            text.textContent = message;
            var input = doc.createElement('input');
            input.type = 'text';
            input.className = 'm-prompt-input';
            input.placeholder = placeholder || '';
            input.value = value || '';
            input.autocomplete = 'off';
            input.enterKeyHint = 'done';
            var actions = doc.createElement('div');
            actions.className = 'ui-dialog-actions';
            var cancel = doc.createElement('button');
            cancel.type = 'button';
            cancel.className = 'ui-dialog-btn';
            cancel.textContent = 'Vazgeç';
            var ok = doc.createElement('button');
            ok.type = 'button';
            ok.className = 'ui-dialog-btn primary';
            ok.textContent = okText || 'Tamam';
            actions.appendChild(cancel);
            actions.appendChild(ok);
            box.appendChild(text);
            box.appendChild(input);
            box.appendChild(actions);
            backdrop.appendChild(box);

            function finish(value) {
                backdrop.remove();
                resolve(value);
            }
            backdrop.cancel = function () { finish(null); };
            cancel.addEventListener('click', backdrop.cancel);
            ok.addEventListener('click', function () { finish(input.value); });
            input.addEventListener('keydown', function (e) {
                e.stopPropagation();
                if (e.key === 'Enter') finish(input.value);
                else if (e.key === 'Escape') finish(null);
            });
            doc.body.appendChild(backdrop);
            input.focus();
            input.select();
        });
    }

    function pathUnder(path, dir) {
        var p = normPath(path);
        var d = normPath(dir);
        return p === d || p.indexOf(d + '/') === 0;
    }

    // dir verilmezse: açık notun klasörü (gezgin kökünün altındaysa), yoksa gezgin kökü.
    // text verilirse (paylaşılan metin) not onunla başlar.
    async function newNote(dir, suggested, text) {
        var native = nativeApi();
        var rootDir = explorerState && explorerState.root;
        if (!native || !rootDir) {
            showToast('Önce bir klasör açın');
            return;
        }
        if (!dir) {
            var here = currentFilePath ? dirname(currentFilePath) : '';
            dir = here && pathUnder(here, rootDir) ? here : rootDir;
        }
        var name = await promptText('Yeni not · ' + placeName(dir), 'Not adı', 'Oluştur', suggested);
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
        closeDrawer();
        applyExplorerState(explorerState);      // ağaç yeni notu göstersin
        await loadFile(result.path);
        if (!text && !isEditMode) btnEditMode.click();
    }

    // Günün notu: gezgin kökünde YYYY-AA-GG.md; yoksa oluşturulur.
    async function openToday() {
        var native = nativeApi();
        var rootDir = explorerState && explorerState.root;
        if (!native || !rootDir) {
            showToast('Önce bir klasör açın');
            return;
        }
        var d = new Date();
        var name = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
        var path = rootDir + '/' + name + '.md';
        if (path === currentFilePath || !(await confirmLeaveUnsaved())) return;
        var there = await native.inspect_path(path);
        closeDrawer();
        if (there && there.type === 'file') await loadFile(path);
        else await createAndOpen(rootDir, name);
    }

    // ------------------------------------------------------------------
    // Not menüsü: paylaş, yeniden adlandır, sil
    // ------------------------------------------------------------------
    function noteName(path) { return basename(path).replace(/\.(md|markdown)$/i, ''); }

    function openNoteMenu(path) {
        if (!path) {
            showToast('Açık not yok');
            return;
        }
        var items = [];
        if (android) {
            items.push({ label: 'Metin olarak paylaş', icon: 'share', action: function () { shareNote(path, false); } });
            items.push({ label: 'Dosya olarak paylaş', icon: 'file', action: function () { shareNote(path, true); } });
        }
        items.push(
            { label: 'Yeniden adlandır', icon: 'edit', action: function () { renameNote(path); } },
            { label: 'Tam yolu kopyala', icon: 'copy', hint: path, action: async function () {
                showToast((await copyToClipboard(path)) ? 'Yol kopyalandı' : 'Panoya kopyalanamadı');
            } },
            { separator: true },
            { label: 'Sil', icon: 'trash', danger: true, hint: 'Klasördeki .trash içine taşınır', action: function () { trashNote(path); } }
        );
        sheet(noteName(path), items);
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

    async function shareNote(path, asFile) {
        if (!(await settle(path))) return;
        var data = await nativeApi().content(path);
        if (!data || !data.success) {
            UiDialog.alert((data && data.error) || 'Not okunamadı.');
            return;
        }
        var error = android.shareNote(basename(path), data.content, asFile);
        if (error) UiDialog.alert(error);
    }

    async function renameNote(path) {
        var name = await promptText('Yeniden adlandır', 'Not adı', 'Kaydet', noteName(path));
        if (name === null || !name.trim() || name.trim() === noteName(path)) return;
        if (!(await settle(path))) return;
        var r = await invoke('rename_note', { path: path, name: name });
        if (!r || !r.success) {
            UiDialog.alert('Yeniden adlandırılamadı: ' + ((r && r.error) || 'bilinmeyen hata'));
            return;
        }
        applyExplorerState(explorerState);
        if (path === currentFilePath) await loadFile(r.path, { replaceHistory: true });
        showToast('Yeni ad: ' + noteName(r.path));
    }

    async function trashNote(path) {
        if (!(await UiDialog.confirm('"' + noteName(path) + '" silinsin mi? Not, bulunduğu klasördeki gizli .trash klasörüne taşınır.',
            { okText: 'Sil', cancelText: 'Vazgeç' }))) return;
        if (!(await settle(path))) return;
        var r = await invoke('trash_note', { path: path });
        if (!r || !r.success) {
            UiDialog.alert('Silinemedi: ' + ((r && r.error) || 'bilinmeyen hata'));
            return;
        }
        applyExplorerState(explorerState);
        showToast('Not silindi');
        if (path !== currentFilePath) return;
        if (isEditMode) btnReadMode.click();
        var recents = ((await nativeApi().recent_list()) || {}).files || [];
        var next = recents.length ? await nativeApi().open_file_path(recents[0]) : null;
        await loadFile(next || '', { replaceHistory: true });
    }

    // ------------------------------------------------------------------
    // Biçim çubuğu: bir blok yazılırken klavyenin üstünde durur
    // ------------------------------------------------------------------
    // Değişikliği tarayıcının geri alma yığınına giren tek bir ekleme yapar.
    function replaceText(ta, next) {
        var old = ta.value;
        if (next.text !== old) {
            var a = 0;
            var max = Math.min(old.length, next.text.length);
            while (a < max && old.charCodeAt(a) === next.text.charCodeAt(a)) a++;
            var b = 0;
            while (b < max - a && old.charCodeAt(old.length - 1 - b) === next.text.charCodeAt(next.text.length - 1 - b)) b++;
            var ins = next.text.slice(a, next.text.length - b);
            ta.setSelectionRange(a, old.length - b);
            var ok = ins ? doc.execCommand('insertText', false, ins) : doc.execCommand('delete');
            if (!ok) {
                ta.setRangeText(ins, a, old.length - b, 'end');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        ta.setSelectionRange(next.start, next.end);
    }

    function buildFormatBar() {
        var bar = doc.createElement('div');
        bar.id = 'm-format';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Biçim');
        var target = null;

        [
            ['undo', 'Geri al'], ['redo', 'Yinele'],
            ['heading', 'Başlık'], ['bold', 'Kalın'], ['italic', 'İtalik'], ['strike', 'Üstü çizili'],
            ['bullet', 'Madde'], ['number', 'Numaralı liste'], ['task', 'Görev'], ['quote', 'Alıntı'],
            ['indent', 'Girinti artır'], ['outdent', 'Girinti azalt'],
            ['link', 'Bağlantı'], ['wikilink', 'Not bağlantısı'], ['code', 'Kod']
        ].forEach(function (item) {
            var name = item[0];
            bar.appendChild(button('m-fmt-' + name, name, item[1], function () {
                if (!target) return;
                target.focus();
                if (name === 'undo' || name === 'redo') doc.execCommand(name);
                else replaceText(target, MdFormat.apply(name, target.value, target.selectionStart, target.selectionEnd));
            }, 20));
        });
        bar.appendChild(button('m-fmt-done', 'done', 'Bitti', function () { if (target) target.blur(); }, 20));
        // Dokunuş odağı yazıdan almasın (odak giderse blok kapanır, klavye iner).
        // click yine gelir; touchstart'a dokunulmaz ki çubuk yatay kaydırılabilsin.
        bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
        doc.querySelector('.app-container').appendChild(bar);

        inlineEditor.addEventListener('focusin', function (e) {
            if (!e.target.classList.contains('block-textarea')) return;
            target = e.target;
            html.classList.add('m-format');
        });
        inlineEditor.addEventListener('focusout', function (e) {
            if (e.target !== target) return;
            target = null;
            html.classList.remove('m-format');
        });
        // Listede Enter: maddeyi sürdür
        inlineEditor.addEventListener('beforeinput', function (e) {
            var ta = e.target;
            if (e.inputType !== 'insertLineBreak' || !ta.classList.contains('block-textarea')) return;
            if (ta.selectionStart !== ta.selectionEnd) return;
            var next = MdFormat.newline(ta.value, ta.selectionStart);
            if (!next) return;
            e.preventDefault();
            replaceText(ta, next);
        });
    }

    // ------------------------------------------------------------------
    // Okurken görev kutusuna dokun: kaynakta [ ] ⇔ [x] çevrilir ve kaydedilir
    // ------------------------------------------------------------------
    function enableTasks() {
        var saving = Promise.resolve();
        var selector = 'input[type="checkbox"]';
        function unlock() {
            markdownViewer.querySelectorAll(selector).forEach(function (c) { c.disabled = !currentFilePath; });
        }
        new MutationObserver(unlock).observe(markdownViewer, { childList: true, subtree: true });
        unlock();

        markdownViewer.addEventListener('change', function (e) {
            var box = e.target;
            if (!box.matches || !box.matches(selector)) return;
            var boxes = Array.from(markdownViewer.querySelectorAll(selector));
            var index = boxes.indexOf(box);
            var shown = boxes.map(function (b) { return b === box ? !b.checked : b.checked; });
            var next = MdFormat.toggleTask(currentContent, index, shown);
            if (next === null) {
                box.checked = !box.checked;
                showToast('Bu kutu yalnız düzenleme modunda değiştirilebilir');
                return;
            }
            // Bellek hemen, disk sırayla: hızlı dokunuşlar birbirini ezmesin.
            var path = currentFilePath;
            currentContent = next;
            markUnsaved();
            saving = saving.then(async function () {
                if (path !== currentFilePath || !hasUnsavedChanges) return;
                var content = currentContent;
                await saveFile(content);
                if (hasUnsavedChanges) {
                    showToast('Kaydedilemedi');
                    markSaved();
                    await loadFile(path, { pushHistory: false });
                }
            });
        });
    }
    // ------------------------------------------------------------------
    // Hızlı geçiş: gezgin kökündeki bütün notlar arasında ada göre arama
    // ------------------------------------------------------------------
    var switcher = null;

    function closeSwitcher() {
        if (switcher) switcher.remove();
        switcher = null;
    }

    async function openSwitcher() {
        var native = nativeApi();
        if (!native || switcher) return;
        if (doc.activeElement && doc.activeElement.blur) doc.activeElement.blur();

        var sheet = doc.createElement('div');
        sheet.className = 'm-sheet';
        var head = doc.createElement('div');
        head.className = 'm-sheet-head';
        head.appendChild(button('m-switch-close', 'back', 'Kapat', closeSwitcher));
        var input = doc.createElement('input');
        input.type = 'search';
        input.placeholder = 'Not ara…';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.enterKeyHint = 'go';
        head.appendChild(input);
        var list = doc.createElement('div');
        list.className = 'm-sheet-list';
        sheet.appendChild(head);
        sheet.appendChild(list);
        doc.body.appendChild(sheet);
        switcher = sheet;

        var notes = [];
        var recents = [];
        try {
            var data = await Promise.all([native.list_notes(), native.recent_list()]);
            notes = (data[0] && data[0].files) || [];
            recents = ((data[1] && data[1].files) || []).map(function (p) {
                var dir = dirname(p);
                if (notesDir && pathUnder(dir, notesDir)) dir = 'Notlarım' + dir.slice(notesDir.length);
                return { name: basename(p), path: p, dir: dir, recent: true };
            });
        } catch (error) {
            console.error('Not listesi alınamadı:', error);
        }
        if (switcher !== sheet) return;
        notes.forEach(function (n) { n.key = fold(n.name.replace(/\.(md|markdown)$/i, '')); });

        function row(note) {
            var b = doc.createElement('button');
            b.type = 'button';
            b.className = 'm-note' + (note.path === currentFilePath ? ' current' : '');
            b.innerHTML = icon(note.recent ? ICON.clock : ICON.note, 20);
            var name = doc.createElement('span');
            name.textContent = note.name.replace(/\.(md|markdown)$/i, '');
            b.appendChild(name);
            if (note.dir) {
                var small = doc.createElement('small');
                small.textContent = note.dir;
                b.appendChild(small);
            }
            b.addEventListener('click', async function () {
                closeSwitcher();
                if (note.recent) {
                    openRecentFile(note.path);
                } else if (await confirmLeaveUnsaved()) {
                    await loadFile(note.path);
                    if (note.find && note.path === currentFilePath) showFind(note.find);
                }
            });
            return b;
        }
        function label(text) {
            var el = doc.createElement('div');
            el.className = 'm-sheet-label';
            el.textContent = text;
            return el;
        }

        // Not içi arama: yazma durunca; eski sorgunun geç gelen yanıtı atılır.
        var searchTimer = null;
        var searchGen = 0;
        var searchBox = null;
        function searchInside(query) {
            clearTimeout(searchTimer);
            var gen = ++searchGen;
            if (query.length < 2) return;
            searchTimer = setTimeout(async function () {
                var r = null;
                try { r = await invoke('search_notes', { query: query }); } catch (e) { console.error('Arama:', e); }
                if (gen !== searchGen || switcher !== sheet || !searchBox) return;
                var files = (r && r.files) || [];
                if (!files.length) return;
                var empty = list.querySelector('.empty-state');
                if (empty) empty.remove();
                searchBox.appendChild(label('Not içinde' + (r.truncated ? ' (ilk ' + files.length + ')' : '')));
                files.forEach(function (n) {
                    var b = row({ name: n.name, path: n.path, dir: n.snippet, find: query });
                    b.classList.add('m-hit');
                    searchBox.appendChild(b);
                });
            }, 220);
        }

        function render() {
            var q = fold(input.value.trim());
            list.innerHTML = '';
            searchBox = null;
            searchInside(input.value.trim());
            var shown = notes;
            if (q) {
                // Adı sorguyla başlayanlar önce, içinde geçenler sonra.
                var starts = [];
                var contains = [];
                notes.forEach(function (n) {
                    var i = n.key.indexOf(q);
                    if (i === 0) starts.push(n);
                    else if (i > 0 || fold(n.dir).indexOf(q) !== -1) contains.push(n);
                });
                shown = starts.concat(contains);
            } else if (recents.length) {
                list.appendChild(label('Son açılanlar'));
                recents.slice(0, 5).forEach(function (n) { list.appendChild(row(n)); });
                list.appendChild(label('Bütün notlar'));
            }
            shown.slice(0, 200).forEach(function (n) { list.appendChild(row(n)); });
            if (!shown.length) {
                var empty = doc.createElement('span');
                empty.className = 'empty-state';
                empty.textContent = q ? 'Eşleşen not yok' : 'Bu klasörde not yok';
                list.appendChild(empty);
            }
            searchBox = doc.createElement('div');
            list.appendChild(searchBox);
        }

        input.addEventListener('input', render);
        input.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Enter') {
                var first = list.querySelector('.m-note');
                if (first) first.click();
            }
        });
        render();
        input.focus();
    }

    // ------------------------------------------------------------------
    // Başka uygulamadan paylaşılan metin ve ana ekran kısayolları
    // ------------------------------------------------------------------
    function runAction(a) {
        if (!a || !a.action) return;
        closeSwitcher();
        closeDrawer();
        if (a.action === 'new') newNote();
        else if (a.action === 'today') openToday();
        else if (a.action === 'search') openSwitcher();
        else if (a.action === 'share' && a.text) {
            var first = String(a.subject || a.text.split('\n')[0]).replace(/^#+\s*/, '').trim().slice(0, 60);
            newNote(null, /^https?:/.test(first) ? 'Bağlantı' : first, a.text);
        }
    }

    // Açılıştaki eylem gezgin hazır olunca çalışır.
    function runPendingAction() {
        if (!android || !android.takeAction) return;
        var a = {};
        try { a = JSON.parse(android.takeAction() || '{}'); } catch (e) { return; }
        if (!a.action) return;
        var tries = 0;
        (function wait() {
            if (explorerState && explorerState.root) runAction(a);
            else if (tries++ < 50) setTimeout(wait, 100);
        })();
    }

    /** Güncelleme (updater.js): doğrulanmış APK'yı sistem kurulumuna verir. */
    api.installUpdate = async function (result) {
        if (!android) return true;
        if (!android.canInstall()) {
            var ok = await UiDialog.confirm('Güncellemeyi kurabilmek için MD Flow Viewer\'a "bilinmeyen uygulama yükleme" izni gerekiyor.',
                { okText: 'İzin ver', cancelText: 'Vazgeç' });
            if (!ok) return false;
            var granted = once('install-permission');
            android.requestInstall();
            if (!(await granted)) return false;
        }
        var error = android.installApk(result.path);
        if (error) UiDialog.alert(error);
        return false;       // kurulum ekranı kapatılırsa kart "Kur" ile kalsın
    };

    // ------------------------------------------------------------------
    // Geri tuşu, sistem çubuğu rengi, menü dışına dokunma
    // ------------------------------------------------------------------
    function pressEscape() {
        doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }

    api.back = function () {
        var prompt = doc.querySelector('.m-prompt');
        if (prompt) { prompt.cancel(); return true; }
        if (doc.querySelector('.ui-dialog-backdrop, .img-zoom')) { pressEscape(); return true; }
        if (contextMenuEl) { hideContextMenu(); return true; }
        if (switcher) { closeSwitcher(); return true; }
        if (!settingsPanel.classList.contains('hidden')) { closeSettingsPanel(); return true; }
        if (html.classList.contains('m-find')) { setFindOpen(false); return true; }
        if (drawerOpen()) { closeDrawer(); return true; }
        if (isEditMode) { btnReadMode.click(); return true; }
        return false;
    };

    // Durum ve gezinme çubuğu sayfa zeminiyle aynı renkte olsun.
    function syncChrome() {
        if (!android) return;
        var rgb = (root.getComputedStyle(doc.body).backgroundColor.match(/\d+/g) || []).slice(0, 3);
        if (rgb.length < 3) return;
        var hex = '#' + rgb.map(function (n) { return ('0' + Number(n).toString(16)).slice(-2); }).join('');
        android.setChrome(hex, currentTheme.slice(-5) === '-dark');
        try { root.localStorage.setItem('md_mobile_theme', currentTheme); } catch (e) { /* yut */ }
    }

    function guardMenus() {
        // Alttan açılan menünün dışına dokunmak yalnız menüyü kapatsın; aynı
        // dokunuş arkadaki bağlantıyı/düğmeyi de tetiklemesin.
        var swallow = false;
        doc.addEventListener('pointerdown', function (e) {
            swallow = !!(contextMenuEl && !contextMenuEl.contains(e.target));
        }, true);
        doc.addEventListener('click', function (e) {
            if (!swallow) return;
            swallow = false;
            e.stopPropagation();
            e.preventDefault();
        }, true);
        // Uzun menü kendi içinde kaydırılınca kapanmasın (app.js her kaydırmada kapatır).
        root.addEventListener('scroll', function (e) {
            if (contextMenuEl && e.target === contextMenuEl) e.stopPropagation();
        }, true);
    }

    function init() {
        patchBridge();
        buildDrawer();
        buildBars();
        buildFormatBar();
        enableTasks();
        guardMenus();
        runPendingAction();
        root.requestAnimationFrame(function () { html.classList.add('m-ready'); });

        new MutationObserver(syncChrome).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
        syncChrome();

        // Geri tuşu: önce açık panel, sonra önceki not, en son uygulama arka plana.
        root.__TAURI__.app.onBackButtonPress(function (e) {
            if (api.back()) return;
            if (e && e.canGoBack) root.history.back();
            else if (android) android.moveToBack();
        });

        // Uygulama açıkken "Birlikte aç" ile gelen dosya
        listeners.action = runAction;
        listeners.open = function (data) {
            var path = parseOpened(JSON.stringify(data || {}));
            if (!path) return;
            closeSwitcher();
            closeDrawer();
            openRecentFile(path);
        };
    }

    doc.addEventListener('DOMContentLoaded', init);
})(typeof globalThis !== 'undefined' ? globalThis : this);
