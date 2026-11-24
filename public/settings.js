/**
 * Kullanıcı tercihleri, ayarlar ekranı ve tema galerisi.
 * Tercihler ayar dosyasına düz anahtarlar olarak yazılır (app.js collectSettings).
 * Görsel tercihler <html> üstünde data-* özniteliği olur, karşılıkları settings.css'te.
 */
const PREF_DEFAULTS = {
    // görünüm
    accent: '', uiScale: 'm', density: 'normal', corners: 'normal', background: 'none',
    sidebarWidth: 'normal', statusBar: true, reduceMotion: false,
    // okuma
    fontSize: 'm', readingWidth: 'normal', readingFont: 'sans', customFont: '', lineHeight: 'normal',
    paragraphGap: 'normal', textAlign: 'left', headingStyle: 'default', linkStyle: 'default',
    tableStyle: 'default', imageStyle: 'default', backlinks: true, docMeta: true,
    // kod
    codeWrap: false, codeTheme: 'auto', codeSize: 'm',
    // düzenleme
    editorFont: 'mono', editorSize: 'm', spellcheck: false,
    // davranış
    openMode: 'read', reopenLast: false, alwaysStartAtTop: false, imageZoom: true,
    // tema
    followSystem: false, lightTheme: 'minimal-light', darkTheme: 'slate-dark',
    favoriteThemes: [], customThemes: [],
    autoUpdate: true, customCss: '',
};
const FONT_STACKS = {
    sans: null, // style.css varsayılanı
    humanist: "Optima, Candara, 'Noto Sans', 'Gill Sans', 'Trebuchet MS', sans-serif",
    rounded: "ui-rounded, 'SF Pro Rounded', Nunito, Quicksand, 'Varela Round', 'Arial Rounded MT Bold', sans-serif",
    serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif",
    book: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, 'Source Serif 4', 'Noto Serif', serif",
    slab: "Rockwell, 'Roboto Slab', 'Rokkitt', 'DejaVu Serif', 'Noto Serif', serif",
    mono: 'var(--font-mono)',
    custom: null,
};
const PREF_CHOICES = {
    uiScale: { s: '14.5px', m: '', l: '17.5px', xl: '19.5px' },
    density: { compact: 1, normal: 1, roomy: 1 },
    corners: { sharp: '3px', normal: '', round: '18px' },
    background: { none: 1, dots: 1, grid: 1, lines: 1, glow: 1 },
    sidebarWidth: { narrow: '230px', normal: '', wide: '350px' },
    fontSize: { xs: 0.82, s: 0.9, m: 1, l: 1.15, xl: 1.3, xxl: 1.5 },
    readingWidth: { narrow: '640px', medium: '780px', normal: '1400px', full: 'none' },
    readingFont: FONT_STACKS,
    lineHeight: { tight: 1, normal: 1, relaxed: 1, loose: 1 },
    paragraphGap: { tight: 1, normal: 1, loose: 1 },
    textAlign: { left: 1, justify: 1 },
    headingStyle: { default: 1, plain: 1, accent: 1, bar: 1, center: 1 },
    linkStyle: { default: 1, underline: 1, plain: 1, pill: 1 },
    tableStyle: { default: 1, grid: 1, minimal: 1, striped: 1 },
    imageStyle: { default: 1, rounded: 1, frame: 1, shadow: 1 },
    codeTheme: { auto: 1, light: 1, dark: 1 },
    codeSize: { s: 0.86, m: 1, l: 1.14 },
    editorFont: { mono: 1, reading: 1 },
    editorSize: { s: 0.88, m: 1, l: 1.15, xl: 1.3 },
    openMode: { read: 1, edit: 1 },
};
const ACCENTS = ['#e5484d', '#f76b15', '#e5a000', '#46a758', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#a18072'];
/** <html data-…> olarak yazılan tercihler; varsayılan değerde öznitelik konmaz. */
const DATA_PREFS = ['density', 'corners', 'background', 'lineHeight', 'paragraphGap', 'textAlign', 'headingStyle',
    'linkStyle', 'tableStyle', 'imageStyle', 'codeTheme', 'editorFont'];

let prefs = { ...PREF_DEFAULTS };

function normalizePrefs(raw) {
    const out = { ...PREF_DEFAULTS };
    if (!raw || typeof raw !== 'object') raw = {};
    out.customThemes = Themes.setCustom(raw.customThemes).map(({ kind, ...t }) => t);
    for (const key of Object.keys(PREF_DEFAULTS)) {
        const v = raw[key];
        if (v === undefined || key === 'customThemes') continue;
        if (PREF_CHOICES[key]) {
            if (Object.prototype.hasOwnProperty.call(PREF_CHOICES[key], v)) out[key] = v;
        } else if (key === 'lightTheme' || key === 'darkTheme') {
            const t = Themes.find(v);
            if (t && Themes.isDark(t.id) === (key === 'darkTheme')) out[key] = v;
        } else if (key === 'favoriteThemes') {
            if (Array.isArray(v)) out[key] = v.filter((id) => Themes.find(id));
        } else if (key === 'accent') {
            if (v === '' || Themes.isHex(v)) out[key] = v;
        } else if (typeof v === typeof PREF_DEFAULTS[key]) {
            out[key] = v;
        }
    }
    return out;
}

const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function systemTheme() {
    return darkQuery && darkQuery.matches ? prefs.darkTheme : prefs.lightTheme;
}

if (darkQuery) {
    const onSystemChange = () => { if (prefs.followSystem) setTheme(systemTheme()); };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemChange);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemChange);
}

