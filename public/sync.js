/**
 * Telefon ↔ bilgisayar eşitleme arayüzü (Ayarlar > Eşitleme) ve otomatik eşitleme.
 * Bilgisayar dinleyen, telefon bağlanan taraftır; iş src-tauri/src/sync içindedir.
 */
const SyncUi = (function () {
    const AUTO_MS = 45000;
    const mobile = () => document.documentElement.classList.contains('mobile');
    const api = () => nativeApi();
    let status = null;
    let page = null;
    let visible = false;
    let poll = null;
    let busy = false;
    let note = '';            // son işlemin sonucu
    let noteError = false;
    let found = null;         // keşfedilen bilgisayarlar
    let notesDir = null;
    let form = { addr: '', code: '', folder: '' };
    let lastTry = 0;
    let editTimer = null;

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function row(label, hint, ...controls) {
        const r = el('div', 'settings-row');
        const l = el('span', 'settings-label', label);
        if (hint) l.appendChild(el('span', 'settings-hint', hint));
        r.appendChild(l);
        controls.forEach((c) => r.appendChild(c));
        return r;
    }
    function button(text, fn, cls) {
        const b = el('button', 'ui-dialog-btn' + (cls ? ' ' + cls : ''), text);
        b.type = 'button';
        b.disabled = busy;
        b.addEventListener('click', fn);
        return b;
    }
    function toggle(label, on, fn) {
        const l = el('label', 'switch');
        const c = el('input');
        c.type = 'checkbox';
        c.checked = on;
        c.disabled = busy;
        c.setAttribute('aria-label', label);
        c.addEventListener('change', () => fn(c.checked));
        l.append(c, el('span'));
        return l;
    }
    function section(title) {
        const s = el('section', 'settings-section');
        if (title) s.appendChild(el('h3', '', title));
        page.appendChild(s);
        return s;
    }
    function ago(t) {
        if (!t) return 'henüz eşitlenmedi';
        const s = Math.max(0, Math.round(Date.now() / 1000 - t));
        if (s < 60) return 'az önce';
        if (s < 3600) return Math.floor(s / 60) + ' dk önce';
        if (s < 86400) return Math.floor(s / 3600) + ' sa önce';
        return Math.floor(s / 86400) + ' gün önce';
    }
    function say(text, isError) { note = text || ''; noteError = !!isError; }

    /** Komutu çağırır; hata metnini gösterir. Başarılıysa durum yenilenir. */
    async function run(fn) {
        if (busy) return null;
        busy = true;
        say('');
        render();
        let r = null;
        try { r = await fn(); } catch (e) { r = { success: false, error: String(e) }; }
        busy = false;
        if (!r || r.success === false) say((r && r.error) || 'İşlem yapılamadı.', true);
        await refresh();
        return r && r.success !== false ? r : null;
    }
    async function refresh() {
        const native = api();
        if (!native || !native.sync_status) return;
        try { status = await native.sync_status(); } catch (e) { return; }
        render();
    }

    function folderChoices() {
        const list = [];
        const rootDir = explorerState && explorerState.root;
        if (mobile() && notesDir) list.push(['Uygulamanın notları', notesDir]);
        if (rootDir && rootDir !== notesDir) list.push(['Açık klasör', rootDir]);
        return list;
    }
    function folderRow(label, hint, current, onPick) {
        const box = el('div', 'sync-folder');
        box.appendChild(el('code', 'sync-path', current && current === notesDir ? 'Uygulamanın notları' : current || 'seçilmedi'));
        const acts = el('div', 'sync-acts');
        folderChoices().forEach(([name, path]) => {
            if (path !== current) acts.appendChild(button(name, () => onPick(path)));
        });
        acts.appendChild(button('Seç…', async () => {
            const p = mobile() ? await window.MDFlowMobile.pickFolderPath() : await api().sync_pick_folder();
            if (p) onPick(p);
        }));
        box.appendChild(acts);
        const r = row(label, hint, box);
        r.classList.add('stack');
        return r;
    }

    // --- bilgisayar ---------------------------------------------------------
    function renderHost() {
        const h = status.host;
        const s = section('Telefonla eşitle');
        s.appendChild(row('Eşitleme açık', h.enabled
            ? (h.listening ? 'Bu pencere açıkken telefon bağlanabilir' : 'Başlatılamadı')
            : 'Notların sunucu ve hesap olmadan, iki aygıt arasında doğrudan ve şifreli gider',
        toggle('Eşitleme açık', h.enabled, (on) => run(() => api().sync_host(on, h.folder ? null : ((explorerState && explorerState.root) || null))))));
        s.appendChild(folderRow('Eşitlenecek klasör', 'Alt klasörleriyle; notlar, görseller ve PDF', h.folder,
            (p) => run(() => api().sync_host(h.enabled, p))));
        if (!h.enabled) return;

        const p = section('Telefon ekle');
        if (h.pairing) {
            const box = el('div', 'sync-code');
            box.appendChild(el('strong', '', h.pairing.code.slice(0, 4) + ' ' + h.pairing.code.slice(4)));
            box.appendChild(el('span', 'settings-hint', `Telefonda Ayarlar › Eşitleme'ye bu kodu yaz. ${Math.ceil(h.pairing.seconds / 60)} dk geçerli, tek kullanımlık.`));
            box.appendChild(el('span', 'settings-hint', 'Bilgisayar listede çıkmazsa adres: ' + (status.addrs.join('  ya da  ') || 'ağ bağlantısı yok')));
            box.appendChild(button('Vazgeç', () => run(() => api().sync_pair_stop())));
            p.appendChild(box);
        } else {
            p.appendChild(row('Yeni telefon', 'Telefonda MD Flow 3.4 ya da sonrası olmalı', button('Kod göster', () => run(() => api().sync_pair_start()), 'primary')));
        }
        h.peers.forEach((d) => {
            p.appendChild(row(d.name, 'Son eşitleme: ' + ago(d.last), button('Kaldır', async () => {
                if (await UiDialog.confirm(`${d.name} artık eşitlenmesin mi? Notlar iki tarafta da kalır.`, { okText: 'Kaldır', cancelText: 'Vazgeç' })) {
                    run(() => api().sync_remove_peer(d.id));
                }
            })));
        });
    }

    // --- telefon ------------------------------------------------------------
    async function allowNetwork() {
        const ok = !window.MDFlowMobile || !window.MDFlowMobile.localNetwork || (await window.MDFlowMobile.localNetwork());
        if (!ok) { say('Bilgisayarı bulmak için yerel ağ izni gerekiyor.', true); render(); }
        return ok;
    }
    function input(key, placeholder, mode) {
        const i = el('input', 'settings-input');
        i.type = 'text';
        i.placeholder = placeholder;
        i.value = form[key];
        i.inputMode = mode;
        i.autocomplete = 'off';
        i.id = 'sync-in-' + key;
        i.setAttribute('aria-label', placeholder);
        i.addEventListener('input', () => { form[key] = i.value; });
        return i;
    }
    async function doPair() {
        const folder = form.folder || (folderChoices()[0] || [])[1];
        if (!form.addr.trim()) { say('Önce bilgisayarı seç ya da adresini yaz.', true); return render(); }
        if (!folder) { say('Önce klasör seç.', true); return render(); }
        if (!(await allowNetwork())) return;
        const name = (window.MDFlowMobile && window.MDFlowMobile.deviceName && window.MDFlowMobile.deviceName()) || 'Telefon';
        const r = await run(() => api().sync_pair(form.addr, form.code, name, folder));
        if (!r) return;
        form = { addr: '', code: '', folder: '' };
        found = null;
        syncNow(true);
    }
    function renderLink() {
        const l = status.link;
        if (!l) {
            const s = section('Bilgisayara bağlan');
            s.appendChild(el('p', 'sync-intro', 'Bilgisayarda Ayarlar › Eşitleme’yi aç ve “Kod göster”e bas. Aynı Wi-Fi’de olmanız yeter; hesap ve ücret yok.'));
            s.appendChild(row('Bilgisayar', found && !found.length ? 'Ağda bulunamadı; adresini elle yaz' : 'Aynı ağdaki bilgisayarları arar',
                button(busy ? 'Aranıyor…' : 'Ara', async () => {
                    if (!(await allowNetwork())) return;
                    const r = await run(() => api().sync_discover());
                    if (!r) return;
                    found = r.found;
                    if (found.length === 1) form.addr = found[0].addr;
                    render();
                })));
            (found || []).forEach((d) => {
                const b = button(d.name + '  ·  ' + d.addr.split(':')[0], () => { form.addr = d.addr; render(); }, 'sync-host' + (form.addr === d.addr ? ' primary' : ''));
                s.appendChild(b);
            });
            s.appendChild(row('Adres', null, input('addr', 'Örn. 192.168.1.5', 'decimal')));
            s.appendChild(row('Kod', null, input('code', '8 haneli kod', 'numeric')));
            s.appendChild(folderRow('Telefondaki klasör', null, form.folder || (folderChoices()[0] || [])[1],
                (p) => { form.folder = p; render(); }));
            s.appendChild(button(busy ? 'Bekle…' : 'Eşleştir', doPair, 'primary sync-wide'));
            return;
        }
        const s = section(l.name);
        s.appendChild(row('Son eşitleme', ago(l.last), button(busy || status.running ? 'Eşitleniyor…' : 'Şimdi eşitle', () => syncNow(true), 'primary')));
        s.appendChild(row('Otomatik eşitle', 'Uygulama açıkken ve not kaydedilince',
            toggle('Otomatik eşitle', l.auto, (on) => run(() => api().sync_set_link(null, on)))));
        s.appendChild(folderRow('Telefondaki klasör', null, l.folder, (p) => run(() => api().sync_set_link(p, null))));
        s.appendChild(row('Bağlantı', 'Notlar iki tarafta da kalır', button('Bağlantıyı kaldır', async () => {
            if (await UiDialog.confirm(`${l.name} ile bağlantı kaldırılsın mı?`, { okText: 'Kaldır', cancelText: 'Vazgeç' })) run(() => api().sync_unlink());
        })));
    }

    function render() {
        if (!page || !visible) return;
        // Yazarken kutu yeniden kurulup odak kaybolmasın
        const focus = document.activeElement && page.contains(document.activeElement) ? document.activeElement.id : '';
        const caret = focus ? document.activeElement.selectionStart : null;
        page.replaceChildren();
        if (!status) {
            page.appendChild(el('p', 'sync-intro', 'Eşitleme yalnız uygulamanın içinde kullanılabilir.'));
            return;
        }
        const n = el('p', 'sync-note' + (noteError ? ' error' : ''), note);
        n.setAttribute('role', 'status');
        n.hidden = !note;
        page.appendChild(n);
        if (mobile()) renderLink();
        else renderHost();
        const how = section('Nasıl çalışır');
        const ul = el('ul', 'sync-how');
        ['Aynı not iki tarafta da değişirse ikisi de kalır: biri “çakışma” kopyası olur.',
            'Silinen not diğer tarafta klasördeki .trash içine taşınır.',
            'O an düzenlediğin notun üzerine yazılmaz; düzenleme bitince eşitlenir.',
            'İki aygıtta Tailscale kuruluysa aynı ağda olmasanız da bilgisayarın 100.x adresiyle çalışır.'].forEach((t) => ul.appendChild(el('li', '', t)));
        how.appendChild(ul);
        if (focus) {
            const again = document.getElementById(focus);
            if (again) {
                again.focus();
                if (caret !== null) again.setSelectionRange(caret, caret);
            }
        }
    }

    function summary(r) {
        const parts = [];
        if (r.down) parts.push(r.down + ' alındı');
        if (r.up) parts.push(r.up + ' gönderildi');
        if (r.removed) parts.push(r.removed + ' silindi');
        if (r.conflicts) parts.push(r.conflicts + ' çakışma kopyası');
        if (r.deferred) parts.push(r.deferred + ' not düzenlendiği için bekliyor');
        if (r.failed && r.failed.length) parts.push(r.failed.length + ' dosya yapılamadı (' + r.failed[0] + ')');
        return parts.length ? parts.join(', ') : 'Her şey güncel';
    }

    let syncing = false;
    /** manual: sonucu ve hatayı göster; otomatikte yalnız değişiklik bildirilir. */
    async function syncNow(manual) {
        if (syncing || !api() || !api().sync_now) return;
        if (manual && !(await allowNetwork())) return;
        syncing = true;
        lastTry = Date.now();
        let r = null;
        try {
            r = await api().sync_now(false);
            if (r && r.confirm) {
                if (!manual) {
                    // Toplu silme kendiliğinden yapılmaz; kullanıcı elle eşitleyince sorulur.
                    say(`${r.deletes} not silinecek görünüyor; onay için “Şimdi eşitle”ye bas.`, true);
                    r = null;
                } else if (await UiDialog.confirm(`Eşitleme ${r.deletes} notu silecek. Bu klasörü bilerek mi boşalttın?\nSilinenler .trash klasörüne taşınır.`,
                    { okText: 'Sil ve eşitle', cancelText: 'Vazgeç' })) {
                    r = await api().sync_now(true);
                } else r = null;
            }
        } catch (e) { r = { success: false, error: String(e) }; }
        syncing = false;
        if (r && r.success && !r.busy) {
            say(summary(r));
            if (manual || r.down || r.removed || r.conflicts) showToast('Eşitlendi: ' + summary(r));
        } else if (r && !r.success && manual) {
            say(r.error, true);
            if (!visible) showToast(r.error);
        }
        await refresh();
    }

    function tick() {
        markBusy();
        if (!status || !status.link || !status.link.auto || document.hidden) return;
        if (Date.now() - lastTry >= AUTO_MS) syncNow(false);
    }

    // Düzenlenen not bildirilir; eşitleme onun üzerine yazmaz.
    let sentBusy;
    function markBusy() {
        const path = isEditMode && currentFilePath ? currentFilePath : null;
        if (path === sentBusy || !api() || !api().sync_busy) return;
        sentBusy = path;
        api().sync_busy(path);
    }

    /** Kayıttan kısa süre sonra eşitle (app.js saveFile). */
    function saved() {
        if (!status || !status.link || !status.link.auto) return;
        clearTimeout(editTimer);
        editTimer = setTimeout(() => syncNow(false), 2500);
    }

    async function init() {
        page = document.getElementById('settings-sync');
        const native = api();
        if (!native || !native.sync_status) return;
        if (mobile() && window.__TAURI__) {
            try { notesDir = await window.__TAURI__.core.invoke('notes_dir'); } catch (e) { /* yok */ }
        }
        native.onSyncEvent((e) => {
            if (e.kind === 'paired') {
                say('Telefon eşleşti.');
                showToast('Telefon eşleşti');
            }
            if (e.kind === 'files' && explorerState) applyExplorerState(explorerState);
            refresh();
        });
        await refresh();
        [btnReadMode, btnEditMode].forEach((b) => b.addEventListener('click', () => setTimeout(markBusy, 0)));
        markBusy();
        setInterval(tick, 1000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) lastTry = 0; });
    }

    function shown(on) {
        visible = on;
        clearInterval(poll);
        if (!on) return;
        render();
        refresh();
        poll = setInterval(() => { if (!busy && status && status.host.pairing) refresh(); }, 5000);
    }

    return { init, shown, saved, syncNow, linked: () => !!(status && status.link) };
})();
