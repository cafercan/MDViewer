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
            if (unlistenChange) { unlistenChange(); unlistenChange = null; }
            var unlisten = await tauri.event.listen('file-changed', function (e) { onChange(e.payload); });
            unlistenChange = unlisten;
            var result = await call('watch_file', { path: file });
            if (!result || result.success !== true) {
                if (onError) onError((result && result.error) || 'İzleme başlatılamadı.');
            }
            return function stop() {
                if (unlistenChange === unlisten) { unlisten(); unlistenChange = null; }
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
        print_page: function () { return call('print_page'); },
        open_external: function (url) { return call('open_external', { url: url }); },
        resolve_wikilink: function (target, currentFile) {
            return call('resolve_wikilink', { target: target, currentFile: currentFile || null });
        },
        inspect_path: function (path) { return call('inspect_path', { path: path }); },
        open_path: function (path) { return call('open_path', { path: path }); },
        open_in_file_manager: function (path) { return call('open_in_file_manager', { path: path }); }
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
