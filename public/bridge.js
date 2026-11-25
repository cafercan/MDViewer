/**
 * Arayüz ↔ uygulama köprüsü (Tauri 2).
 *
 * 2.x'te arayüz yerel HTTP sunucusuna (fetch /api/*, EventSource) ve
 * pywebview köprüsüne (window.pywebview.api) konuşuyordu. 3.0'da ikisi de
 * Tauri `invoke` çağrısıdır; metot adları ve dönen JSON şekilleri aynı
 * kaldığı için app.js yalnız bu nesneyi kullanır.
 *
 * Komutlar yalnız uygulama penceresinde vardır (window.__TAURI__); tarayıcıda
 * açılan sayfada MDFlowNative tanımsız kalır ve arayüz bunu zaten ele alır.
 */
(function (root) {
    'use strict';

    var tauri = root.__TAURI__;
    if (!tauri || !tauri.core) return;

    var invoke = tauri.core.invoke;

    function call(name, args) {
        return invoke(name, args || {});
    }

    var unlistenChange = null;
    var watchGen = 0;

    // Uygulamanın verdiği yol ile arayüzdekini karşılaştır (ayırıcı ve harf duyarsız).
    function samePath(a, b) {
        var norm = function (p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); };
        return norm(a) === norm(b);
    }

    root.MDFlowNative = {
        // --- belge ----------------------------------------------------------
        content: function (file) { return call('content', { file: file || null }); },
        save: function (path, content) { return call('save', { path: path, content: content }); },
        getSettings: function () { return call('get_settings'); },
        setSettings: function (patch) { return call('set_settings', { patch: patch }); },

        /**
         * Belgeyi izler; diskte değişince onChange({file}) çağrılır. Önceki
         * izleme bırakılır. İzleme başlatılamazsa onError(mesaj).
         * @returns {Promise<function(): void>} izlemeyi durduran fonksiyon
         */
        watch: async function (file, onChange, onError) {
            // Her izleme bir kuşak numarası alır; yalnız en son kuşak geçerlidir.
            // Çağrılar beklenmeden üst üste gelebilir: eski dinleyici sızarsa
            // başka belgenin içeriği bu belgenin görünümüne yüklenirdi.
            var gen = ++watchGen;
            if (unlistenChange) { unlistenChange(); unlistenChange = null; }
            var unlisten = await tauri.event.listen('file-changed', function (e) {
                if (gen === watchGen && e.payload && samePath(e.payload.file, file)) onChange(e.payload);
            });
            if (gen !== watchGen) {             // beklerken daha yeni bir izleme başladı
                unlisten();
                return function () {};
            }
            unlistenChange = unlisten;
            var result = await call('watch_file', { path: file });
            if (gen === watchGen && (!result || result.success !== true)) {
                if (onError) onError((result && result.error) || 'İzleme başlatılamadı.');
            }
            return function stop() {
                if (gen !== watchGen) return;       // yerini yenisi aldı; ona dokunma
                watchGen++;
                unlisten();
                unlistenChange = null;
                call('unwatch_file');
            };
        },

        /** Yerel görselin mdasset protokolü adresi. */
        assetUrl: function (absPath) { return tauri.core.convertFileSrc(absPath, 'mdasset'); },

        /** Açılış belgesi (komut satırı / macOS Birlikte Aç); yalnız ilk soruşta dolu. */
        initial_file: function () { return call('initial_file'); },

        /** Uygulama açıkken macOS'ta "Birlikte Aç" ile gelen belge: cb(yol). */
        onOpenFile: function (cb) {
            return tauri.event.listen('open-file', function (e) { cb(e.payload.path); });
        },

        /** Pencereye bırakılan yol: cb({path, kind}) — kind: file | folder | other. */
        onDropped: function (cb) {
            return tauri.event.listen('dropped-path', function (e) { cb(e.payload); });
        },

        /** Pencere kapatılmak istenince handler(event); event.preventDefault() kapanışı iptal eder. */
        onCloseRequested: function (handler) {
            return tauri.window.getCurrentWindow().onCloseRequested(handler);
        },

        // --- 2.x JsApi ile aynı adlar ------------------------------------------
        open_file: function () { return call('open_file'); },
        open_file_path: function (path) { return call('open_file_path', { path: path }); },
        open_folder: function () { return call('open_folder'); },
        open_folder_path: function (path) { return call('open_folder_path', { path: path }); },
        recent_list: function () { return call('recent_list'); },
        clear_recent_list: function (kind) { return call('clear_recent_list', { kind: kind }); },
        explorer_state: function () { return call('explorer_state'); },
        list_dir: function (path) { return call('list_dir', { path: path }); },
        explorer_up: function () { return call('explorer_up'); },
        explorer_enter: function (path) { return call('explorer_enter', { path: path }); },
        set_vault: function (path) { return call('set_vault', { path: path === undefined ? null : path }); },
        // --- notlar (notes.js, reader.js, palette.js) ------------------------------
        list_notes: function () { return call('list_notes'); },
        create_note: function (dir, name) { return call('create_note', { dir: dir, name: name }); },
        rename_note: function (path, name) { return call('rename_note', { path: path, name: name }); },
        trash_note: function (path) { return call('trash_note', { path: path }); },
        create_folder: function (dir, name) { return call('create_folder', { dir: dir, name: name }); },
        rename_folder: function (path, name) { return call('rename_folder', { path: path, name: name }); },
        trash_folder: function (path) { return call('trash_folder', { path: path }); },
        move_entry: function (path, dir) { return call('move_entry', { path: path, dir: dir }); },
        search_notes: function (query) { return call('search_notes', { query: query }); },
        backlinks: function (path) { return call('backlinks', { path: path }); },
        print_page: function () { return call('print_page'); },
        open_external: function (url) { return call('open_external', { url: url }); },
        resolve_wikilink: function (target, currentFile) {
            return call('resolve_wikilink', { target: target, currentFile: currentFile || null });
        },
        inspect_path: function (path) { return call('inspect_path', { path: path }); },
        // --- güncelleme (updater.js) ----------------------------------------------
        update_info: function () { return call('update_info'); },
        update_check: function () { return call('update_check'); },
        update_download: function () { return call('update_download'); },
        update_install: function (file) { return call('update_install', { file: file || null }); },
        onUpdateProgress: function (cb) {
            return tauri.event.listen('update-progress', function (e) { cb(e.payload); });
        },
        // --- eşitleme (sync.js) ------------------------------------------------------
        sync_status: function () { return call('sync_status'); },
        sync_host: function (enabled, folder) { return call('sync_host', { enabled: enabled, folder: folder || null }); },
        sync_pick_folder: function () { return call('sync_pick_folder'); },
        sync_pair_start: function () { return call('sync_pair_start'); },
        sync_pair_stop: function () { return call('sync_pair_stop'); },
        sync_remove_peer: function (id) { return call('sync_remove_peer', { id: id }); },
        sync_discover: function () { return call('sync_discover'); },
        sync_check: function (addr) { return call('sync_check', { addr: addr }); },
        sync_pair: function (addr, code, name, folder) {
            return call('sync_pair', { addr: addr, code: code, name: name, folder: folder });
        },
        sync_set_link: function (folder, auto) { return call('sync_set_link', { folder: folder, auto: auto }); },
        sync_unlink: function () { return call('sync_unlink'); },
        sync_now: function (allowDeletes) { return call('sync_now', { allowDeletes: !!allowDeletes }); },
        sync_busy: function (path) { return call('sync_busy', { path: path || null }); },
        onSyncEvent: function (cb) {
            return tauri.event.listen('sync-event', function (e) { cb(e.payload); });
        },
        open_path: function (path) { return call('open_path', { path: path }); },
        open_in_file_manager: function (path) { return call('open_in_file_manager', { path: path }); }
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