// Yazı tipi adı CSS'e yazılır: tırnak ve ayraçlar atılır.
function cleanFontName(name) {
    return String(name || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60);
}

function applyPrefs() {
    const el = document.documentElement;
    const mobile = el.classList.contains('mobile');
    const set = (name, value) => {
        if (value) el.style.setProperty(name, value);
        else el.style.removeProperty(name);
    };
    el.style.fontSize = PREF_CHOICES.uiScale[prefs.uiScale];
    set('--md-scale', String(PREF_CHOICES.fontSize[prefs.fontSize]));
    set('--md-width', PREF_CHOICES.readingWidth[prefs.readingWidth]);
    set('--border-radius', PREF_CHOICES.corners[prefs.corners]);
    set('--sidebar-width', mobile ? '' : PREF_CHOICES.sidebarWidth[prefs.sidebarWidth]);
    set('--code-scale', String(PREF_CHOICES.codeSize[prefs.codeSize]));
    set('--editor-scale', String(PREF_CHOICES.editorSize[prefs.editorSize]));
    const name = cleanFontName(prefs.customFont);
    const font = prefs.readingFont === 'custom'
        ? (name ? `'${name}', var(--font-ui)` : null) : FONT_STACKS[prefs.readingFont];
    set('--font-reading', font);
    set('--font-heading', font);
    DATA_PREFS.forEach((key) => {
        const attr = 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
        if (prefs[key] === PREF_DEFAULTS[key]) el.removeAttribute(attr);
        else el.setAttribute(attr, prefs[key]);
    });
    el.classList.toggle('code-wrap', prefs.codeWrap);
    el.classList.toggle('img-zoom-on', prefs.imageZoom);
    el.classList.toggle('no-motion', prefs.reduceMotion);
    el.classList.toggle('no-status', !prefs.statusBar);
    el.classList.toggle('no-backlinks', !prefs.backlinks);
    el.classList.toggle('no-doc-meta', !prefs.docMeta);
    applyAccent();
    applyCodeTheme();
    applyCustomCss(prefs.customCss);
}

function applyAccent() {
    const style = document.documentElement.style;
    const theme = Themes.find(currentTheme);
    const v = Themes.accentVars(prefs.accent || '#000000', prefs.accent && theme ? theme.ac2 : '#000000');
    Object.keys(v).forEach((k) => {
        if (prefs.accent) style.setProperty(k, v[k]);
        else style.removeProperty(k);
    });
}

// Kod vurgusu: temayla birlikte ya da kullanıcının seçtiği tonda
function applyCodeTheme() {
    const dark = prefs.codeTheme === 'auto' ? Themes.isDark(currentTheme) : prefs.codeTheme === 'dark';
    const hljsLight = document.getElementById('hljs-light');
    const hljsDark = document.getElementById('hljs-dark');
    if (hljsLight) hljsLight.disabled = dark;
    if (hljsDark) hljsDark.disabled = !dark;
}

function applyCustomCss(css) {
    let el = document.getElementById('user-custom-css');
    if (!css) {
        if (el) el.remove();
        return;
    }
    if (!el) {
        el = document.createElement('style');
        el.id = 'user-custom-css';
        document.head.appendChild(el); // style.css'ten sonra: aynı seçici kazanır
    }
    el.textContent = css;
}

// Kullanıcı bir temayı elle seçti (galeri, palet, komut).
function chooseTheme(theme) {
    if (prefs.followSystem) {
        // Seçilen tema, kendi türünün (açık/koyu) sistem tercihi olur; sistem
        // şu an diğer moddaysa takip kapanır ki seçim görünsün.
        const isDark = Themes.isDark(theme);
        prefs[isDark ? 'darkTheme' : 'lightTheme'] = theme;
        const systemDark = !!(darkQuery && darkQuery.matches);
        if (isDark !== systemDark) {
            prefs.followSystem = false;
            showToast('Sistem teması takibi kapatıldı');
        }
    }
    setTheme(theme);
    saveSettings();
}

function setTheme(theme) {
    if (!Themes.find(theme)) theme = 'minimal-light';
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    applyAccent();
    applyCodeTheme();
    rerenderMermaid();
    syncSettingsPanel();
}

function setPref(key, value) {
    prefs[key] = value;
    if (key === 'followSystem' || key === 'lightTheme' || key === 'darkTheme') {
        if (prefs.followSystem) setTheme(systemTheme());
    }
    applyPrefs();
    syncSettingsPanel();
    saveSettings();
}

