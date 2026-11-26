/**
 * Kendi kendini güncelleme (arayüz tarafı; iş: src-tauri/src/update.rs).
 *
 * Açılıştan az sonra ve birkaç saatte bir yeni sürüme bakılır. Masaüstünde
 * paket arka planda indirilir, kullanıcıya yalnız "Yeniden başlat" kalır;
 * Android'de (mobil veri) indirme kullanıcı isteyince başlar. Kaydedilmemiş
 * düzenleme varsa kurulumdan önce kaydedilir.
 *
 * `create(deps)` arayüzden bağımsızdır; Node testleri sahte parçalar verir:
 *   deps.native   : { update_info, update_check, update_download, update_install }
 *   deps.view(st) : durumu gösterir — st: { phase, version, percent, ... }
 *   deps.enabled(): "Otomatik güncelle" ayarı
 *   deps.eager    : bulununca kendiliğinden indir
 *   deps.prepare(): kurulumdan önce kaydet; false → vazgeç
 *   deps.currentFile(), deps.finish(sonuç), deps.openPage(adres), deps.snoozed(v), deps.snooze(v)
 */
(function (root) {
    'use strict';
    // Arayüz dili (i18n.js); Node'da (testler) hep Türkçe.
    var T = root.I18N ? root.I18N.t
        : typeof require === 'function' ? require('./i18n.js').t : function (s) { return s; };

    var CHECK_EVERY = 6 * 60 * 60 * 1000;

    function create(deps) {
        var native = deps.native;
        var info = null;
        var found = null;       // son denetimde bulunan güncelleme
        var running = null;     // süren denetim/indirme/kurulum

        function show(phase, extra) {
            var st = { phase: phase, version: found && found.version, canInstall: !!(found && found.canInstall) };
            for (var k in extra || {}) st[k] = extra[k];
            deps.view(st);
        }

        // Aynı anda tek iş: düğmeye art arda basmak ikincisini başlatmaz.
        function once(job) {
            if (running) return running;
            running = job().catch(function (e) {
                show('error', { message: String((e && e.message) || e) });
            }).then(function (v) { running = null; return v; });
            return running;
        }

        async function loadInfo() {
            if (!info) info = await native.update_info();
            return info;
        }

        async function download(quiet) {
            if (!quiet) show('downloading', { percent: 0 });
            var r = await native.update_download();
            if (!r || !r.success) {
                // Arka planda inemediyse sessizce "indir" düğmesine düş.
                if (quiet) show('available');
                else show('error', { message: (r && r.error) || T('İndirilemedi.') });
                return false;
            }
            found.ready = true;
            return true;
        }

        async function install() {
            if (!(await deps.prepare())) { show('ready'); return; }
            show('installing');
            var r = await native.update_install(deps.currentFile());
            if (!r || !r.success) {
                found.ready = false;
                show('error', { message: (r && r.error) || T('Kurulamadı.') });
                return;
            }
            if (deps.finish && (await deps.finish(r)) === false) show('ready');
        }

        /** manual: kullanıcı istedi → sonuç ve hata her durumda gösterilir. */
        function check(manual) {
            return once(async function () {
                await loadInfo();
                if (manual) show('checking');
                var r = await native.update_check();
                if (!r || !r.success) {
                    if (manual) show('error', { message: (r && r.error) || T('Denetlenemedi.') });
                    return;
                }
                if (!r.version) {
                    found = null;
                    if (manual) show('latest');
                    return;
                }
                found = r;
                if (!manual && deps.snoozed(r.version)) return;
                if (r.canInstall && !r.ready && deps.eager) {
                    if (!(await download(!manual))) return;
                }
                show(found.ready ? 'ready' : 'available');
            });
        }

        return {
            check: check,
            info: loadInfo,
            /** Güncelle düğmesi: gerekiyorsa indirir, sonra kurar. */
            apply: function () {
                return once(async function () {
                    if (!found) return;
                    if (!found.canInstall) { deps.openPage(found.notes); return; }
                    if (!found.ready && !(await download(false))) return;
                    await install();
                });
            },
            notes: function () { if (found) deps.openPage(found.notes); },
            later: function () {
                if (found) deps.snooze(found.version);
                show('hidden');
            },
            progress: function (p) {
                if (running && p && p.total) show('progress', { percent: Math.round(p.done * 100 / p.total) });
            },
            /** Açılışta bir kez: kendiliğinden denetimi kurar. */
            start: async function () {
                var i = await loadInfo();
                if (!i || !i.auto) return;
                var tick = function () { if (deps.enabled()) check(false); };
                setTimeout(tick, 4000);
                setInterval(tick, CHECK_EVERY);
            }
        };
    }

    // --- sayfa --------------------------------------------------------------

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text) n.textContent = text;
        return n;
    }

    function buildCard(actions) {
        var card = el('div', 'update-card hidden');
        card.id = 'update-card';
        card.setAttribute('role', 'status');
        var title = el('div', 'update-title');
        var text = el('div', 'update-text');
        var bar = el('div', 'update-bar');
        var fill = bar.appendChild(el('span'));
        var row = el('div', 'update-actions');
        function btn(label, cls, fn) {
            var b = el('button', 'ui-dialog-btn' + cls, label);
            b.type = 'button';
            b.addEventListener('click', fn);
            row.appendChild(b);
            return b;
        }
        var notes = btn(T('Yenilikler'), '', actions.notes);
        var later = btn(T('Sonra'), '', actions.later);
        var go = btn(T('Güncelle'), ' primary', actions.apply);
        [title, text, bar, row].forEach(function (n) { card.appendChild(n); });
        document.body.appendChild(card);

        return function (st) {
            var busy = st.phase === 'downloading' || st.phase === 'progress' || st.phase === 'installing';
            var visible = busy || st.phase === 'ready' || st.phase === 'available' || (st.phase === 'error' && st.version);
            // Arka plandaki sessiz indirmenin ilerlemesi kartı açmasın.
            if (st.phase === 'progress' && card.classList.contains('hidden')) return;
            card.classList.toggle('hidden', !visible);
            if (!visible) return;
            title.textContent = 'MD Flow Viewer ' + st.version;
            text.textContent =
                st.phase === 'ready' ? T('Yeni sürüm indirildi, kurulmaya hazır.') :
                st.phase === 'available' ? (st.canInstall ? T('Yeni sürüm çıktı.') : T('Yeni sürüm çıktı. Bu kurulum kendini güncelleyemiyor; paket yöneticinizle güncelleyin.')) :
                st.phase === 'installing' ? T('Kuruluyor…') :
                st.phase === 'error' ? st.message : T('İndiriliyor… %{n}', { n: st.percent || 0 });
            bar.classList.toggle('hidden', !busy);
            bar.classList.toggle('indeterminate', st.phase === 'installing');
            fill.style.width = (st.percent || 0) + '%';
            row.classList.toggle('hidden', busy);
            notes.classList.toggle('hidden', st.phase === 'error');
            later.textContent = st.phase === 'error' ? T('Kapat') : T('Sonra');
            go.textContent = st.phase === 'error' ? T('Yeniden dene') :
                !st.canInstall ? T('İndirme sayfası') :
                st.phase === 'ready' ? actions.readyLabel : T('Güncelle');
        };
    }

    function settingsLine(st) {
        var line = document.getElementById('update-status');
        if (!line) return;
        var text = {
            checking: T('Denetleniyor…'),
            latest: T('En güncel sürümü kullanıyorsunuz'),
            available: T('Yeni sürüm var: {v}', { v: st.version }),
            ready: T('Yeni sürüm hazır: {v}', { v: st.version }),
            downloading: T('İndiriliyor…'),
            progress: T('İndiriliyor… %{n}', { n: st.percent || 0 }),
            installing: T('Kuruluyor…'),
            error: st.message
        }[st.phase];
        if (text) line.textContent = text;
    }

    var SNOOZE = 'md_update_snooze';
    var SNOOZE_FOR = 24 * 60 * 60 * 1000;

    /** hooks: { enabled, prepare, currentFile, openPage, notify } (app.js verir) */
    function start(hooks) {
        var native = root.MDFlowNative;
        if (!native || !native.update_info) return null;
        var mobile = document.documentElement.classList.contains('mobile');
        var view;
        var updater = create({
            native: native,
            enabled: hooks.enabled,
            prepare: hooks.prepare,
            currentFile: hooks.currentFile,
            openPage: hooks.openPage,
            eager: !mobile,
            finish: function (r) { return hooks.finish ? hooks.finish(r) : true; },
            view: function (st) { view(st); settingsLine(st); },
            snoozed: function (v) {
                try {
                    var s = JSON.parse(localStorage.getItem(SNOOZE) || '{}');
                    return s.version === v && Date.now() < s.until;
                } catch (e) { return false; }
            },
            snooze: function (v) {
                try { localStorage.setItem(SNOOZE, JSON.stringify({ version: v, until: Date.now() + SNOOZE_FOR })); } catch (e) { /* yut */ }
            }
        });
        view = buildCard({
            apply: updater.apply, later: updater.later, notes: updater.notes,
            readyLabel: mobile ? T('Kur') : T('Yeniden başlat ve güncelle')
        });
        native.onUpdateProgress(updater.progress);

        var btn = document.getElementById('btn-update-check');
        if (btn) btn.addEventListener('click', function () { updater.check(true); });
        updater.info().then(function (i) {
            var v = document.getElementById('app-version');
            if (v && i) v.textContent = T('Sürüm {v}', { v: i.version });
        }).catch(function () { /* yut */ });
        updater.start().catch(function (e) { console.error('Güncelleme denetimi kurulamadı:', e); });
        return updater;
    }

    var api = { create: create, start: start };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Updater = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
