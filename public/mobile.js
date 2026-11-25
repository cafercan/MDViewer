/**
 * Telefon arayüzü (Android): not paneli → not → düzenleme.
 *
 * Masaüstü arayüzünün (app.js) üstüne oturur; yalnız Android'de çalışır.
 * <html class="mobile"> koyar (görünüm: mobile.css), kenar çubuğunu soldan
 * açılan not paneline çevirir (açık not sağda görünür); notta üst bar (menü,
 * ad, +, ⋮) ve kalem düğmesi durur. app.js'e dokunmaz: onun fonksiyonlarını çağırır.
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
        back: function () { return false; },
        /** Eşitleme (sync.js): klasör seçtirir, çalışma alanını değiştirmez. */
        pickFolderPath: function () { return pick('folder'); },
        /** Android 17+ yerel ağ izni; gerekmiyorsa true. */
        localNetwork: async function () {
            if (!android || !android.hasLocalNetwork || android.hasLocalNetwork()) return true;
            var granted = once('local-network');
            android.requestLocalNetwork();
            return !!(await granted);
        },
        hasLocalNetwork: function () { return !android || !android.hasLocalNetwork || !!android.hasLocalNetwork(); },
        deviceName: function () { return android && android.deviceName ? android.deviceName() : ''; }
    };
    root.MDFlowMobile = api;

    var icon = Icons.svg;
    var ICON = Icons.paths;

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
                if (path) { closeHome(); return path; }
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
    // Not paneli: açık ⇔ kenar çubuğunda .collapsed yok. app.js
    // klasör açınca sınıfı kendisi kaldırır; panel açılır.
    // ------------------------------------------------------------------
    var homeTitle = null;
    var fromHome = false;
    var depth = 0;              // listeden açılan nottan bağlantıyla kaç not ileri gidildi

    function homeOpen() { return !sidebar.classList.contains('collapsed'); }
    function syncHome() {
        if (homeTitle) homeTitle.textContent = placeName(explorerState && explorerState.root) || 'Notlar';
    }
    function openHome() {
        LiveEditor.blur();          // klavye insin; not düzenlemede kalabilir
        if (html.classList.contains('m-find')) setFindOpen(false);
        setSidebarTab('explorer', false);
        syncHome();
        sidebar.classList.remove('collapsed');
    }
    function closeHome() {
        if (homeOpen()) {
            depth = 0;
            fromHome = true;        // ardından açılan not listeden açılmış sayılır
            setTimeout(function () { fromHome = false; }, 1500);
        }
        sidebar.classList.add('collapsed');
    }

    function openPlaces() {
        var here = explorerState && explorerState.root;
        var items = [];
        if (notesDir && (!here || normPath(here) !== normPath(notesDir))) {
            items.push({ label: 'Notlarım', icon: 'home', hint: 'Uygulamanın klasörü', action: function () { openWorkspacePath(notesDir); } });
        }
        if (explorerState && explorerState.canUp) items.push({ label: 'Üst klasöre çık', icon: 'up', action: explorerGoUp });
        items.push(
            { label: 'Yeni klasör', icon: 'newFolder', action: function () { Notes.createFolder(); } },
            { label: 'Klasör aç', icon: 'openFolder', action: openFolderDialog },
            { label: 'Dosya aç', icon: 'openFile', action: openFileDialog },
            { label: 'Son klasörler', icon: 'recentFolder', action: function () { showRecentMenu('folder', doc.getElementById('m-place')); } },
            { label: 'Son notlar', icon: 'clock', action: function () { showRecentMenu('file', doc.getElementById('m-place')); } }
        );
        if (here) items.push({ label: explorerState.locked ? 'Sabitlemeyi kaldır' : 'Bu klasörü sabitle', icon: 'pin', hint: 'Not açınca klasör değişmez', action: explorerToggleLock });
        sheet(here ? placeName(here) : 'Klasör', items);
    }

    function buildHome() {
        sidebar.classList.remove('collapsed');

        var head = doc.createElement('div');
        head.className = 'm-home-head';
        var place = doc.createElement('button');
        place.type = 'button';
        place.id = 'm-place';
        place.innerHTML = '<span>Notlar</span>' + icon(ICON.chevron, 20);
        place.addEventListener('click', openPlaces);
        homeTitle = place.firstChild;
        head.appendChild(place);
        head.appendChild(button('m-today', 'day', 'Bugünün notu', Notes.today));
        head.appendChild(button('m-sync', 'sync', 'Bilgisayarla eşitle', function () {
            if (SyncUi.linked()) SyncUi.syncNow(true); else openSettingsPanel('sync');
        }));
        head.appendChild(button('m-settings', 'gear', 'Ayarlar', function () { openSettingsPanel(); }));
        sidebar.insertBefore(head, sidebar.firstChild);

        var find = doc.createElement('button');
        find.type = 'button';
        find.className = 'm-home-find';
        find.innerHTML = icon(ICON.search, 20) + '<span>Notlarda ara</span>';
        find.addEventListener('click', openSwitcher);
        var tools = doc.createElement('div');
        tools.className = 'm-home-tools';
        tools.appendChild(find);
        tools.appendChild(button('m-new-folder', 'newFolder', 'Yeni klasör', function () { Notes.createFolder(); }));
        head.insertAdjacentElement('afterend', tools);

        var scrim = doc.createElement('div');
        scrim.id = 'm-scrim';
        scrim.addEventListener('click', closeHome);
        sidebar.parentNode.insertBefore(scrim, sidebar.nextSibling);

        var add = button('m-new', 'plus', 'Yeni not', function () { Notes.create(explorerState && explorerState.root); }, 26);
        sidebar.appendChild(add);
        new MutationObserver(syncHome).observe(explorerRootLabel, { childList: true });
        setSidebarTab('explorer', false);

        // Ağaçta not adları uzantısız görünür.
        function trimNames() {
            explorerTree.querySelectorAll('.tree-file > span').forEach(function (el) {
                var name = el.textContent.replace(/\.(md|markdown)$/i, '');
                if (name !== el.textContent) el.textContent = name;
            });
        }
        new MutationObserver(trimNames).observe(explorerTree, { childList: true, subtree: true });
        trimNames();

        // Not seçilince liste yerini nota bırakır.
        explorerTree.addEventListener('click', function (e) {
            if (e.target.closest('.tree-file')) closeHome();
        });
        var pinnedList = doc.getElementById('pinned-list');
        pinnedList.addEventListener('click', function (e) {
            if (e.target.closest('.tree-file')) closeHome();
        });

        // Nota uzun basış: not menüsü (app.js'in masaüstü menüsünün yerine)
        function onHold(e) {
            var row = e.target.closest('.tree-file');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            var path = row.getAttribute('data-path');
            // Parmak kalkınca menü; kalkmadan sürüklenirse satır taşınır (organize.js).
            Organize.hold(row, function () { openNoteMenu(path); });
        }
        explorerTree.addEventListener('contextmenu', onHold, true);
        pinnedList.addEventListener('contextmenu', onHold, true);

        // Klasöre uzun basış: masaüstündeki üçlü tıklamanın karşılığı.
        explorerTree.addEventListener('contextmenu', function (e) {
            var row = e.target.closest('.tree-dir');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            var path = row.getAttribute('data-path');
            var items = [
                { label: 'Buraya yeni not', icon: 'newNote', action: function () { Notes.create(path); } },
                { label: 'Buraya yeni klasör', icon: 'newFolder', action: function () { Notes.createFolder(path); } },
                { label: 'Yeniden adlandır', icon: 'edit', action: function () { Notes.renameFolder(path); } },
                { label: 'Taşı', icon: 'move', action: function () { Notes.pickMove(path); } }
            ];
            if (explorerState && !explorerState.locked) {
                items.push({ label: 'Bu klasörü kök yap', icon: 'target', hint: path, action: function () { explorerEnter(path); } });
            }
            items.push({ separator: true }, { label: 'Sil', icon: 'trash', danger: true, hint: 'İçindekilerle .trash içine taşınır', action: function () { Notes.trashFolder(path); } });
            Organize.hold(row, function () { sheet(basename(path), items); });
        }, true);

        // Okurken sağa kaydır: panel açılır; panelde sola kaydır: kapanır.
        var start = null;
        doc.addEventListener('touchstart', function (e) {
            start = null;
            if ((isEditMode && !homeOpen()) || e.touches.length !== 1 || doc.querySelector('.m-sheet, .img-zoom, .ui-dialog-backdrop, .context-menu')) return;
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
            if (dx < 0 && homeOpen()) closeHome();
            else if (dx > 0 && !homeOpen() && s.free && !selecting) openHome();
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
    function syncMode() {
        html.classList.toggle('m-editing', isEditMode);
    }

    // Klasörün kullanıcıya gösterilen adı: uygulamanın not klasörü "Notlarım".
    function placeName(dir) {
        if (!dir) return '';
        if (notesDir && normPath(dir) === normPath(notesDir)) return 'Notlarım';
        if (notesDir && Notes.pathUnder(dir, notesDir)) return 'Notlarım' + normPath(dir).slice(normPath(notesDir).length);
        return basename(dir) || dir;
    }

    // Üst bardaki başlık: üstte klasör, altta uzantısız not adı. app.js
    // #file-name-display'i yazmaya devam eder; burada ondan türetilir.
    var titleEl = null;
    var crumbEl = null;
    var stepping = false;
    var shownPath = '';
    function syncTitle() {
        if (shownPath && currentFilePath !== shownPath) {
            if (!stepping && !fromHome && !homeOpen()) depth++;
            stepping = fromHome = false;
        }
        shownPath = currentFilePath;
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

        left.appendChild(button('m-home', 'menu', 'Notlar', openHome));
        center.insertBefore(button('m-find-close', 'back', 'Aramayı kapat', function () { setFindOpen(false); }), center.firstChild);
        currentFileBadge.addEventListener('click', function () { openNoteMenu(currentFilePath); });
        buildTitle();
        trackScroll();

        right.appendChild(button('m-done', 'done', 'Düzenlemeyi bitir', function () { btnReadMode.click(); }));
        right.appendChild(button('m-add', 'plus', 'Yeni not', function () { Notes.create(); }, 24));
        right.appendChild(button('m-more', 'more', 'Diğer', openMoreMenu));
        // Mod başka yoldan da değişir (geri tuşu, yazdırma): düğmeyi app.js'in
        // tıklama işleyicisi bittikten sonra eşitle.
        [btnReadMode, btnEditMode].forEach(function (b) {
            b.addEventListener('click', function () { setTimeout(syncMode, 0); });
        });
        syncMode();

        doc.querySelector('.workspace-viewport').appendChild(
            button('m-edit', 'edit', 'Düzenle', function () { btnEditMode.click(); LiveEditor.focus(); }, 24));

        // Kelime/süre notun sonunda: okuma ve yazma aynı yerden başlasın
        markdownViewer.insertAdjacentElement('afterend', doc.getElementById('doc-meta'));

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
        sheet(null, [
            { label: 'Notta ara', icon: 'search', tile: true, action: function () { setFindOpen(true); } },
            { label: 'Başlıklar', icon: 'toc', tile: true, action: openHeadings },
            { label: 'Paylaş', icon: 'share', tile: true, action: function () { if (currentFilePath) shareNote(currentFilePath, false); } },
            { label: Notes.isPinned(currentFilePath) ? 'Bırak' : 'Sabitle', icon: 'pin', tile: true, action: function () { if (currentFilePath) Notes.togglePin(currentFilePath); } },
            { separator: true }
        ].concat(noteItems(currentFilePath), [
            { label: 'Yazdır / PDF', icon: 'print', action: exportToPdf },
            { label: 'Odak modu', icon: 'focus', action: function () { Reader.setZen(true); } }
        ], deleteItem(currentFilePath)));
    }

    function openHeadings() {
        if (!headingElements.length) { showToast('Bu notta başlık yok'); return; }
        sheet('Başlıklar', headingElements.map(function (h) {
            return { label: '\u2003'.repeat(Number(h.tagName.slice(1)) - 1) + h.textContent, action: function () { scrollToHeading(h); } };
        }));
    }

    // ------------------------------------------------------------------
    // Not menüsü: paylaş, yeniden adlandır, sil
    // ------------------------------------------------------------------
    function noteItems(path) {
        if (!path) return [];
        var items = [];
        if (android) items.push({ label: 'Dosya olarak paylaş', icon: 'file', action: function () { shareNote(path, true); } });
        items.push(
            { label: 'Yeniden adlandır', icon: 'edit', action: function () { Notes.rename(path); } },
            { label: 'Taşı', icon: 'move', action: function () { Notes.pickMove(path); } },
            { label: 'Tam yolu kopyala', icon: 'copy', action: async function () {
                showToast((await copyToClipboard(path)) ? 'Yol kopyalandı' : 'Panoya kopyalanamadı');
            } }
        );
        return items;
    }
    function deleteItem(path) {
        return path ? [{ separator: true }, { label: 'Sil', icon: 'trash', danger: true, hint: 'Klasördeki .trash içine taşınır', action: async function () {
            var current = path === currentFilePath;
            await Notes.trash(path);
            if (current && path !== currentFilePath) openHome();
        } }] : [];
    }

    function openNoteMenu(path) {
        if (!path) {
            showToast('Açık not yok');
            return;
        }
        var items = [
            { label: Notes.isPinned(path) ? 'Sabitlemeyi kaldır' : 'Sabitle', icon: 'pin', action: function () { Notes.togglePin(path); } }
        ];
        if (android) items.push({ label: 'Metin olarak paylaş', icon: 'share', action: function () { shareNote(path, false); } });
        sheet(Notes.noteName(path), items.concat(noteItems(path), deleteItem(path)));
    }

    async function shareNote(path, asFile) {
        if (!(await Notes.settle(path))) return;
        var data = await nativeApi().content(path);
        if (!data || !data.success) {
            UiDialog.alert((data && data.error) || 'Not okunamadı.');
            return;
        }
        var error = android.shareNote(basename(path), data.content, asFile);
        if (error) UiDialog.alert(error);
    }

    // ------------------------------------------------------------------
    // Biçim çubuğu: bir blok yazılırken klavyenin üstünde durur
    // ------------------------------------------------------------------
    function buildFormatBar() {
        var bar = doc.createElement('div');
        bar.id = 'm-format';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Biçim');

        [
            ['task', 'Görev'], ['bullet', 'Madde'], ['heading', 'Başlık'], ['bold', 'Kalın'], ['italic', 'İtalik'],
            ['undo', 'Geri al'], ['redo', 'Yinele'],
            ['indent', 'Girinti artır'], ['outdent', 'Girinti azalt'],
            ['number', 'Numaralı liste'], ['quote', 'Alıntı'], ['strike', 'Üstü çizili'],
            ['link', 'Bağlantı'], ['wikilink', 'Not bağlantısı'], ['code', 'Kod']
        ].forEach(function (item) {
            var name = item[0];
            bar.appendChild(button('m-fmt-' + name, name, item[1], function () {
                LiveEditor.focus();
                if (name === 'undo' || name === 'redo') LiveEditor[name]();
                else LiveEditor.format(name);
            }, 20));
        });
        // Dokunuş odağı yazıdan almasın (odak giderse klavye iner). click yine
        // gelir; touchstart'a dokunulmaz ki çubuk yatay kaydırılabilsin.
        bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
        doc.querySelector('.app-container').appendChild(bar);
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
                return { name: basename(p), path: p, dir: place(dirname(p)), recent: true };
            });
        } catch (error) {
            console.error('Not listesi alınamadı:', error);
        }
        if (switcher !== sheet) return;
        notes.forEach(function (n) { n.key = Notes.fold(n.name.replace(/\.(md|markdown)$/i, '')); });

        function place(dir) {
            return notesDir && Notes.pathUnder(dir, notesDir) ? 'Notlarım' + dir.slice(notesDir.length) : dir;
        }
        var pins = Notes.pins().map(function (p) {
            return { name: basename(p), path: p, dir: place(dirname(p)), pin: true };
        });

        function row(note) {
            var b = doc.createElement('button');
            b.type = 'button';
            b.className = 'm-note' + (note.path === currentFilePath ? ' current' : '');
            b.innerHTML = icon(note.pin ? ICON.pin : note.recent ? ICON.clock : ICON.note, 20);
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
                closeHome();
                if (note.pin) {
                    Notes.open(note.path);
                } else if (note.recent) {
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
                try { r = await nativeApi().search_notes(query); } catch (e) { console.error('Arama:', e); }
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
            var q = Notes.fold(input.value.trim());
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
                    else if (i > 0 || Notes.fold(n.dir).indexOf(q) !== -1) contains.push(n);
                });
                shown = starts.concat(contains);
            } else if (recents.length || pins.length) {
                if (pins.length) list.appendChild(label('Sabitlenenler'));
                pins.forEach(function (n) { list.appendChild(row(n)); });
                if (recents.length) list.appendChild(label('Son açılanlar'));
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
        closeHome();
        if (a.action === 'new') Notes.create();
        else if (a.action === 'today') Notes.today();
        else if (a.action === 'search') openSwitcher();
        else if (a.action === 'share' && a.text) {
            var first = String(a.subject || a.text.split('\n')[0]).replace(/^#+\s*/, '').trim().slice(0, 60);
            Notes.create(null, /^https?:/.test(first) ? 'Bağlantı' : first, a.text);
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
        if (doc.querySelector('.ui-dialog-backdrop, .img-zoom')) { pressEscape(); return true; }
        if (contextMenuEl) { hideContextMenu(); return true; }
        if (switcher) { closeSwitcher(); return true; }
        if (!settingsPanel.classList.contains('hidden')) { if (!SettingsNav.back()) closeSettingsPanel(); return true; }
        if (html.classList.contains('m-find')) { setFindOpen(false); return true; }
        if (homeOpen()) { closeHome(); return true; }
        if (Reader.isZen()) { Reader.setZen(false); return true; }
        if (isEditMode) { btnReadMode.click(); return true; }
        if (depth > 0) { depth--; stepping = true; navigateHistory(-1); return true; }
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
        Notes.hooks.placeName = placeName;
        Notes.hooks.beforeOpen = closeHome;
        Notes.hooks.menu = sheet;
        buildHome();
        buildBars();
        buildFormatBar();
        guardMenus();
        runPendingAction();
        root.requestAnimationFrame(function () { html.classList.add('m-ready'); });

        new MutationObserver(syncChrome).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
        syncChrome();

        // Geri tuşu: önce açık panel, sonra önceki not, en son uygulama arka plana.
        root.__TAURI__.app.onBackButtonPress(function (e) {
            if (api.back()) return;
            if (android) android.moveToBack();
        });

        // Uygulama açıkken "Birlikte aç" ile gelen dosya
        listeners.action = runAction;
        listeners.open = function (data) {
            var path = parseOpened(JSON.stringify(data || {}));
            if (!path) return;
            closeSwitcher();
            closeHome();
            openRecentFile(path);
        };
    }

    doc.addEventListener('DOMContentLoaded', init);
})(typeof globalThis !== 'undefined' ? globalThis : this);