function toggleFavoriteTheme(id) {
    const f = prefs.favoriteThemes;
    setPref('favoriteThemes', f.includes(id) ? f.filter((x) => x !== id) : f.concat(id));
}

// ============================================================
// TEMA GALERİSİ: ayarlardaki büyük hali ve üst bardaki küçük hali aynı kod
// ============================================================
const galleries = [];

function createThemeGallery(box, opts) {
    const state = { filter: 'all', query: '' };
    const bar = document.createElement('div');
    bar.className = 'tg-bar';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'tg-search';
    search.placeholder = 'Tema ara…';
    search.setAttribute('aria-label', 'Tema ara');
    search.addEventListener('input', () => { state.query = search.value; draw(); });
    const chips = document.createElement('div');
    chips.className = 'tg-chips';
    [['all', 'Tümü'], ['light', 'Açık'], ['dark', 'Koyu'], ['fav', 'Favori'], ['custom', 'Benim']].forEach(([id, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.dataset.filter = id;
        b.addEventListener('click', () => { state.filter = id; draw(); });
        chips.appendChild(b);
    });
    bar.append(search, chips);
    const grid = document.createElement('div');
    grid.className = 'theme-grid';
    const empty = document.createElement('p');
    empty.className = 'tg-empty';
    box.append(bar, grid, empty);

    function shown(t) {
        if (state.filter === 'light' && Themes.isDark(t.id)) return false;
        if (state.filter === 'dark' && !Themes.isDark(t.id)) return false;
        if (state.filter === 'fav' && !prefs.favoriteThemes.includes(t.id)) return false;
        if (state.filter === 'custom' && t.kind !== 'custom') return false;
        return Notes.fold(t.name).includes(Notes.fold(state.query.trim()));
    }
    function card(t) {
        const fav = prefs.favoriteThemes.includes(t.id);
        const el = document.createElement('div');
        el.className = 'theme-card' + (t.id === currentTheme ? ' active' : '');
        el.dataset.themeValue = t.id;
        el.style.cssText = `--tc-bg:${t.bg};--tc-fg:${t.fg};--tc-ac:${t.ac};--tc-ac2:${t.ac2}`;
        el.innerHTML = '<button type="button" class="theme-card-main"><span class="theme-card-preview"><u></u><span><b></b><i></i><i></i><em></em></span></span>' +
            '<span class="theme-card-name"></span></button>';
        const main = el.querySelector('.theme-card-main');
        main.title = t.name;
        main.setAttribute('aria-pressed', t.id === currentTheme ? 'true' : 'false');
        el.querySelector('.theme-card-name').textContent = t.name;
        main.addEventListener('click', () => {
            chooseTheme(t.id);
            if (opts.onPick) opts.onPick();
        });
        const act = (cls, svg, label, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'theme-card-act ' + cls;
            b.title = label;
            b.setAttribute('aria-label', label + ': ' + t.name);
            b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svg + '</svg>';
            b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
            el.appendChild(b);
        };
        act('fav' + (fav ? ' on' : ''), '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-3-5.3 3 1.1-6L3.400 9.800l6-.8z"/>',
            fav ? 'Favoriden çıkar' : 'Favoriye ekle', () => toggleFavoriteTheme(t.id));
        if (t.kind === 'custom' && !opts.compact) {
            act('edit', '<path d="M4 20h4L19 9l-4-4L4 16z"/>', 'Düzenle', () => ThemeEditor.open(t));
        }
        return el;
    }
    function draw() {
        chips.querySelectorAll('button').forEach((b) => {
            b.classList.toggle('active', b.dataset.filter === state.filter);
            b.setAttribute('aria-pressed', b.dataset.filter === state.filter ? 'true' : 'false');
        });
        // Önce kendi temaları, sonra açıklar, sonra koyular
        const rank = (t) => (t.kind === 'custom' ? 0 : Themes.isDark(t.id) ? 2 : 1);
        const items = THEMES.filter(shown).sort((a, b) => rank(a) - rank(b));
        const top = grid.scrollTop;
        const focused = grid.contains(document.activeElement) && document.activeElement.closest('.theme-card');
        const cls = focused && document.activeElement.className.split(' ')[1];
        const key = focused && focused.dataset.themeValue;
        grid.replaceChildren(...items.map(card));
        grid.scrollTop = top;
        if (key) {
            const again = grid.querySelector(`[data-theme-value="${key}"] ${cls ? '.' + cls : '.theme-card-main'}`);
            if (again) again.focus({ preventScroll: true });
        }
        empty.hidden = items.length > 0;
        empty.textContent = state.filter === 'fav' ? 'Favori tema yok. Kartın yıldızına basarak ekle.'
            : state.filter === 'custom' ? 'Henüz kendi teman yok.' : 'Eşleşen tema yok.';
    }
    const gallery = { draw, visible: opts.visible };
    galleries.push(gallery);
    return gallery;
}

function drawGalleries() {
    galleries.forEach((g) => { if (g.visible()) g.draw(); });
}

// ============================================================
// KENDİ TEMANI YAP
// ============================================================
const ThemeEditor = (function () {
    let draft = null;
    let editing = null;
    const FIELDS = [['bg', 'Zemin'], ['fg', 'Yazı'], ['ac', 'Vurgu'], ['ac2', 'İkinci vurgu']];
    const $ = (id) => document.getElementById(id);

    function paint() {
        const v = Themes.vars({ ...draft, id: draft.id || (Themes.isDarkColor(draft.bg) ? 'x-dark' : 'x-light') });
        const p = $('te-preview');
        Object.keys(v).forEach((k) => p.style.setProperty(k, v[k]));
        const c = Themes.contrast(draft.fg, draft.bg);
        const a = Themes.contrast(draft.ac, draft.bg);
        $('te-warn').textContent = c < 4.5 ? 'Yazı bu zeminde zor okunur; rengi koyult ya da aç.'
            : a < 2.5 ? 'Vurgu rengi zemine çok yakın.' : '';
    }
    function fill() {
        FIELDS.forEach(([k]) => {
            $('te-' + k).value = draft[k];
            $('te-' + k + '-hex').value = draft[k];
        });
        $('te-name').value = draft.name;
        $('te-delete').hidden = !editing;
        paint();
    }
    function open(theme) {
        editing = theme && theme.kind === 'custom' ? theme.id : null;
        const from = theme || Themes.find(currentTheme);
        draft = { name: editing ? from.name : 'Temam', bg: from.bg, fg: from.fg, ac: from.ac, ac2: from.ac2 };
        $('theme-editor').hidden = false;
        fill();
        $('theme-editor').scrollIntoView({ block: 'nearest' });
        $('te-name').focus({ preventScroll: true });
    }
    function close() { $('theme-editor').hidden = true; }

    function store(list) {
        prefs.customThemes = Themes.setCustom(list).map(({ kind, ...t }) => t);
        prefs.favoriteThemes = prefs.favoriteThemes.filter((id) => Themes.find(id));
        if (!Themes.find(prefs.lightTheme)) prefs.lightTheme = PREF_DEFAULTS.lightTheme;
        if (!Themes.find(prefs.darkTheme)) prefs.darkTheme = PREF_DEFAULTS.darkTheme;
        fillThemeSelects();
    }
    function save() {
        const dark = Themes.isDarkColor(draft.bg);
        // Zemin açıktan koyuya dönerse kimlik de değişir (ek, temanın türüdür).
        const keep = editing && Themes.isDark(editing) === dark;
        const id = keep ? editing : Themes.newId(dark);
        const theme = { ...draft, name: $('te-name').value.trim() || 'Temam', id };
        const rest = prefs.customThemes.filter((t) => t.id !== editing);
        if (!keep && rest.length >= 40) return showToast('En çok 40 özel tema olabilir');
        store(rest.concat(theme));
        close();
        chooseTheme(id);
    }
    async function remove() {
        if (!(await UiDialog.confirm('Bu tema silinsin mi?', { okText: 'Sil', cancelText: 'Vazgeç' }))) return;
        const was = currentTheme === editing;
        store(prefs.customThemes.filter((t) => t.id !== editing));
        close();
        if (was) chooseTheme(prefs.followSystem ? systemTheme() : 'minimal-light');
        else { drawGalleries(); saveSettings(); }
    }
    function init() {
        const fields = $('te-fields');
        FIELDS.forEach(([k, label]) => {
            const row = document.createElement('label');
            row.className = 'te-field';
            row.innerHTML = `<span>${label}</span><input type="color" id="te-${k}" aria-label="${label} rengi"><input type="text" id="te-${k}-hex" maxlength="7" spellcheck="false" aria-label="${label} kodu">`;
            fields.appendChild(row);
            $('te-' + k).addEventListener('input', (e) => { draft[k] = e.target.value; $('te-' + k + '-hex').value = e.target.value; paint(); });
            $('te-' + k + '-hex').addEventListener('input', (e) => {
                let v = e.target.value.trim();
                if (v && v[0] !== '#') v = '#' + v;
                const ok = Themes.isHex(v);
                e.target.classList.toggle('invalid', !ok);
                if (ok) { draft[k] = v.toLowerCase(); $('te-' + k).value = draft[k]; paint(); }
            });
        });
        $('btn-new-theme').addEventListener('click', () => open(null));
        $('te-save').addEventListener('click', save);
        $('te-cancel').addEventListener('click', close);
        $('te-delete').addEventListener('click', remove);
        $('te-swap').addEventListener('click', () => {
            draft = { ...draft, bg: draft.fg, fg: draft.bg };
            fill();
        });
    }
    return { init, open, close };
})();

// ============================================================
// AYARLAR EKRANI
// ============================================================
const seg = (pref, label, options, hint) => ({ kind: 'seg', pref, label, options, hint });
const sw = (pref, label, hint, only) => ({ kind: 'switch', pref, label, hint, only });
const pick = (pref, label, options, hint) => ({ kind: 'select', pref, label, options, hint });

const SETTING_ROWS = {
    look: [
        { title: 'Arayüz' },
        seg('uiScale', 'Arayüz boyutu', { s: 'Küçük', m: 'Normal', l: 'Büyük', xl: 'Çok büyük' }),
        seg('density', 'Yoğunluk', { compact: 'Sıkı', normal: 'Normal', roomy: 'Ferah' }, 'Liste ve menü satırlarının aralığı'),
        seg('corners', 'Köşeler', { sharp: 'Keskin', normal: 'Normal', round: 'Yuvarlak' }),
        { ...seg('sidebarWidth', 'Kenar çubuğu', { narrow: 'Dar', normal: 'Normal', wide: 'Geniş' }), only: 'desktop' },
        pick('background', 'Sayfa zemini', { none: 'Düz', dots: 'Noktalı', grid: 'Kareli', lines: 'Çizgili', glow: 'Işıltı' }),
        sw('statusBar', 'Durum çubuğu', 'Yol, kelime sayısı ve okuma ilerlemesi', 'desktop'),
        sw('reduceMotion', 'Hareketi azalt', 'Geçiş ve canlandırmaları kapatır'),
    ],
    read: [
        { title: 'Yazı' },
        seg('fontSize', 'Yazı boyutu', { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL', xxl: 'XXL' }),
        pick('readingFont', 'Yazı tipi', { sans: 'Sans', humanist: 'Hümanist', rounded: 'Yuvarlak', serif: 'Serif', book: 'Kitap', slab: 'Slab', mono: 'Mono', custom: 'Kendi yazı tipim…' }),
        { kind: 'text', pref: 'customFont', label: 'Yazı tipi adı', hint: 'Aygıtta yüklü bir yazı tipinin adı', placeholder: 'Örn. Inter', showIf: () => prefs.readingFont === 'custom' },
        seg('lineHeight', 'Satır aralığı', { tight: 'Sıkı', normal: 'Normal', relaxed: 'Rahat', loose: 'Geniş' }),
        seg('paragraphGap', 'Paragraf aralığı', { tight: 'Sıkı', normal: 'Normal', loose: 'Geniş' }),
        seg('textAlign', 'Hizalama', { left: 'Sola', justify: 'İki yana' }),
        { ...seg('readingWidth', 'Okuma genişliği', { narrow: 'Dar', medium: 'Orta', normal: 'Geniş', full: 'Tam' }), only: 'desktop' },
        { title: 'Öğeler' },
        pick('headingStyle', 'Başlıklar', { default: 'Varsayılan', plain: 'Yalın', accent: 'Renkli', bar: 'Kenar çizgili', center: 'Ortalı' }),
        pick('linkStyle', 'Bağlantılar', { default: 'Varsayılan', underline: 'Altı çizili', plain: 'Yalın', pill: 'Vurgulu zemin' }),
        pick('tableStyle', 'Tablolar', { default: 'Varsayılan', grid: 'Kılavuzlu', minimal: 'Yalın', striped: 'Şeritli' }),
        pick('imageStyle', 'Görseller', { default: 'Varsayılan', rounded: 'Yuvarlak köşe', frame: 'Çerçeveli', shadow: 'Gölgeli' }),
        sw('backlinks', 'Geri bağlantılar', 'Bu nota bağlanan notları sonda göster'),
        sw('docMeta', 'Kelime ve okuma süresi', 'Notun başında göster', 'mobile'),
        { title: 'Kod blokları' },
        seg('codeTheme', 'Kod renkleri', { auto: 'Temayla', light: 'Açık', dark: 'Koyu' }),
        seg('codeSize', 'Kod boyutu', { s: 'Küçük', m: 'Normal', l: 'Büyük' }),
        sw('codeWrap', 'Satır kaydır', 'Uzun satırlar yatay kaydırma yerine alt satıra geçer'),
    ],
    edit: [
        { title: 'Düzenleyici' },
        seg('editorFont', 'Yazı tipi', { mono: 'Mono', reading: 'Okuma tipi' }),
        seg('editorSize', 'Yazı boyutu', { s: 'Küçük', m: 'Normal', l: 'Büyük', xl: 'Çok büyük' }),
        { kind: 'switch', label: 'Satır numaraları', key: 'lines', get: () => lineNumbersOn, set: (v) => { applyLineNumbers(v); saveSettings(); } },
        { kind: 'switch', label: 'Otomatik kaydet', key: 'autosave', hint: 'Yazdıkça dosyaya kaydeder', get: () => chkAutosave.checked,
            set: (v) => { chkAutosave.checked = v; chkAutosave.dispatchEvent(new Event('change')); saveSettings(); } },
        sw('spellcheck', 'Yazım denetimi', 'Sistemin sözlüğü varsa hatalı sözcüklerin altını çizer'),
    ],
    behave: [
        { title: 'Açılış' },
        seg('openMode', 'Uygulama şu modda açılsın', { read: 'Oku', edit: 'Düzenle' }),
        sw('reopenLast', 'Son notu aç', 'Dosya seçmeden açılınca en son okuduğun not gelir', 'desktop'),
        sw('alwaysStartAtTop', 'Belgeyi hep baştan aç', 'Kapalıyken kaldığın yerden devam eder'),
        { title: 'Görseller' },
        sw('imageZoom', 'Tıklayınca yakınlaştır', 'Okuma modunda görsel büyütülebilir pencerede açılır'),
    ],
};

function buildRow(row) {
    if (row.title) {
        const h = document.createElement('h3');
        h.textContent = row.title;
        return h;
    }
    const el = document.createElement('div');
    el.className = 'settings-row';
    const label = document.createElement('span');
    label.className = 'settings-label';
    label.textContent = row.label;
    if (row.hint) {
        const hint = document.createElement('span');
        hint.className = 'settings-hint';
        hint.textContent = row.hint;
        label.appendChild(hint);
    }
    el.appendChild(label);
    if (row.only) el.dataset.only = row.only;
    if (row.kind === 'seg') {
        const box = document.createElement('div');
        box.className = 'seg';
        box.dataset.pref = row.pref;
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', row.label);
        Object.entries(row.options).forEach(([v, text]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.value = v;
            b.textContent = text;
            b.addEventListener('click', () => setPref(row.pref, v));
            box.appendChild(b);
        });
        el.appendChild(box);
    } else if (row.kind === 'select') {
        const s = document.createElement('select');
        s.dataset.pref = row.pref;
        s.setAttribute('aria-label', row.label);
        Object.entries(row.options).forEach(([v, text]) => s.add(new Option(text, v)));
        s.addEventListener('change', () => setPref(row.pref, s.value));
        el.appendChild(s);
    } else if (row.kind === 'text') {
        const i = document.createElement('input');
        i.type = 'text';
        i.className = 'settings-input';
        i.placeholder = row.placeholder || '';
        i.setAttribute('aria-label', row.label);
        i.dataset.pref = row.pref;
        i.addEventListener('change', () => setPref(row.pref, i.value.trim()));
        el.appendChild(i);
    } else {
        const l = document.createElement('label');
        l.className = 'switch';
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.setAttribute('aria-label', row.label);
        if (row.pref) c.dataset.pref = row.pref;
        else c.dataset.key = row.key;
        c.addEventListener('change', () => (row.set ? row.set(c.checked) : setPref(row.pref, c.checked)));
        l.append(c, document.createElement('span'));
        el.appendChild(l);
    }
    row.el = el;
    return el;
}

function fillThemeSelects() {
    document.querySelectorAll('#settings-panel select[data-theme-pref]').forEach((sel) => {
        const dark = sel.dataset.themePref === 'darkTheme';
        sel.replaceChildren(...THEMES.filter((t) => Themes.isDark(t.id) === dark).map((t) => new Option(t.name, t.id)));
        sel.value = prefs[sel.dataset.themePref];
    });
}

const SettingsNav = (function () {
    let current = 'theme';
    const panel = () => document.getElementById('settings-panel');

    /** detail: telefonda bölüm açık mı, yoksa bölüm listesi mi */
    function show(id, detail) {
        current = id;
        panel().querySelectorAll('.settings-nav button').forEach((b) => {
            b.classList.toggle('active', b.dataset.section === id);
            b.setAttribute('aria-current', b.dataset.section === id ? 'page' : 'false');
        });
        panel().querySelectorAll('.settings-page').forEach((p) => { p.hidden = p.dataset.section !== id; });
        panel().classList.toggle('m-detail', !!detail);
        const b = panel().querySelector(`.settings-nav [data-section="${id}"]`);
        document.getElementById('settings-title').textContent =
            detail && document.documentElement.classList.contains('mobile') && b ? b.querySelector('b').textContent : 'Ayarlar';
        panel().querySelector('.settings-body').scrollTop = 0;
        drawGalleries();
        if (typeof SyncUi !== 'undefined') SyncUi.shown(id === 'sync');
    }
    function search(q) {
        q = Notes.fold(q.trim());
        panel().classList.toggle('searching', !!q);
        panel().querySelectorAll('.search-hit, .search-miss').forEach((e) => e.classList.remove('search-hit', 'search-miss'));
        if (!q) {
            show(current, panel().classList.contains('m-detail'));
            return;
        }
        let any = false;
        panel().querySelectorAll('.settings-page').forEach((p) => {
            const page = panel().querySelector(`.settings-nav [data-section="${p.dataset.section}"] b`).textContent;
            const whole = Notes.fold(page).includes(q);
            let hit = whole;
            p.querySelectorAll('.settings-row').forEach((r) => {
                const label = r.querySelector('.settings-label');
                const ok = whole || (label && Notes.fold(label.textContent).includes(q));
                r.classList.toggle('search-miss', !ok);
                if (ok && getComputedStyle(r).display !== 'none') hit = true;
            });
            p.hidden = !hit;
            any = any || hit;
        });
        document.getElementById('settings-none').hidden = any;
    }
    /** Telefonda bölümden listeye döner; dönecek yer yoksa false. */
    function back() {
        if (!panel().classList.contains('m-detail') || !document.documentElement.classList.contains('mobile')) return false;
        show(current, false);
        return true;
    }
    return { show, search, back, current: () => current };
})();

function setupSettingsPanel() {
    if (!settingsPanel) return;
    if (btnSettings) btnSettings.addEventListener('click', () => openSettingsPanel());

    Object.entries(SETTING_ROWS).forEach(([id, rows]) => {
        const host = settingsPanel.querySelector(`[data-section="${id}"] .settings-rows`);
        let section = null;
        rows.forEach((row) => {
            if (row.title || !section) {
                section = document.createElement('section');
                section.className = 'settings-section';
                host.appendChild(section);
            }
            section.appendChild(buildRow(row));
        });
    });

    settingsPanel.querySelectorAll('.settings-nav button').forEach((b) =>
        b.addEventListener('click', () => {
            document.getElementById('settings-search').value = '';
            SettingsNav.search('');
            SettingsNav.show(b.dataset.section, true);
        }));
    const search = document.getElementById('settings-search');
    search.addEventListener('input', () => SettingsNav.search(search.value));

    // Tema sayfası
    const settingsOpen = () => !settingsPanel.classList.contains('hidden') && SettingsNav.current() === 'theme';
    createThemeGallery(document.getElementById('settings-gallery'), { visible: settingsOpen });
    ThemeEditor.init();
    document.getElementById('btn-random-theme').addEventListener('click', () => {
        const others = THEMES.filter((t) => t.id !== currentTheme);
        chooseTheme(others[Math.floor(Math.random() * others.length)].id);
    });
    const accents = document.getElementById('accent-row');
    [''].concat(ACCENTS).forEach((hex) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'accent-dot' + (hex ? '' : ' auto');
        b.dataset.accent = hex;
        b.title = hex || 'Temanın rengi';
        b.setAttribute('aria-label', hex ? 'Vurgu rengi ' + hex : 'Temanın vurgu rengi');
        if (hex) b.style.background = hex;
        b.addEventListener('click', () => setPref('accent', hex));
        accents.appendChild(b);
    });
    const own = document.createElement('input');
    own.type = 'color';
    own.id = 'accent-own';
    own.title = 'Kendi rengin';
    own.setAttribute('aria-label', 'Kendi vurgu rengin');
    own.addEventListener('change', () => setPref('accent', own.value));
    accents.appendChild(own);
    settingsPanel.querySelectorAll('select[data-theme-pref]').forEach((s) =>
        s.addEventListener('change', () => setPref(s.dataset.themePref, s.value)));
    fillThemeSelects();
    // HTML'de yazılı anahtarlar (tema takibi, güncelleme)
    settingsPanel.querySelectorAll('input[type="checkbox"][data-static]').forEach((c) =>
        c.addEventListener('change', () => setPref(c.dataset.pref, c.checked)));

    // Özel CSS: yazdıkça uygula, kısa beklemeyle kaydet
    const cssBox = document.getElementById('custom-css');
    let cssTimer = null;
    cssBox.addEventListener('input', () => {
        prefs.customCss = cssBox.value;
        applyCustomCss(prefs.customCss);
        clearTimeout(cssTimer);
        cssTimer = setTimeout(saveSettings, 500);
    });
    // Sekme tuşu odak değiştirmesin, girinti eklesin
    cssBox.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || e.shiftKey) return;
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b } = cssBox;
        cssBox.setRangeText('    ', a, b, 'end');
        cssBox.dispatchEvent(new Event('input'));
    });

    // Ayarları taşıma
    document.getElementById('btn-export-prefs').addEventListener('click', async () => {
        const text = JSON.stringify({ mdflow: 1, theme: currentTheme, ...prefs });
        showToast((await copyToClipboard(text)) ? 'Ayarlar panoya kopyalandı' : 'Panoya kopyalanamadı');
    });
    document.getElementById('btn-import-prefs').addEventListener('click', async () => {
        const text = await UiDialog.prompt('Kopyaladığın ayarları yapıştır:', { placeholder: '{"mdflow":1,…}', okText: 'Uygula' });
        if (!text) return;
        let data = null;
        try { data = JSON.parse(text); } catch (e) { /* aşağıda */ }
        if (!data || data.mdflow !== 1) return UiDialog.alert('Bu metin MD Flow ayarı değil.');
        prefs = normalizePrefs(data);
        fillThemeSelects();
        applyPrefs();
        setTheme(prefs.followSystem ? systemTheme() : data.theme);
        saveSettings();
        showToast('Ayarlar uygulandı');
    });

    // Yazım denetimi her düzenleme kutusu odaklanınca uygulanır
    document.addEventListener('focusin', (e) => {
        if (e.target.classList && e.target.classList.contains('block-textarea')) e.target.spellcheck = prefs.spellcheck;
    });

    document.getElementById('btn-settings-back').addEventListener('click', () => SettingsNav.back());
    document.getElementById('btn-settings-close').addEventListener('click', closeSettingsPanel);
    document.getElementById('btn-settings-done').addEventListener('click', closeSettingsPanel);
    document.getElementById('btn-settings-reset').addEventListener('click', async () => {
        if (!(await UiDialog.confirm('Tüm ayarlar varsayılana dönsün mü? Özel CSS silinir; kendi temaların kalır.',
            { okText: 'Sıfırla', cancelText: 'Vazgeç' }))) return;
        prefs = { ...PREF_DEFAULTS, customThemes: prefs.customThemes };
        applyPrefs();
        setTheme('minimal-light');
        saveSettings();
    });
    settingsPanel.addEventListener('mousedown', (e) => {
        if (e.target === settingsPanel) closeSettingsPanel();
    });
    document.addEventListener('keydown', (e) => {
        if (settingsPanel.classList.contains('hidden') || document.querySelector('.ui-dialog-backdrop')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            if (search.value) { search.value = ''; SettingsNav.search(''); }
            else closeSettingsPanel();
        } else if (e.key === 'Tab') {
            // Odak pencerede kalsın
            const f = [...settingsPanel.querySelectorAll('button, input, select, textarea, summary')].filter((x) => x.offsetParent && !x.disabled);
            const first = f[0];
            const last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === ',' && !document.querySelector('.ui-dialog-backdrop')) {
            e.preventDefault();
            openSettingsPanel();
        }
    });

    setupThemePopover();
}

