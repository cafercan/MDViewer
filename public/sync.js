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
    let hostSay = null;       // bilgisayar: kod kutusunun altındaki durum {kind, text}
    let pairedName = '';      // bilgisayar: az önce eşleşen telefon
    let codeEnd = 0;          // gösterilen kodun bittiği an
    let codeSince = 0;
    let searching = false;
    let addrState = null;     // telefon: yazılan adresin denetimi {kind, text, help}
    let addrSeq = 0;
    let addrTimer = null;
    let wrongAt = null;       // telefon: hatalı adım {step, text, help}
    let stage = -1;           // telefon: süren eşleştirme adımı
    let progress = '';        // süren eşitleme: "3/40"
    let linkError = '';       // son eşitlemenin hatası (otomatik dahil)

    const OR = '  ' + T('ya da') + '  ';
    const FIREWALL = T('Bilgisayarın güvenlik duvarında 47823 (TCP ve UDP) kapısına izin ver.');
    const SAME_NET = T('İki aygıt aynı Wi-Fi’de olsun. Misafir ağı ve VPN aygıtları birbirinden ayırabilir.');
    const OPEN_HOST = T('Bilgisayarda MD Flow açık ve Ayarlar › Eşitleme’de “Eşitleme açık” işaretli olsun.');
    const NEW_CODE = T('Bilgisayarda “Kod göster”e yeniden bas ve yeni kodu yaz.');
    /** Hatanın yeri (sync/mod.rs PairError) → adım ve yapılacaklar. */
    const HELP = {
        addr: ['addr', [T('Bilgisayarda Eşitleme sayfasında görünen adresi yaz. Örnek: 192.168.1.5')]],
        off: ['addr', [OPEN_HOST, T('Adres başka bir aygıtın olabilir; bilgisayarda görünen adresle karşılaştır.')]],
        timeout: ['addr', [T('Adresi bilgisayarda görünenle karşılaştır.'), SAME_NET, OPEN_HOST, FIREWALL]],
        network: ['addr', [T('Telefonun Wi-Fi’si açık olsun.'), SAME_NET, T('100.x ile başlayan adres için telefonda Tailscale bağlı olmalı.')]],
        denied: ['addr', [T('Telefonun ayarlarından MD Flow’a yerel ağ iznini ver.')]],
        host: ['addr', [T('Yeniden dene.'), OPEN_HOST, NEW_CODE]],
        closed: ['code', [NEW_CODE, T('Kod 5 dakika geçerli, bir kez kullanılır ve 5 yanlış denemede iptal olur.')]],
        code: ['code', [T('Kodu bilgisayardakiyle hane hane karşılaştır.'), T('Birkaç kez olmadıysa: {tip}', { tip: NEW_CODE })]],
        folder: ['folder', [T('Daha dar bir not klasörü seç.')]]
    };

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
        if (!t) return T('henüz eşitlenmedi');
        const s = Math.max(0, Math.round(Date.now() / 1000 - t));
        if (s < 60) return T('az önce');
        if (s < 3600) return T('{n} dk önce', { n: Math.floor(s / 60) });
        if (s < 86400) return T('{n} sa önce', { n: Math.floor(s / 3600) });
        return T('{n} gün önce', { n: Math.floor(s / 86400) });
    }
    /** Simgeli durum satırı. kind: wait (dönen), ok, bad, idle */
    function state(kind, text, help) {
        const box = el('div', 'sync-state ' + kind);
        box.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
        const dot = el('span', 'sync-dot');
        if (kind === 'ok') dot.innerHTML = Icons.svg(Icons.paths.done, 14);
        dot.setAttribute('aria-hidden', 'true');
        const body = el('div');
        body.appendChild(el('div', '', text));
        if (help && help.length) {
            const ul = el('ul', 'sync-help');
            help.forEach((t) => ul.appendChild(el('li', '', t)));
            body.appendChild(ul);
        }
        box.append(dot, body);
        return box;
    }
    /** Numaralı adım kartı; done → onay işareti, bad → kırmızı. */
    function step(parent, no, title, hint, done, bad) {
        const box = el('div', 'sync-step' + (done ? ' done' : '') + (bad ? ' bad' : ''));
        const num = el('span', 'sync-num', done ? '' : String(no));
        if (done) num.innerHTML = Icons.svg(Icons.paths.done, 16);
        const body = el('div', 'sync-step-body');
        body.appendChild(el('strong', '', title));
        if (hint) body.appendChild(el('span', 'settings-hint', hint));
        box.append(num, body);
        parent.appendChild(box);
        return body;
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
        if (!r || r.success === false) say((r && r.error) || T('İşlem yapılamadı.'), true);
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
        if (mobile() && notesDir) list.push([T('Uygulamanın notları'), notesDir]);
        if (rootDir && rootDir !== notesDir) list.push([T('Açık klasör'), rootDir]);
        return list;
    }
    function folderBox(current, onPick) {
        const box = el('div', 'sync-folder');
        box.appendChild(el('code', 'sync-path', current && current === notesDir ? T('Uygulamanın notları') : current || T('seçilmedi')));
        const acts = el('div', 'sync-acts');
        folderChoices().forEach(([name, path]) => {
            if (path !== current) acts.appendChild(button(name, () => onPick(path)));
        });
        acts.appendChild(button(T('Seç…'), async () => {
            const p = mobile() ? await window.MDFlowMobile.pickFolderPath() : await api().sync_pick_folder();
            if (p) onPick(p);
        }));
        box.appendChild(acts);
        return box;
    }
    function folderRow(label, hint, current, onPick) {
        const r = row(label, hint, folderBox(current, onPick));
        r.classList.add('stack');
        return r;
    }

    function addrLabel(a) { return a.startsWith('100.') ? a + ' (Tailscale)' : a; }
    /** Kodun kalan süresi sayfayı yeniden kurmadan akar. */
    function countdown() {
        const left = document.getElementById('sync-left');
        if (!left) return;
        const s = Math.max(0, Math.round((codeEnd - Date.now()) / 1000));
        const tries = status.host.pairing ? status.host.pairing.tries : 0;
        left.textContent = T('{time} kaldı · tek kullanımlık', { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }) +
            (tries < 5 ? ' · ' + T('{n} deneme hakkı', { n: tries }) : '');
        document.getElementById('sync-bar').style.width = Math.min(100, s / 3) + '%';
        if (!s && !busy) {
            hostSay = { kind: 'bad', text: T('Kodun süresi doldu.'), help: [T('Yeni kod göster ve 5 dakika içinde telefona yaz.')] };
            refresh();
        }
    }
    function hostEvent(kind) {
        const say = {
            'pair-try': ['wait', T('Telefon bağlandı, kod doğrulanıyor…')],
            'pair-bad': ['bad', T('Telefonda yanlış kod yazıldı. Kod hâlâ geçerli; yeniden yazılabilir.')],
            'pair-lost': ['bad', T('Telefonun bağlantısı yarıda kesildi.'), [T('Telefonda “Eşleştir”e yeniden bas.'), SAME_NET]],
            'pair-over': ['bad', T('Deneme hakkı bitti, kod iptal edildi.'), [T('Yeni kod gösterip telefona yaz.')]]
        }[kind];
        if (say) hostSay = { kind: say[0], text: say[1], help: say[2] };
        return !!say;
    }

    // --- bilgisayar ---------------------------------------------------------
    function renderHost() {
        const h = status.host;
        const s = section(T('Telefonla eşitle'));
        s.appendChild(row(T('Eşitleme açık'), h.enabled
            ? (h.listening ? T('Bu pencere açıkken telefon bağlanabilir') : T('Açık ama başlatılamadı'))
            : T('Notların sunucu ve hesap olmadan, iki aygıt arasında doğrudan ve şifreli gider'),
        toggle(T('Eşitleme açık'), h.enabled, (on) => run(() => api().sync_host(on, h.folder ? null : ((explorerState && explorerState.root) || null))))));
        s.appendChild(folderRow(T('Eşitlenecek klasör'), T('Alt klasörleriyle; notlar, görseller ve PDF'), h.folder,
            (p) => run(() => api().sync_host(h.enabled, p))));
        if (!h.enabled) {
            s.appendChild(state('idle', h.folder ? T('Telefon eklemek için “Eşitleme açık”ı işaretle.') : T('Önce klasörü seç, sonra “Eşitleme açık”ı işaretle.')));
            return;
        }
        if (!h.listening) {
            s.appendChild(state('bad', T('Telefonlar şu an bağlanamaz: eşitleme kapısı açılamadı.'), [T('MD Flow’un başka bir penceresi açıksa kapat.')]));
            s.appendChild(button(T('Yeniden dene'), () => run(() => api().sync_host(true, null)), 'primary'));
            return;
        }
        if (!status.addrs.length) s.appendChild(state('bad', T('Bilgisayar bir ağa bağlı değil; telefon onu bulamaz.'), [T('Wi-Fi’ye ya da kabloya bağlan.')]));
        else s.appendChild(state('ok', T('Dinleniyor · {addrs}', { addrs: status.addrs.map(addrLabel).join(OR) })));

        const p = section(T('Telefon ekle'));
        if (pairedName) p.appendChild(state('ok', T('{name} eşleşti. İlk eşitlemeyi telefon kendisi başlatır.', { name: pairedName })));
        if (h.pairing) {
            codeEnd = Date.now() + h.pairing.seconds * 1000;
            step(p, 1, T('Telefonda Ayarlar › Eşitleme’yi aç'), T('İki aygıt aynı Wi-Fi’de (ya da aynı Tailscale ağında) olmalı.'));
    
            const s2 = step(p, 2, T('Ara’ya bas ve “{name}”ı seç', { name: status.name }), T('Listede çıkmazsa bu adresi elle yaz:'));
            s2.appendChild(el('code', 'sync-path', status.addrs.map(addrLabel).join(OR) || T('ağ bağlantısı yok')));
            const s3 = step(p, 3, T('Bu kodu telefona yaz'));
            const box = el('div', 'sync-code');
            box.appendChild(el('strong', '', h.pairing.code.slice(0, 4) + ' ' + h.pairing.code.slice(4)));
            const left = el('span', 'settings-hint', '');
            left.id = 'sync-left';
            box.appendChild(left);
            const track = el('div', 'sync-track');
            track.appendChild(el('i'));
            track.firstChild.id = 'sync-bar';
            box.appendChild(track);
            box.appendChild(button(T('Vazgeç'), () => { hostSay = null; run(() => api().sync_pair_stop()); }));
            s3.appendChild(box);
            const slow = !hostSay && Date.now() - codeSince > 40000;
            s3.appendChild(hostSay ? state(hostSay.kind, hostSay.text, hostSay.help)
                : state('wait', T('Telefon bekleniyor…'), slow ? [T('Telefon bulamıyorsa:'), SAME_NET, FIREWALL] : null));
        } else {
            if (hostSay) p.appendChild(state(hostSay.kind, hostSay.text, hostSay.help));
            p.appendChild(row(T('Yeni telefon'), T('Kod gösterilir, telefona yazılır. Telefonda MD Flow 3.4 ya da sonrası olmalı'), button(hostSay ? T('Yeni kod göster') : T('Kod göster'), () => {
                hostSay = null;
                pairedName = '';
                codeSince = Date.now();
                run(() => api().sync_pair_start()).then(() => {
                    const box = document.querySelector('.sync-code');
                    if (box) box.parentNode.scrollIntoView({ block: 'end' });
                });
            }, 'primary')));
        }
        h.peers.forEach((d) => {
            p.appendChild(row(d.name, d.last ? T('Son eşitleme: {when}', { when: ago(d.last) }) : T('Eşleşti, ilk eşitleme bekleniyor'), button(T('Kaldır'), async () => {
                if (await UiDialog.confirm(T('{name} artık eşitlenmesin mi? Notlar iki tarafta da kalır.', { name: d.name }), { okText: T('Kaldır'), cancelText: T('Vazgeç') })) {
                    run(() => api().sync_remove_peer(d.id));
                }
            })));
        });
    }

    // --- telefon ------------------------------------------------------------
    async function allowNetwork() {
        const ok = !window.MDFlowMobile || !window.MDFlowMobile.localNetwork || (await window.MDFlowMobile.localNetwork());
        if (!ok) {
            say(T('Yerel ağ izni verilmedi. Bilgisayara ulaşmak için telefonun ayarlarından MD Flow’a izin ver.'), true);
            render();
            if (!visible) showToast(note);
        }
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
        i.disabled = busy;
        i.addEventListener('input', () => {
            if (key === 'code' && i.selectionStart === i.value.length) {
                const d = i.value.replace(/\D/g, '').slice(0, 8);
                i.value = d.length > 4 ? d.slice(0, 4) + ' ' + d.slice(4) : d;
            }
            form[key] = i.value;
            if (wrongAt && wrongAt.step === key) wrongAt = null;
            if (key === 'addr') typedAddr(); else render();
        });
        return i;
    }
    const digits = () => form.code.replace(/\D/g, '');
    const pickedFolder = () => form.folder || (folderChoices()[0] || [])[1];
    /** Yazılan adresin biçimi: '' boş, 'part' yarım, 'bad' olmaz, 'ok' denenebilir. */
    function addrShape(v) {
        const t = v.trim();
        if (!t) return '';
        const m = t.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(:\d{1,5})?$/);
        if (m) return m.slice(1, 5).every((n) => Number(n) < 256) ? 'ok' : 'bad';
        return /^[\d.]+:?\d*$/.test(t) ? 'part' : 'bad';
    }
    function typedAddr() {
        clearTimeout(addrTimer);
        addrSeq++;
        const shape = addrShape(form.addr);
        addrState = null;
        if (shape === 'part') addrState = { kind: 'idle', text: T('Adres dört sayıdan oluşur: 192.168.1.5 gibi') };
        else if (shape === 'bad') addrState = { kind: 'bad', text: T('Adres geçersiz; sayı ve nokta kullan, her sayı en çok 255.') };
        else if (shape === 'ok') {
            addrState = { kind: 'wait', text: T('Adres deneniyor…') };
            addrTimer = setTimeout(checkAddr, 900);
        }
        render();
    }
    async function checkAddr() {
        clearTimeout(addrTimer);
        const m = window.MDFlowMobile;
        if (m && m.hasLocalNetwork && !m.hasLocalNetwork()) {
            addrState = { kind: 'idle', text: T('Eşleştirirken yerel ağ izni istenecek.') };
            return render();
        }
        const seq = ++addrSeq;
        addrState = { kind: 'wait', text: form.addr.split(':')[0] + ' deneniyor…' };
        render();
        let r;
        try { r = await api().sync_check(form.addr); } catch (e) { r = { success: false, error: String(e) }; }
        if (seq !== addrSeq) return;
        addrState = r.success
            ? { kind: 'ok', text: r.name ? T('{name} bulundu, bağlanılabiliyor.', { name: r.name }) : T('Bilgisayar yanıt verdi, bağlanılabiliyor.') }
            : { kind: 'bad', text: r.error, help: (HELP[r.at] || HELP.host)[1] };
        render();
    }
    /** Hatayı ait olduğu adımda gösterir ve oraya götürür. */
    function wrong(at, text, help) {
        wrongAt = { step: at, text, help };
        // Aynı adımda eski denetim sonucu da görünmesin.
        if (at === 'addr') { clearTimeout(addrTimer); addrSeq++; addrState = null; }
        render();
        const target = document.querySelector('.sync-step.bad');
        if (target) target.scrollIntoView({ block: 'center' });
        const i = document.getElementById('sync-in-' + at);
        if (i) i.focus();
    }
    async function search() {
        if (searching || busy || !(await allowNetwork())) return;
        searching = true;
        wrongAt = null;
        say('');
        render();
        let r;
        try { r = await api().sync_discover(); } catch (e) { r = { success: false, error: String(e) }; }
        searching = false;
        if (r && r.success) {
            found = r.found;
            if (found.length === 1) choose(found[0]);
        } else say((r && r.error) || T('Arama yapılamadı.'), true);
        render();
    }
    function choose(d) {
        form.addr = d.addr;
        if (wrongAt && wrongAt.step === 'addr') wrongAt = null;
        checkAddr();
    }
    async function doPair() {
        if (busy) return;
        wrongAt = null;
        const folder = pickedFolder();
        if (!form.addr.trim()) return wrong('addr', T('Önce bilgisayarı seç ya da adresini yaz.'));
        if (addrShape(form.addr) !== 'ok') return wrong('addr', T('Adres eksik ya da hatalı.'), HELP.addr[1]);
        if (digits().length !== 8) return wrong('code', digits().length ? T('Kod 8 haneli; {n} hane eksik.', { n: 8 - digits().length }) : T('Bilgisayarda görünen kodu yaz.'));
        if (!folder) return wrong('folder', T('Önce klasör seç.'));
        if (!(await allowNetwork())) return;
        clearTimeout(addrTimer);
        addrSeq++;
        addrState = null;
        busy = true;
        stage = 0;
        say('');
        render();
        const bar = document.querySelector('.sync-stages');
        if (bar) bar.scrollIntoView({ block: 'center' });
        const name = (window.MDFlowMobile && window.MDFlowMobile.deviceName && window.MDFlowMobile.deviceName()) || T('Telefon');
        let r;
        try { r = await api().sync_pair(form.addr, form.code, name, folder); } catch (e) { r = { success: false, error: String(e) }; }
        busy = false;
        stage = -1;
        if (!r || !r.success) {
            const h = HELP[r && r.at] || HELP.host;
            return wrong(h[0], (r && r.error) || T('Eşleştirilemedi.'), h[1]);
        }
        form = { addr: '', code: '', folder: '' };
        found = null;
        showToast(T('Eşleşti: {name}', { name: (r.link && r.link.name) || T('bilgisayar') }));
        status = r;
        render();
        page.scrollIntoView({ block: 'start' });
        syncNow(true);
    }
    function renderLink() {
        const l = status.link;
        if (!l) {
            const s = section(T('Bilgisayara bağlan'));
            s.appendChild(el('p', 'sync-intro', T('Dört adım; hesap ve ücret yok. İki aygıt aynı Wi-Fi’de olsun.')));
            const bad = (at) => !!wrongAt && wrongAt.step === at;
            const tell = (box, at) => { if (bad(at)) box.appendChild(state('bad', wrongAt.text, wrongAt.help)); };

            step(s, 1, T('Bilgisayarda kodu göster'), T('MD Flow › Ayarlar › Eşitleme: “Eşitleme açık”ı işaretle, “Kod göster”e bas.'));

            const a = step(s, 2, T('Bilgisayarı bul'), null, !!addrState && addrState.kind === 'ok', bad('addr'));
            const find = button(searching ? T('Aranıyor…') : found ? T('Yeniden ara') : T('Ara'), search, (found ? '' : 'primary ') + 'sync-wide');
            find.disabled = busy || searching;
            a.appendChild(find);
            if (searching) a.appendChild(state('wait', T('Ağdaki bilgisayarlar aranıyor…')));
            else if (found && !found.length && !form.addr) a.appendChild(state('bad', T('Ağda bilgisayar bulunamadı. Adresini aşağıya yazabilirsin.'), [OPEN_HOST, SAME_NET, FIREWALL]));
            else if (found && found.length > 1 && !form.addr) a.appendChild(state('idle', T('{n} bilgisayar bulundu, birini seç.', { n: found.length })));
            (found || []).forEach((d) => {
                a.appendChild(button(d.name + '  ·  ' + d.addr.split(':')[0], () => choose(d), 'sync-host' + (form.addr === d.addr ? ' primary' : '')));
            });
            a.appendChild(el('span', 'settings-hint', T('ya da bilgisayarda görünen adres')));
            a.appendChild(input('addr', T('Örn. 192.168.1.5'), 'decimal'));
            if (addrState) {
                a.appendChild(state(addrState.kind, addrState.text, addrState.help));
                if (addrState.kind === 'bad' && addrShape(form.addr) === 'ok') a.appendChild(button(T('Yeniden dene'), checkAddr));
            }
            tell(a, 'addr');

            const n = digits().length;
            const c = step(s, 3, T('Kodu yaz'), n && n < 8 ? T('{n} / 8 hane', { n }) : T('Bilgisayarda görünen 8 hane'), n === 8 && !bad('code'), bad('code'));
            const code = input('code', '1234 5678', 'numeric');
            code.setAttribute('aria-label', T('8 haneli kod'));
            code.classList.add('sync-codein');
            c.appendChild(code);
            tell(c, 'code');

            const f = step(s, 4, T('Telefondaki klasör'), T('Notlar bu klasörle eşitlenir'), !!pickedFolder() && !bad('folder'), bad('folder'));
            f.appendChild(folderBox(pickedFolder(), (p) => {
                form.folder = p;
                if (bad('folder')) wrongAt = null;
                render();
            }));
            tell(f, 'folder');

            s.appendChild(button(busy ? T('Eşleştiriliyor…') : T('Eşleştir'), doPair, 'primary sync-wide'));
            if (stage >= 0) {
                const box = el('div', 'sync-stages');
                [T('Bilgisayara bağlanılıyor'), T('Kod doğrulanıyor')].forEach((t, i) => {
                    box.appendChild(state(i < stage ? 'ok' : i === stage ? 'wait' : 'idle', t + (i === stage ? '…' : '')));
                });
                s.appendChild(box);
            }
            return;
        }
        const s = section(l.name);
        const going = syncing || busy || status.running;
        s.appendChild(going ? state('wait', progress ? T('Eşitleniyor… {progress} dosya', { progress }) : T('{name} ile bağlantı kuruluyor…', { name: l.name }))
            : linkError ? state('bad', linkError, [OPEN_HOST, SAME_NET])
                : state(l.last ? 'ok' : 'idle', l.last ? T('Eşleşti ve eşitlendi') : T('Eşleşti, henüz eşitlenmedi')));
        s.appendChild(row(T('Son eşitleme'), ago(l.last), button(going ? T('Eşitleniyor…') : linkError ? T('Yeniden dene') : T('Şimdi eşitle'), () => syncNow(true), 'primary')));
        s.appendChild(row(T('Otomatik eşitle'), T('Uygulama açıkken ve not kaydedilince'),
            toggle(T('Otomatik eşitle'), l.auto, (on) => run(() => api().sync_set_link(null, on)))));
        s.appendChild(folderRow(T('Telefondaki klasör'), null, l.folder, (p) => run(() => api().sync_set_link(p, null))));
        s.appendChild(row(T('Bağlantı'), T('Notlar iki tarafta da kalır'), button(T('Bağlantıyı kaldır'), async () => {
            if (await UiDialog.confirm(T('{name} ile bağlantı kaldırılsın mı?', { name: l.name }), { okText: T('Kaldır'), cancelText: T('Vazgeç') })) run(() => api().sync_unlink());
        })));
    }

    function render() {
        if (!page || !visible) return;
        // Önce ayrı bir sayfada kurulur; odaktaki kutu yerinde kalır (klavye kapanmasın).
        const live = page;
        const active = document.activeElement;
        page = el('div');
        build();
        const fresh = active && active.id && live.contains(active) ? page.querySelector('#' + active.id) : null;
        if (fresh && !fresh.disabled) swap(live, page, active, fresh);
        else live.replaceChildren(...page.childNodes);
        page = live;
        countdown();
    }
    /** old'un çocuklarını next'inkilerle değiştirir; keep ve üstündekiler yerinde kalır. */
    function swap(old, next, keep, fresh) {
        const stay = [...old.childNodes].find((c) => c.contains(keep));
        const twin = [...next.childNodes].find((c) => c.contains(fresh));
        const all = [...next.childNodes];
        const at = all.indexOf(twin);
        [...old.childNodes].forEach((c) => { if (c !== stay) c.remove(); });
        stay.before(...all.slice(0, at));
        stay.after(...all.slice(at + 1));
        if (stay !== keep) {
            stay.className = twin.className;
            swap(stay, twin, keep, fresh);
        } else if (keep.value !== fresh.value) keep.value = fresh.value;
    }
    function build() {
        if (!status) {
            page.appendChild(el('p', 'sync-intro', T('Eşitleme yalnız uygulamanın içinde kullanılabilir.')));
            return;
        }
        const n = el('p', 'sync-note' + (noteError ? ' error' : ''), note);
        n.setAttribute('role', 'status');
        n.hidden = !note;
        page.appendChild(n);
        if (mobile()) renderLink();
        else renderHost();
        const how = section(T('Nasıl çalışır'));
        const ul = el('ul', 'sync-how');
        [T('Aynı not iki tarafta da değişirse ikisi de kalır: biri “çakışma” kopyası olur.'),
            T('Silinen not diğer tarafta klasördeki .trash içine taşınır.'),
            T('O an düzenlediğin notun üzerine yazılmaz; düzenleme bitince eşitlenir.'),
            T('İki aygıtta Tailscale kuruluysa aynı ağda olmasanız da bilgisayarın 100.x adresiyle çalışır.')].forEach((t) => ul.appendChild(el('li', '', t)));
        how.appendChild(ul);
    }

    function summary(r) {
        const parts = [];
        if (r.down) parts.push(T('{n} alındı', { n: r.down }));
        if (r.up) parts.push(T('{n} gönderildi', { n: r.up }));
        if (r.removed) parts.push(T('{n} silindi', { n: r.removed }));
        if (r.conflicts) parts.push(T('{n} çakışma kopyası', { n: r.conflicts }));
        if (r.deferred) parts.push(T('{n} not düzenlendiği için bekliyor', { n: r.deferred }));
        if (r.failed && r.failed.length) parts.push(T('{n} dosya yapılamadı ({file})', { n: r.failed.length, file: r.failed[0] }));
        return parts.length ? parts.join(', ') : T('Her şey güncel');
    }

    let syncing = false;
    /** manual: sonucu ve hatayı göster; otomatikte yalnız değişiklik bildirilir. */
    async function syncNow(manual) {
        if (!api() || !api().sync_now) return;
        if (syncing) {
            if (manual && !visible) showToast(T('Zaten eşitleniyor…'));
            return;
        }
        if (manual && !(await allowNetwork())) return;
        syncing = true;
        progress = '';
        document.documentElement.classList.add('syncing');
        if (manual && !visible) showToast(T('Eşitleniyor…'));
        render();
        lastTry = Date.now();
        let r = null;
        try {
            r = await api().sync_now(false);
            if (r && r.confirm) {
                if (!manual) {
                    // Toplu silme kendiliğinden yapılmaz; kullanıcı elle eşitleyince sorulur.
                    say(T('{n} not silinecek görünüyor; onay için “Şimdi eşitle”ye bas.', { n: r.deletes }), true);
                    r = null;
                } else if (await UiDialog.confirm(T('Eşitleme {n} notu silecek. Bu klasörü bilerek mi boşalttın?\nSilinenler .trash klasörüne taşınır.', { n: r.deletes }),
                    { okText: T('Sil ve eşitle'), cancelText: T('Vazgeç') })) {
                    r = await api().sync_now(true);
                } else r = null;
            }
        } catch (e) { r = { success: false, error: String(e) }; }
        syncing = false;
        document.documentElement.classList.remove('syncing');
        progress = '';
        if (r && !r.busy) linkError = r.success ? '' : r.error;
        if (r && r.success && !r.busy) {
            say(summary(r));
            if (manual || r.down || r.removed || r.conflicts) showToast(T('Eşitlendi: {summary}', { summary: summary(r) }));
        } else if (r && !r.success && manual) {
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
        const typing = hasUnsavedChanges || Date.now() - lastTyped < 8000;
        const path = isEditMode && typing && currentFilePath ? currentFilePath : null;
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
        native.onSyncEvent(async (e) => {
            if (e.kind.startsWith('progress:')) {
                progress = e.kind.slice(9);
                return render();
            }
            if (e.kind === 'pair-verify') {
                if (stage === 0) { stage = 1; render(); }
                return;
            }
            if (hostEvent(e.kind)) {
                if (!visible && hostSay.kind === 'bad') showToast(hostSay.text);
                return refresh();
            }
            if (e.kind === 'paired') {
                hostSay = null;
                await refresh();
                const peers = status ? status.host.peers : [];
                pairedName = (peers[peers.length - 1] || {}).name || T('Telefon');
                showToast(T('{name} eşleşti', { name: pairedName }));
            } else pairedName = '';
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
        let ticks = 0;
        clearInterval(poll);
        if (!on) return;
        render();
        refresh();
        poll = setInterval(() => {
            countdown();
            if (!busy && status && status.host.pairing && ++ticks % 5 === 0) refresh();
        }, 1000);
    }

    return { init, shown, saved, syncNow, linked: () => !!(status && status.link) };
})();