// Üst bardaki palet düğmesi: küçük galeri
function setupThemePopover() {
    const btn = document.getElementById('btn-theme-menu');
    const pop = document.getElementById('theme-popover');
    if (!btn || !pop) return;
    const isOpen = () => pop.classList.contains('open');
    const gallery = createThemeGallery(document.getElementById('popover-gallery'), { compact: true, visible: isOpen });
    const setOpen = (open) => {
        pop.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (!open) return;
        gallery.draw();
        const active = pop.querySelector('.theme-card.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
        pop.querySelector('.tg-search').focus();
    };
    btn.addEventListener('click', () => setOpen(!isOpen()));
    document.getElementById('btn-all-themes').addEventListener('click', () => {
        setOpen(false);
        openSettingsPanel('theme');
    });
    // mousedown: kart tıklanınca galeri yeniden çizilir, click anında hedef kopmuş olur
    document.addEventListener('mousedown', (e) => {
        if (isOpen() && !e.target.closest('#theme-group')) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) { setOpen(false); btn.focus(); }
    });
}

let settingsReturnFocus = null;
function openSettingsPanel(section) {
    if (typeof section !== 'string') section = ''; // düğmeye doğrudan bağlanınca olay gelir
    if (settingsPanel.classList.contains('hidden')) settingsReturnFocus = document.activeElement;
    settingsPanel.classList.remove('hidden');
    document.getElementById('settings-search').value = '';
    SettingsNav.search('');
    SettingsNav.show(section || SettingsNav.current(), !!section);
    syncSettingsPanel();
    const nav = settingsPanel.querySelector('.settings-nav button.active');
    if (nav && !document.documentElement.classList.contains('mobile')) nav.focus();
}
function closeSettingsPanel() {
    if (settingsPanel.classList.contains('hidden')) return;
    ThemeEditor.close();
    settingsPanel.classList.add('hidden');
    settingsPanel.classList.remove('m-detail');
    if (typeof SyncUi !== 'undefined') SyncUi.shown(false);
    if (settingsReturnFocus && typeof settingsReturnFocus.focus === 'function') settingsReturnFocus.focus();
}

// Paneldeki kontrolleri güncel duruma getir.
function syncSettingsPanel() {
    if (!settingsPanel) return;
    drawGalleries();
    settingsPanel.querySelectorAll('.seg[data-pref] button').forEach((b) => {
        const on = b.dataset.value === prefs[b.parentElement.dataset.pref];
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    settingsPanel.querySelectorAll('input[type="checkbox"][data-pref]').forEach((c) => { c.checked = !!prefs[c.dataset.pref]; });
    settingsPanel.querySelectorAll('select[data-pref]').forEach((s) => { s.value = prefs[s.dataset.pref]; });
    settingsPanel.querySelectorAll('select[data-theme-pref]').forEach((s) => { s.value = prefs[s.dataset.themePref]; });
    settingsPanel.querySelectorAll('input[type="text"][data-pref]').forEach((i) => {
        if (document.activeElement !== i) i.value = prefs[i.dataset.pref];
    });
    Object.values(SETTING_ROWS).flat().forEach((row) => {
        if (!row.el) return;
        if (row.get) row.el.querySelector('input').checked = row.get();
        if (row.showIf) row.el.hidden = !row.showIf();
    });
    settingsPanel.querySelectorAll('[data-follow-only]').forEach((r) => r.classList.toggle('disabled', !prefs.followSystem));
    settingsPanel.querySelectorAll('.accent-dot').forEach((b) => b.classList.toggle('active', b.dataset.accent === prefs.accent));
    const own = document.getElementById('accent-own');
    if (own) {
        own.classList.toggle('active', !!prefs.accent && !ACCENTS.includes(prefs.accent));
        own.value = prefs.accent || (Themes.find(currentTheme) || {}).ac || '#4f46e5';
    }
    const cssBox = document.getElementById('custom-css');
    if (cssBox && document.activeElement !== cssBox) cssBox.value = prefs.customCss;
}
