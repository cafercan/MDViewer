// INITIAL CONFIGURATION FOR EXTERNAL LIBRARIES
// Mermaid (~3 MB) açılışta yüklenmez: ilk diyagramda ya da ilk çizimden sonra
// pencere boştayken bir kez yüklenir (sayfa hiç yeniden yüklenmediği için
// gezgin geçişlerinde tekrar yüklenmez).
const MERMAID_SRC = '/vendor/mermaid/mermaid.min.js';
let mermaidReady = null;

function ensureMermaid() {
    if (!mermaidReady) {
        mermaidReady = LazyScript.once(MERMAID_SRC).then(initMermaid).catch((err) => {
            mermaidReady = null;
            throw err;
        });
    }
    return mermaidReady;
}

// Diyagramları çizer. Kaynak metin data-src'de saklanır: tema değişince
// (rerenderMermaid) SVG atılıp aynı kaynaktan yeni renklerle yeniden çizilir.
function runMermaid(nodes) {
    nodes.forEach((node) => {
        if (node.dataset.src === undefined) node.dataset.src = node.textContent;
    });
    return ensureMermaid()
        .then(() => mermaid.run({ nodes }))
        .catch(err => {
            console.error('Mermaid render hatası:', err);
        });
}

function rerenderMermaid() {
    if (!mermaidReady) return; // henüz yüklenmedi: ilk çizimde doğru temayla başlar
    const nodes = document.querySelectorAll('.mermaid[data-src]');
    mermaidReady.then(() => {
        initMermaid();
        if (!nodes.length) return;
        nodes.forEach((node) => {
            node.removeAttribute('data-processed');
            node.textContent = node.dataset.src;
        });
        return mermaid.run({ nodes });
    }).catch(err => console.error('Mermaid yeniden çizim hatası:', err));
}

let mermaidPreloadScheduled = false;
function scheduleMermaidPreload() {
    if (mermaidPreloadScheduled) return;
    mermaidPreloadScheduled = true;
    const run = () => ensureMermaid().catch(() => { /* asıl ihtiyaçta yeniden denenir */ });
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 5000 });
    } else {
        setTimeout(run, 1500);
    }
}

// Uygulama teması koyuysa Mermaid'in koyu teması, değilse varsayılan (açık).
function mermaidThemeFor(appTheme) {
    return String(appTheme || '').endsWith('-dark') ? 'dark' : 'default';
}

function initMermaid() {
    mermaid.initialize({
        startOnLoad: false,
        theme: mermaidThemeFor(currentTheme),
        // 'strict': mermaid, etiket içeriğindeki HTML'i temizler ve tıklama/JS
        // yönlendirmelerini kapatır. Güvenilmeyen bir .md dosyasındaki diyagram
        // kodunun script çalıştırmasını engeller.
        securityLevel: 'strict',
        flowchart: { useMaxWidth: true, htmlLabels: false, curve: 'basis' }
    });
}

// Obsidian tarzı [[wikilink]] desteği (public/wikilink.js). Hedef tıklamada
// çözülür: bkz. handleDocumentLinkClick -> openWikilink.
if (typeof Wikilink !== 'undefined') {
    marked.use({ extensions: [Wikilink.extension()] });
}

// Belge başındaki YAML frontmatter'ı tablo olarak göster (public/frontmatter.js).
if (typeof Frontmatter !== 'undefined') {
    marked.use({ extensions: [Frontmatter.extension()] });
}

// > [!NOTE] kutuları ve ==vurgu== (public/callouts.js).
if (typeof Callouts !== 'undefined') {
    marked.use({ extensions: Callouts.extensions() });
}

// Oturum içi depolama. Private mode'daki WebKit (2.x'te pywebview/GTK)
// localStorage'ı tamamen kapatır: değişken hiç tanımlı olmaz ve dokunmak
// ReferenceError fırlatır. O durumda bellek içi Map'e düşülür; taslaklar yine
// aynı oturum boyunca korunur (Windows/WebView2'deki davranışla aynı).
const storage = (() => {
    try {
        const s = window.localStorage;
        s.setItem('__md_flow_probe', '1');
        s.removeItem('__md_flow_probe');
        return s;
    } catch (_) {
        const m = new Map();
        return {
            getItem: (k) => (m.has(k) ? m.get(k) : null),
            setItem: (k, v) => { m.set(k, String(v)); },
            removeItem: (k) => { m.delete(k); }
        };
    }
})();

// APPLICATION STATE
let currentFilePath = '';
let currentContent = '';
let isEditMode = false;
let stopWatch = null;
let autosaveTimer = null;
let headingElements = [];
let hasUnsavedChanges = false;
let currentTheme = 'minimal-light';
let lineNumbersOn = false;

// Eski sürümlerden kalan taslakları bir kez temizle (bkz. drafts.js).
if (typeof Drafts !== 'undefined') Drafts.purgeLegacy(storage);

// Yerel görseller uygulamanın mdasset protokolünden gelir (bridge.js).
if (window.MDFlowNative && typeof AssetUrl !== 'undefined') {
    AssetUrl.setBuilder(window.MDFlowNative.assetUrl);
}

// DOM ELEMENTS
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const fileNameDisplay = document.getElementById('file-name-display');
const currentFileBadge = document.getElementById('current-file');

const btnReadMode = document.getElementById('btn-read-mode');
const btnEditMode = document.getElementById('btn-edit-mode');
const btnSave = document.getElementById('btn-save');
const btnExportPdf = document.getElementById('btn-export-pdf');
const btnOpenFile = document.getElementById('btn-open-file');
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnRecentFiles = document.getElementById('btn-recent-files');
const btnRecentFolders = document.getElementById('btn-recent-folders');
const btnNavBack = document.getElementById('btn-nav-back');
const btnNavForward = document.getElementById('btn-nav-forward');

const sidebar = document.getElementById('sidebar');
const sidebarGrip = document.getElementById('sidebar-grip');
const tocList = document.getElementById('toc-list');
const sidebarTabs = document.getElementById('sidebar-tabs');
const explorerSection = document.getElementById('explorer-section');
const explorerTree = document.getElementById('explorer-tree');
const explorerRootLabel = document.getElementById('explorer-root');
const btnExplorerUp = document.getElementById('explorer-up');
const btnExplorerLock = document.getElementById('explorer-lock');

const paneRead = document.getElementById('pane-read');
const paneEdit = document.getElementById('pane-edit');
const markdownViewer = document.getElementById('markdown-viewer');
const liveHost = document.getElementById('live-editor');
const chkAutosave = document.getElementById('chk-autosave');
const btnLineNumbers = document.getElementById('btn-line-numbers');
const btnSettings = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const saveStatus = document.getElementById('save-status');


// Sayfa içi arama (find bar)
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const btnFindPrev = document.getElementById('btn-find-prev');
const btnFindNext = document.getElementById('btn-find-next');
const btnFindClear = document.getElementById('btn-find-clear');

// APP INIT
window.addEventListener('DOMContentLoaded', () => {
    const settingsReady = loadSettings();
    const docReady = initApp(settingsReady);
    setupEventListeners();
    Reader.init();
    if (!window.MDFlowMobile) Palette.init();
    settingsReady.then(startUpdater);
    settingsReady.then(() => SyncUi.init());
    Promise.all([settingsReady, docReady]).then(() => {
        if (prefs.openMode === 'edit' && !isEditMode) btnEditMode.click();
    });
});

// MAIN CONTROLLER INITIALIZATION
async function initApp(settingsReady) {
    // 1. Uygulama olayları. Açılış belgesi sorulmadan ÖNCE kurulur: uygulama
    // arayüzün sorduğu andan sonra gelen belgeyi (macOS "Birlikte Aç") olayla
    // iletir; dinleyici yoksa o belge kaybolurdu.
    const native = nativeApi();
    if (native) {
        await native.onOpenFile((path) => openRecentFile(path));

        // Sürükle-bırak: .md dosyası açılır, klasör çalışma alanı olur
        await native.onDropped((drop) => {
            if (drop.kind === 'file') openRecentFile(drop.path);
            else if (drop.kind === 'folder') openWorkspacePath(drop.path);
        });

        // Kaydedilmemiş değişiklikle kapanırken sor
        // (Tauri işleyiciyi bekleyip sonra preventDefault'a bakar: async uygundur.)
        await native.onCloseRequested(async (event) => {
            commitCell();
            if (hasUnsavedChanges && await flushAutosave()) return;
            if (!hasUnsavedChanges) return;
            const close = await UiDialog.confirm('Kaydedilmemiş değişiklikler var. Yine de kapatılsın mı?',
                { okText: 'Kapat', cancelText: 'Vazgeç' });
            if (!close) event.preventDefault();
            else markSaved(); // kullanıcı değişiklikleri bıraktı
        });
    }

    // 2. Açılış belgesi
    await settingsReady;
    const fileParam = await getInitialFile();

    // 3. Fetch file content (ilk giriş: geçmişe yeni kayıt ekleme, mevcut olanı yaz)
    await loadFile(fileParam || '', { replaceHistory: true });

    // 4. Gezgin
    initExplorer();
}

// Kendi kendini güncelleme (updater.js). Kurulum uygulamayı kapatır: açık
// düzenleme önce kaydedilir; kaydedilemezse güncellemeden vazgeçilir.
function startUpdater() {
    if (typeof Updater === 'undefined') return;
    Updater.start({
        enabled: () => prefs.autoUpdate,
        currentFile: () => currentFilePath,
        openPage: (url) => nativeApi().open_external(url),
        prepare: async () => {
            if (isEditMode) {
                commitCell();
            }
            if (!hasUnsavedChanges) return true;
            if (!chkAutosave.checked && !(await UiDialog.confirm('Kaydedilmemiş değişiklikler kaydedilip güncellensin mi?',
                { okText: 'Kaydet ve güncelle', cancelText: 'Vazgeç' }))) return false;
            clearTimeout(autosaveTimer);
            await saveFile();
            if (hasUnsavedChanges) showToast('Belge kaydedilemedi; güncelleme durduruldu');
            return !hasUnsavedChanges;
        },
        // Android: kurulumu sistem ekranı yapar (mobile.js)
        finish: (result) => (window.MDFlowMobile ? window.MDFlowMobile.installUpdate(result) : true),
    });
}

// Açılış belgesinin tek okuma noktası. Adres çubuğunda ?file= varsa (sayfa
// yenilendi) o; yoksa uygulamanın verdiği belge (komut satırı / Birlikte Aç).
async function getInitialFile() {
    const fromUrl = new URLSearchParams(window.location.search).get('file');
    if (fromUrl) return fromUrl;
    const native = nativeApi();
    if (!native) return '';
    try {
        const file = await native.initial_file();
        if (file || !prefs.reopenLast || window.MDFlowMobile) return file || '';
        const recent = (await native.recent_list()).files[0];
        return (recent && (await native.open_file_path(recent))) || '';
    } catch (e) {
        console.error('Açılış belgesi alınamadı:', e);
        return '';
    }
}

// FETCH AND RENDER A MARKDOWN FILE
// options.replaceHistory : geçmişte yeni kayıt yerine mevcut kaydı güncelle (ilk yükleme)
// options.pushHistory    : false ise geçmişe dokunma (popstate ile geri/ileri)
// options.anchor         : yüklendikten sonra kaydırılacak başlık (#parça)
async function loadFile(filePath, options = {}) {
    const { replaceHistory = false, pushHistory = true, anchor = '' } = options;
    try {
        setSyncStatus('syncing', 'Dosya yükleniyor...');
        
        const native = nativeApi();
        if (!native) throw new Error('Belgeler yalnızca MD Flow Viewer uygulama penceresinde açılır.');
        const data = await native.content(filePath || null);

        if (data.success) {
            // Ayrılınan belgenin kaydırma konumunu sakla (geri dönünce oradan sürsün)
            if (currentFilePath) scrollPositions.set(currentFilePath, captureScrollPosition());
            currentFilePath = data.path;
            currentContent = data.content;
            markSaved();
            
            // Update UI elements
            fileNameDisplay.textContent = data.name;
            fileNameDisplay.title = data.path;
            currentFileBadge.title = data.path;
            document.title = `${data.name} - MD Flow Viewer`;
            
            // Set URL parameter without reloading page
            const newUrl = `${window.location.origin}${window.location.pathname}?file=${encodeURIComponent(data.path)}`;
            if (replaceHistory) {
                window.history.replaceState({ path: data.path }, '', newUrl);
            } else if (pushHistory) {
                window.history.pushState({ path: data.path }, '', newUrl);
            }
            
            // Render Content based on active mode
            if (isEditMode) {
                loadIntoEditor(currentContent);
                Reader.refresh();
            } else {
                renderMarkdown(currentContent);
            }
            
            // Establish Live Connection
            setupFileWatcher(data.path);
            setSyncStatus('connected', 'Bağlandı');
            
            // Gezgindeki aktif dosya vurgusunu güncelle
            highlightActiveFile();

            // Önce sıfırla (eski belgenin kaydırması kalmasın); sonra #parça varsa
            // ona, yoksa (ayar kapalıysa) bu belgede kalınan yere git.
            paneRead.scrollTop = 0;
            if (isEditMode) LiveEditor.scroller().scrollTop = 0;
            const saved = scrollPositions.get(data.path);
            if (anchor) scrollToAnchor(anchor);
            else if (saved && !prefs.alwaysStartAtTop) restoreScrollPosition(saved);
        } else {
            throw new Error(data.error || 'Bilinmeyen sunucu hatası');
        }
    } catch (error) {
        console.error('Dosya yükleme hatası:', error);
        setSyncStatus('error', 'Yükleme hatası');
        if (currentFilePath && filePath !== currentFilePath) {
            // Açık bir belge varken bağlantı/geçmiş üzerinden gelen hata belgeyi
            // silmesin; kullanıcı olduğu yerde kalsın.
            UiDialog.alert('Dosya açılamadı: ' + error.message);
            return;
        }
        markdownViewer.innerHTML = `<div class="danger-box">
            <h4>Dosya Yüklenirken Hata Oluştu</h4>
            <p>${error.message}</p>
        </div>`;
    }
}

// Bağlantıdaki #parça için başlığı bul: id'nin slug kısmı ya da metnin
// slug'ı eşleşsin (GitHub tarzı "#bolum-adi" bağlantıları).
function findHeadingByAnchor(anchor) {
    let wanted = anchor;
    try { wanted = decodeURIComponent(anchor); } catch (e) { /* ham hali */ }
    wanted = wanted.toLowerCase().trim();
    if (!wanted) return null;
    const byId = isEditMode ? null : document.getElementById(wanted);
    if (byId) return byId;
    return headingElements.find((h) => {
        const idSlug = h.id.replace(/^h-\d+-/, '');
        return idSlug === wanted || idSlug === wanted.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
    }) || null;
}

// ============================================================
// BELGE BAŞINA KAYDIRMA KONUMU
// Konum piksel yerine kaynaktaki (kesirli) satır numarasıdır: okuma ve
// düzenleme aynı yere döner. Yalnız bu oturum için bellekte saklanır.
// ============================================================
const scrollPositions = new Map(); // yol -> satır
let scrollRestoreToken = 0;

// Okuma görünümündeki blokların kaynak satırları: [{el, from, to}].
function readBlocks() {
    const els = Array.from(markdownViewer.children);
    const total = currentContent.split('\n').length;
    const spans = [];
    let line = 1;
    for (const t of marked.lexer(currentContent)) {
        const n = (t.raw.match(/\n/g) || []).length;
        if (t.type !== 'space' && t.type !== 'def') spans.push([line, line + Math.max(1, n)]);
        line += n;
    }
    // HTML blokları birden çok öğe üretebilir: o belgede oranla yetin
    return els.map((el, i) => {
        const s = spans.length === els.length ? spans[i]
            : [1 + total * i / els.length, 1 + total * (i + 1) / els.length];
        return { el, from: s[0], to: s[1] };
    });
}

function readTopLine() {
    if (paneRead.scrollTop < 4) return 1;
    const top = paneRead.getBoundingClientRect().top;
    const blocks = readBlocks();
    const b = blocks.find((x) => x.el.getBoundingClientRect().bottom > top + 4);
    if (!b) return 1;
    const r = b.el.getBoundingClientRect();
    return b.from + Math.max(0, (top - r.top) / Math.max(1, r.height)) * (b.to - b.from);
}

function readScrollToLine(line) {
    if (line <= 1.01) { paneRead.scrollTop = 0; return; }
    const blocks = readBlocks();
    const b = blocks.find((x) => line < x.to) || blocks[blocks.length - 1];
    if (!b) return;
    const r = b.el.getBoundingClientRect();
    const inside = Math.max(0, (line - b.from) / (b.to - b.from)) * r.height;
    paneRead.scrollTo({ top: paneRead.scrollTop + r.top - paneRead.getBoundingClientRect().top + inside, behavior: 'instant' });
}

function captureScrollPosition() { return isEditMode ? LiveEditor.topLine() : readTopLine(); }

function restoreScrollPosition(line) {
    const token = ++scrollRestoreToken;
    const scroller = isEditMode ? LiveEditor.scroller() : paneRead;
    let userScrolled = false;
    const onUser = () => { userScrolled = true; };
    const userEvents = ['wheel', 'pointerdown', 'keydown', 'touchstart'];
    userEvents.forEach((ev) => scroller.addEventListener(ev, onUser, { passive: true, once: true }));
    const apply = () => {
        if (token !== scrollRestoreToken || userScrolled) return;
        if (isEditMode) LiveEditor.scrollToLine(line);
        else readScrollToLine(line);
    };
    apply();
    // Görseller / mermaid / hljs yerleşimi değiştirebilir: kısa süre yeniden uygula.
    requestAnimationFrame(apply);
    setTimeout(apply, 160);
    if (!isEditMode) {
        setTimeout(apply, 600);
        markdownViewer.querySelectorAll('img').forEach((img) => {
            if (!img.complete) img.addEventListener('load', apply, { once: true });
        });
    }
    setTimeout(() => {
        userEvents.forEach((ev) => scroller.removeEventListener(ev, onUser));
    }, 3000);
}

function scrollToAnchor(anchor) {
    const heading = findHeadingByAnchor(anchor);
    if (heading) scrollToHeading(heading);
}

// ============================================================
// BELGE İÇİ BAĞLANTILAR
// Tarayıcı göreli href'leri sayfa adresine göre çözer; sunucuda öyle bir yol
// olmadığı için "Bulunamadı" gelirdi. Burada bağlantı belgenin klasörüne göre
// çözülür: .md -> uygulama içinde aç, diğer yerel dosya -> varsayılan
// uygulama, http(s) -> sistem tarayıcısı, #parça -> başlığa kaydır.
// ============================================================
async function handleDocumentLinkClick(e) {
    const link = e.target.closest('a[href]');
    if (!link || !markdownViewer.contains(link)) return;
    e.preventDefault();
    await openDocumentLink(link, e.ctrlKey);
}

async function openDocumentLink(link, ctrlKey) {
    if (link.dataset.wiki !== undefined) {
        await openWikilink(link.dataset.wiki, link.dataset.wikiAnchor || '');
        return;
    }
    const href = link.getAttribute('href');
    if (typeof AssetUrl === 'undefined') return;
    const info = AssetUrl.classifyLink(href, currentFilePath);

    switch (info.kind) {
        case 'anchor':
            scrollToAnchor(info.target);
            return;
        case 'external': {
            const api = nativeApi();
            if (api && typeof api.open_external === 'function') {
                const ok = await api.open_external(info.target);
                if (!ok) UiDialog.alert('Bu bağlantı açılamıyor: ' + info.target);
            } else {
                window.open(info.target, '_blank', 'noopener');
            }
            return;
        }
        case 'markdown':
            if (!(await confirmLeaveUnsaved())) return;
            await loadFile(info.target, { anchor: info.anchor || '' });
            return;
        case 'file':
            await openLocalTarget(info.target, ctrlKey);
            return;
        default:
            UiDialog.alert('Bağlantı çözülemedi: ' + info.target);
    }
}

// [[hedef]]: belgenin klasörü, sonra gezgin kökü/vault içinde dosya adıyla
// aranır (sunucu tarafı, bkz. Workspace.resolve_wikilink). Native köprü yoksa
// yalnızca belgenin klasörüne göre "hedef.md" denenir.
async function openWikilink(target, anchor) {
    if (!(await confirmLeaveUnsaved())) return;
    const api = nativeApi();
    let resolved = null;
    if (api && typeof api.resolve_wikilink === 'function') {
        try {
            resolved = await api.resolve_wikilink(target, currentFilePath);
        } catch (error) {
            console.error('Wikilink çözülemedi:', error);
        }
    } else if (typeof AssetUrl !== 'undefined') {
        const guess = /\.(md|markdown)$/i.test(target) ? target : target + '.md';
        resolved = AssetUrl.resolveLocalPath(guess, currentFilePath);
    }
    if (!resolved) {
        UiDialog.alert('Not bulunamadı: [[' + target + ']]\nBelgenin klasöründe ve gezgin kökünde arandı.');
        return;
    }
    await loadFile(resolved, { anchor });
}

// Geri/ileri: loadFile her belgede pushState yapar; popstate ile o kayda dönülür.
async function navigateHistory(delta) {
    if (!(await confirmLeaveUnsaved())) return;
    window.history.go(delta);
}

function onPopState(e) {
    const path = (e.state && e.state.path) || new URLSearchParams(window.location.search).get('file') || '';
    if (path === currentFilePath) return;
    loadFile(path, { pushHistory: false });
}

function highlightActiveFile() {
    document.querySelectorAll('.tree-file').forEach(item => {
        if (item.getAttribute('data-path') === currentFilePath) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// Otomatik kayıt açıksa bekleyen yazıyı hemen diske indirir. true = temiz.
async function flushAutosave() {
    commitCell();
    if (!hasUnsavedChanges) return true;
    if (!chkAutosave.checked || diskConflict) return false;
    clearTimeout(autosaveTimer);
    await saveFile();
    return !hasUnsavedChanges;
}

// Kaydedilmemiş değişiklik varsa kullanıcıya sorar. true = devam edilebilir.
async function confirmLeaveUnsaved() {
    if (await flushAutosave()) return true;
    const leave = await UiDialog.confirm('Kaydedilmemiş değişiklikleriniz var. Başka bir dosyaya geçmek istiyor musunuz?',
        { okText: 'Geç', cancelText: 'Vazgeç' });
    if (leave) {
        // Değişiklikler bırakıldı: bekleyen otomatik kayıt yazmasın.
        clearTimeout(autosaveTimer);
        markSaved();
    }
    return leave;
}

// ============================================================
// SIDEBAR SEKMELERİ (İçindekiler / Gezgin)
// ============================================================
let activeSidebarTab = 'toc';

function setSidebarTab(name, persist = true) {
    // Telefonda bu panel not listesidir; başlıklar ⋮ menüsündedir
    if (window.MDFlowMobile) name = 'explorer';
    if (!['toc', 'explorer'].includes(name)) name = 'toc';
    activeSidebarTab = name;
    sidebarTabs.querySelectorAll('.sidebar-tab').forEach((btn) => {
        const on = btn.dataset.tab === name;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    sidebar.querySelectorAll('.sidebar-section').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === name);
    });
    if (persist) saveSettings();
}

// ============================================================
// GEZGİN (dosya ağacı, vault kilidi, üst klasör)
// Klasör listeleme ve kök değişimi uygulama köprüsü (bridge.js) üzerinden
// yapılır: kök hapsi yalnızca uygulama penceresinden genişler.
// ============================================================
let explorerState = null; // { root, vault, locked, canUp }

// Tauri köprüsü sayfa betikleriyle birlikte hazırdır; bekleme gerekmez.
function whenNativeReady() {
    return Promise.resolve(nativeApi());
}

async function initExplorer() {
    const api = await whenNativeReady();
    if (!api || typeof api.explorer_state !== 'function') {
        explorerTree.innerHTML = '<span class="empty-state">Dosya gezgini yalnızca MD Flow Viewer uygulama penceresinde çalışır.</span>';
        btnExplorerUp.disabled = true;
        btnExplorerLock.disabled = true;
        return;
    }
    try {
        applyExplorerState(await api.explorer_state());
    } catch (error) {
        console.error('Gezgin başlatılamadı:', error);
        explorerTree.innerHTML = '<span class="empty-state">Gezgin yüklenemedi</span>';
    }
}

// Açık klasörler: ağaç yeniden çizilince (yeni not, taşıma…) kapanmasınlar.
const openDirs = new Set();
let openDirsRoot = null;

// map(yol): yeni yol | null (silindi) | undefined (değişmedi)
function remapOpenDirs(map) {
    for (const p of [...openDirs]) {
        const next = map(p);
        if (next === undefined) continue;
        openDirs.delete(p);
        if (next) openDirs.add(next);
    }
}

function refreshExplorer() { return applyExplorerState(explorerState); }

async function applyExplorerState(state) {
    explorerState = state || null;
    const root = state && state.root;
    if (root !== openDirsRoot) {
        openDirs.clear();
        openDirsRoot = root;
    }
    explorerSection.classList.toggle('locked', !!(state && state.locked));
    btnExplorerLock.setAttribute('aria-pressed', state && state.locked ? 'true' : 'false');
    btnExplorerLock.title = state && state.locked
        ? 'Sabitlemeyi kaldır (belge klasörüne dön)'
        : 'Bu klasörü sabitle (vault)';
    btnExplorerLock.disabled = !root;
    btnExplorerUp.disabled = !(state && state.canUp);
    explorerRootLabel.textContent = root ? (basename(root) || root) : 'Klasör yok';
    explorerRootLabel.title = root || '';

    const scroll = explorerTree.scrollTop;
    explorerTree.innerHTML = '';
    if (!root) {
        explorerTree.innerHTML = '<span class="empty-state">Bir dosya açın ya da klasör sabitleyin.</span>';
        return;
    }
    await renderDirChildren(explorerTree, root, 0);
    if (scroll) explorerTree.scrollTop = scroll;
}

function basename(p) {
    return String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

async function renderDirChildren(container, dirPath, depth) {
    const api = nativeApi();
    const note = document.createElement('span');
    note.className = 'tree-note';
    note.style.setProperty('--depth', depth);
    note.textContent = 'Yükleniyor...';
    container.appendChild(note);

    let data;
    try {
        data = await api.list_dir(dirPath);
    } catch (error) {
        data = { success: false, error: String(error) };
    }
    container.innerHTML = '';

    if (!data || !data.success) {
        const err = document.createElement('span');
        err.className = 'tree-note error';
        err.style.setProperty('--depth', depth);
        err.textContent = (data && data.error) || 'Klasör okunamadı';
        container.appendChild(err);
        return;
    }
    if (data.dirs.length === 0 && data.files.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'tree-note';
        empty.style.setProperty('--depth', depth);
        empty.textContent = depth === 0 ? 'Bu klasörde MD dosyası yok' : 'Boş';
        container.appendChild(empty);
        return;
    }
    const nodes = data.dirs.map((d) => buildDirNode(d, depth));
    nodes.forEach((n) => container.appendChild(n));
    data.files.forEach((f) => container.appendChild(buildFileRow(f, depth)));
    await Promise.all(nodes.map((n, i) => openDirs.has(data.dirs[i].path) && n.expandDir()));
}

const SVG_CHEVRON = '<svg class="tree-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
const SVG_FOLDER = '<svg class="tree-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const SVG_FILE = '<svg class="tree-file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

function buildDirNode(dir, depth) {
    const node = document.createElement('div');
    node.className = 'tree-node';

    const row = document.createElement('div');
    row.className = 'tree-row tree-dir';
    row.style.setProperty('--depth', depth);
    row.title = dir.path + '\nÜç kez tıkla: bu klasöre in (kilit açıkken)';
    row.setAttribute('data-path', dir.path);
    row.innerHTML = SVG_CHEVRON + SVG_FOLDER;
    const label = document.createElement('span');
    label.textContent = dir.name;
    row.appendChild(label);

    const children = document.createElement('div');
    children.className = 'tree-children';
    children.hidden = true;
    let loading = null;

    // Klasörü açar; alt öğeler yüklenince çözülen promise döner (revealInExplorer
    // bunu bekleyip bir alt seviyeye iner).
    const expand = () => {
        openDirs.add(dir.path);
        row.classList.add('open');
        children.hidden = false;
        if (!loading) loading = renderDirChildren(children, dir.path, depth + 1);
        return loading;
    };
    node.expandDir = expand;

    row.addEventListener('click', (e) => {
        // Üçlü tık (kilit açıkken): bu klasöre in, kök burası olsun.
        // Kilitliyken vault sabittir; kaç tık olsa da kök değişmez.
        if (e.detail === 3 && explorerState && !explorerState.locked) {
            explorerEnter(dir.path);
            return;
        }
        if (row.classList.contains('open')) {
            openDirs.delete(dir.path);
            row.classList.remove('open');
            children.hidden = true;
        } else {
            expand();
        }
    });

    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, Notes.folderMenuItems(dir.path));
    });

    node.appendChild(row);
    node.appendChild(children);
    return node;
}

// Yolları karşılaştırmak için: ayraçları birleştir, sondaki ayracı at,
// Windows'ta harf duyarsız.
function normPath(p) {
    return String(p).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

// Klasörü Gezgin sekmesinde göster: ağaçta kök -> hedef yolundaki her klasörü
// sırayla aç, hedef satırı vurgula ve görünür alana kaydır.
async function revealInExplorer(dirPath) {
    if (!explorerState || !explorerState.root) return false;
    const rootN = normPath(explorerState.root);
    const targetN = normPath(dirPath);
    if (targetN !== rootN && !targetN.startsWith(rootN + '/')) {
        // Kök dışında: kilit açıksa köke doğrudan o klasörü al, kilitliyse vault dışı.
        if (explorerState.locked) return false;
        const api = nativeApi();
        if (!api) return false;
        applyExplorerState(await api.explorer_enter(dirPath));
        setSidebarTab('explorer');
        sidebar.classList.remove('collapsed');
        return normPath(explorerState.root) === targetN;
    }

    setSidebarTab('explorer');
    sidebar.classList.remove('collapsed');
    explorerTree.querySelectorAll('.tree-dir.revealed').forEach((r) => r.classList.remove('revealed'));
    if (targetN === rootN) return true;

    const rest = targetN.slice(rootN.length + 1).split('/');
    let container = explorerTree;
    let prefix = rootN;
    let row = null;
    for (const seg of rest) {
        prefix += '/' + seg;
        row = Array.from(container.querySelectorAll(':scope > .tree-node > .tree-dir'))
            .find((r) => normPath(r.getAttribute('data-path')) === prefix);
        if (!row) return false;
        const node = row.parentElement;
        await node.expandDir();
        container = node.querySelector(':scope > .tree-children');
    }
    if (row) {
        row.classList.add('revealed');
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return true;
}

// Yerel dosya/klasör bağlantısı. Klasör: klasör notu varsa (README.md, index.md,
// _index.md, <ad>.md) onu aç; yoksa Gezgin'de göster. Ctrl+tık: sistemin
// dosya yöneticisinde aç. Dosya: varsayılan uygulamada aç.
async function openLocalTarget(absPath, ctrlKey) {
    const api = nativeApi();
    if (!api || typeof api.inspect_path !== 'function') {
        window.open(AssetUrl.resolveAssetUrl(absPath, currentFilePath), '_blank', 'noopener');
        return;
    }
    const info = await api.inspect_path(absPath);
    switch (info.type) {
        case 'dir':
            if (ctrlKey) {
                if (!(await api.open_in_file_manager(info.path))) UiDialog.alert('Klasör açılamadı: ' + info.path);
                return;
            }
            if (info.note) {
                if (!(await confirmLeaveUnsaved())) return;
                await loadFile(info.note);
                return;
            }
            if (!(await revealInExplorer(info.path))) {
                UiDialog.alert('Klasör gezgin kökünün dışında:\n' + info.path + '\nKilidi açıp üst klasöre çıkın ya da Ctrl+tık ile dosya yöneticisinde açın.');
            }
            return;
        case 'file':
            if (!(await api.open_path(info.path))) UiDialog.alert('Dosya açılamadı: ' + info.path);
            return;
        case 'denied':
            UiDialog.alert('Erişim reddedildi: çalışma klasörü dışında.\n' + info.path);
            return;
        default:
            UiDialog.alert('Bulunamadı: ' + (info.path || absPath));
    }
}

// ============================================================
// BAĞLAM MENÜSÜ (sağ tık) + PANOYA KOPYALA
// ============================================================
let contextMenuEl = null;
// Aynı düğmeye ikinci tıkta menü kapanıp hemen yeniden açılmasın: dışarı tık
// menüyü zaten kapatıyor, bu kayıt "kim kapattı" bilgisini tutar.
let lastMenuClose = { owner: null, at: 0 };

function hideContextMenu() {
    if (contextMenuEl) {
        lastMenuClose = { owner: contextMenuEl.dataset.owner || null, at: Date.now() };
        contextMenuEl.remove();
    }
    contextMenuEl = null;
}

function menuJustClosedFor(owner) {
    return lastMenuClose.owner === owner && Date.now() - lastMenuClose.at < 250;
}

// items: [{ label, hint?, title?, action?, disabled?, separator? }]. Menü
// imlecin yanında açılır; pencere kenarını taşarsa içeri çekilir.
function showContextMenu(x, y, items, owner) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    if (owner) menu.dataset.owner = owner;
    items.forEach((item) => {
        if (item.separator) {
            menu.appendChild(document.createElement('hr')).className = 'context-menu-sep';
            return;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'context-menu-item';
        if (item.title) btn.title = item.title;
        if (item.danger) btn.classList.add('danger');
        // Telefonda simgeyi alttan açılan menü kendi ekler (mobile.js sheet).
        if (item.icon && !window.MDFlowMobile) {
            const ico = document.createElement('span');
            ico.className = 'context-menu-icon';
            ico.innerHTML = Icons.svg(Icons.paths[item.icon], 16);
            btn.classList.add('with-icon');
            btn.appendChild(ico);
        }
        const label = document.createElement('span');
        label.className = 'context-menu-label';
        label.textContent = item.label;
        btn.appendChild(label);
        if (item.hint) {
            const hint = document.createElement('span');
            hint.className = 'context-menu-hint';
            hint.textContent = item.hint;
            btn.appendChild(hint);
        }
        if (item.disabled || !item.action) {
            btn.disabled = true;
        } else {
            btn.addEventListener('click', () => {
                hideContextMenu();
                item.action();
            });
        }
        menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) + 'px';
    contextMenuEl = menu;
}

// Menüyü bir düğmenin altına yasla (üst bardaki "son açılanlar" okları).
function showMenuUnder(anchorEl, items) {
    const rect = anchorEl.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, items, anchorEl.id || null);
}

// Panoya yaz. WebView2'de clipboard API izin/etkinleştirme nedeniyle
// düşebiliyor; o durumda gizli textarea + execCommand yedeği devreye girer.
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (error) {
        console.warn('clipboard API başarısız, yedeğe düşülüyor:', error);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch (error) {
        ok = false;
    }
    ta.remove();
    return ok;
}

let toastTimer = null;

function showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.className = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
}

function buildFileRow(file, depth) {
    const row = document.createElement('div');
    row.className = 'tree-row tree-file';
    row.style.setProperty('--depth', depth);
    row.setAttribute('data-path', file.path);
    row.title = file.path;
    if (file.path === currentFilePath) row.classList.add('active');
    row.innerHTML = SVG_FILE;
    const label = document.createElement('span');
    label.textContent = file.name;
    row.appendChild(label);
    row.addEventListener('click', () => Notes.open(file.path));
    // Sağ tık: sabitle, yeniden adlandır, yolu kopyala, sil (public/notes.js)
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, Notes.menuItems(file.path));
    });
    return row;
}

async function explorerEnter(dirPath) {
    const api = nativeApi();
    if (!api || !explorerState || explorerState.locked) return;
    try {
        applyExplorerState(await api.explorer_enter(dirPath));
    } catch (error) {
        console.error('Klasöre inilemedi:', error);
    }
}

async function explorerGoUp() {
    const api = nativeApi();
    if (!api || !explorerState || !explorerState.canUp) return;
    try {
        applyExplorerState(await api.explorer_up());
    } catch (error) {
        console.error('Üst klasöre çıkılamadı:', error);
    }
}

async function explorerToggleLock() {
    const api = nativeApi();
    if (!api || !explorerState || !explorerState.root) return;
    try {
        const next = explorerState.locked ? null : explorerState.root;
        applyExplorerState(await api.set_vault(next));
    } catch (error) {
        console.error('Sabitleme değiştirilemedi:', error);
    }
}

// CANLI YENİLEME: uygulama dosyayı izler, değişince 'file-changed' olayı gelir
// (bridge.js MDFlowNative.watch). Uygulamanın kendi kaydı olay üretmez.
async function setupFileWatcher(filePath) {
    if (stopWatch) {
        stopWatch();
        stopWatch = null;
    }
    const native = nativeApi();
    if (!native || !filePath) return;

    const onChange = async (data) => {
        console.log('Dosya değişti bildirimi alındı:', data.file);

        if (isEditMode) {
            // Yazılmamış değişiklik yoksa yeni hâli imleci bozmadan al; varsa sor.
            if (hasUnsavedChanges) {
                setDiskConflict(true);
                return;
            }
            const fresh = await native.content(filePath);
            if (!fresh.success || filePath !== currentFilePath || !isEditMode) return;
            if (hasUnsavedChanges) { setDiskConflict(true); return; }
            currentContent = fresh.content;
            LiveEditor.replaceAll(currentContent);
            buildTableOfContents();
            Reader.refresh();
        } else {
            // Automatically reload in read mode
            setSyncStatus('syncing', 'Diskteki değişiklikler güncelleniyor...');
            const fileData = await native.content(filePath);
            if (fileData.success) {
                currentContent = fileData.content;
                renderMarkdown(currentContent);
                setSyncStatus('connected', 'Güncellendi');
            }
        }
    };
    const onError = (err) => {
        console.error('İzleme hatası:', err);
        setSyncStatus('error', 'İzleme hatası');
    };

    try {
        stopWatch = await native.watch(filePath, onChange, onError);
    } catch (err) {
        onError(err);
    }
}

// Helper to pre-process custom styling elements & Mermaid inside compiled html
function preprocessRenderedHTML(htmlText) {
    let processed = htmlText;
    
    // Custom alert containers
    const containerRegex = /:::(info|warning|danger)\n([\s\S]*?)\n:::/g;
    processed = processed.replace(containerRegex, (match, type, content) => {
        return `<div class="${type}-box">${marked.parse(content)}</div>`;
    });

    // Mermaid code blocks placeholder
    const mermaidRegex = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;
    processed = processed.replace(mermaidRegex, (match, code) => {
        return `<div class="mermaid">${code.trim()}</div>`;
    });

    // Markdown içeriği (belge, satır içi etiketler, script vb.) güvenilmez
    // olabilir. DOM'a girmeden önce DOMPurify ile temizliyoruz: <script>,
    // onerror/onload gibi olay öznitelikleri ve javascript: URL'leri düşer.
    // Diyagram yer tutucusu için class="mermaid" korunur; mermaid SVG'yi
    // sonradan kendisi üretir.
    return sanitizeHtml(processed);
}

// Rendered markdown HTML'ini güvenli hale getirir. DOMPurify yüklüyse onu
// kullanır; herhangi bir sebeple yoksa içeriği metne kaçışlayıp XSS'i tamamen
// keser (sessizce sanitize'siz DOM'a basmaktansa görünür şekilde bozulsun).
function sanitizeHtml(html) {
    if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
        return DOMPurify.sanitize(html, {
            ADD_ATTR: ['target'],
            FORBID_TAGS: ['style'],
            FORBID_ATTR: ['srcdoc']
        });
    }
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
}

// Markdown'daki göreli görsel yollarını (img/grafik.svg) uygulamanın sunabileceği
// mdasset adreslerine çevirir (bridge.js assetUrl). Yollar belgenin bulunduğu klasöre
// göre çözülür; http(s), data: ve mutlak URL'lere dokunulmaz.
function resolveLocalAssets(container) {
    if (!container || typeof AssetUrl === 'undefined') return;

    container.querySelectorAll('img[src]').forEach((img) => {
        const original = img.getAttribute('src');
        const resolved = AssetUrl.resolveAssetUrl(original, currentFilePath);
        if (!resolved) return;

        img.setAttribute('data-original-src', original);
        img.setAttribute('src', resolved);
        img.addEventListener('error', () => {
            img.classList.add('asset-missing');
            img.title = 'Görsel bulunamadı: ' + original;
        }, { once: true });
    });
}

// MARKDOWN RENDERING PIPELINE (Read Mode)
// Not: satır numaraları yalnızca düzenleme modunda gösterilir; okuma modunda
// render'lı çıktının kaynak satırıyla birebir hizası olmadığı için eklenmez.
function renderMarkdown(markdownText) {
    // Render Markdown through marked.js
    const renderedHtml = marked.parse(markdownText);
    markdownViewer.innerHTML = preprocessRenderedHTML(renderedHtml);
    resolveLocalAssets(markdownViewer);
    Reader.decorateCode();

    // Code Block Syntax Highlighting (Highlight.js)
    markdownViewer.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    // Render Mermaid diagrams
    const mermaidElements = markdownViewer.querySelectorAll('.mermaid');
    if (mermaidElements.length > 0) {
        runMermaid(mermaidElements);
    } else {
        scheduleMermaidPreload();
    }

    // Generate Table of Contents (TOC) & register Scroll Spy
    buildTableOfContents();

    // Görev kutuları, istatistik, geri bağlantılar (public/reader.js)
    Reader.rendered();

    // İçerik değişti: aktif arama varsa eşleşmeleri yeniden hesapla.
    refreshFind();
}

// CANLI DÜZENLEYİCİ (public/live-editor.js): belge tek parça yazılır.
let editTimer = null;       // başlıklar, istatistik, arama: yazma durunca
let diskConflict = false;   // dosya dışarıda değişti, kaydedilmemiş yazı var
let lastTyped = 0;

/** Tek bir bloğu okuma görünümündeki gibi çizer (tablo, kutu, diyagram, görsel). */
function renderFragment(el, markdownText) {
    el.innerHTML = preprocessRenderedHTML(marked.parse(markdownText));
    resolveLocalAssets(el);
    el.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
    const diagrams = el.querySelectorAll('.mermaid');
    // Mermaid ölçüm yapar: öğe sayfaya eklendikten sonra çizilir
    if (diagrams.length) requestAnimationFrame(() => runMermaid(diagrams));
}

function setupLiveEditor() {
    LiveEditor.init(liveHost, {
        render: renderFragment,
        openLink: openDocumentLink,
        openWiki: openWikilink,
        save: () => saveFile(),
        onCursor: () => {},
        onFocus: (on) => { document.documentElement.classList.toggle('editor-focus', on); },
        onChange: () => {
            currentContent = LiveEditor.text();
            lastTyped = Date.now();
            markUnsaved();
            scheduleAutosave();
            clearTimeout(editTimer);
            editTimer = setTimeout(() => {
                if (!isEditMode) return;
                buildTableOfContents();
                Reader.refresh();
                refreshFind();
            }, 350);
        }
    });
    LiveEditor.scroller().addEventListener('scroll', handleScrollSpy, { passive: true });
}

function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    if (!chkAutosave.checked) {
        saveStatus.textContent = 'Kaydedilmedi';
        return;
    }
    if (diskConflict) return;
    saveStatus.textContent = 'Yazılıyor…';
    autosaveTimer = setTimeout(() => saveFile(), 1200);
}

function loadIntoEditor(text) {
    setDiskConflict(false);
    LiveEditor.load(text);
    saveStatus.textContent = '';
    buildTableOfContents();
    refreshFind();
}

/** Açık tablo hücresi varsa yazılanı belgeye işler. */
function commitCell() {
    const el = document.activeElement;
    if (el && el.classList && el.classList.contains('lp-cell')) el.blur();
}

function setDiskConflict(on) {
    diskConflict = on;
    document.getElementById('disk-banner').hidden = !on;
    if (on) clearTimeout(autosaveTimer);
}

// TABLE OF CONTENTS GENERATION
function buildTableOfContents() {
    tocList.innerHTML = '';
    
    // Düzenlemede başlıklar DOM'dan değil metinden gelir (görünmeyen satır çizilmez)
    headingElements = isEditMode
        ? LiveEditor.headings().map((h) => ({ textContent: h.text, tagName: 'H' + h.level, pos: h.pos, id: '' }))
        : Array.from(markdownViewer.querySelectorAll('h1, h2, h3, h4'));
    
    if (headingElements.length === 0) {
        tocList.innerHTML = `<span class="empty-state">Başlık bulunamadı</span>`;
        return;
    }

    headingElements.forEach((heading, index) => {
        // Always assign a unique id (index-prefixed) so Turkish/duplicate
        // headings never collide. Keep unicode letters/numbers in the slug.
        const slug = heading.textContent
            .toLowerCase()
            .trim()
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
        heading.id = `h-${index}-${slug || 'baslik'}`;

        const link = document.createElement('a');
        link.className = `toc-link toc-${heading.tagName.toLowerCase()}`;
        link.textContent = heading.textContent;
        link.setAttribute('href', `#${heading.id}`);
        link.setAttribute('data-id', heading.id);

        const level = parseInt(heading.tagName.substring(1));
        link.style.paddingLeft = `${0.5 + (level - 1) * 0.75}rem`;

        link.addEventListener('click', (e) => {
            e.preventDefault();
            scrollToHeading(heading);

            document.querySelectorAll('.toc-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });

        tocList.appendChild(link);
    });

    handleScrollSpy();
}

function scrollToHeading(heading) {
    if (isEditMode) {
        LiveEditor.scrollToPos(heading.pos);
        return;
    }
    const delta = heading.getBoundingClientRect().top - paneRead.getBoundingClientRect().top;
    paneRead.scrollTo({ top: Math.max(0, paneRead.scrollTop + delta - 16), behavior: 'smooth' });
}

// SCROLL SPY MECHANISM
function handleScrollSpy() {
    if (headingElements.length === 0) return;
    const paneTop = (isEditMode ? LiveEditor.scroller() : paneRead).getBoundingClientRect().top;

    let activeHeadingId = '';
    const triggerOffset = 120; 

    for (let i = 0; i < headingElements.length; i++) {
        const heading = headingElements[i];
        const top = isEditMode ? LiveEditor.posTop(heading.pos) : heading.getBoundingClientRect().top;

        if (top - paneTop <= triggerOffset) {
            activeHeadingId = heading.id;
        } else {
            break;
        }
    }

    if (!activeHeadingId && headingElements.length > 0) {
        activeHeadingId = headingElements[0].id;
    }

    document.querySelectorAll('.toc-link').forEach(link => {
        if (link.getAttribute('data-id') === activeHeadingId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// SAVE CHANGES TO DISK
async function saveFile(contentToSave = null) {
    if (!currentFilePath) return;
    
    try {
        commitCell();
        const path = currentFilePath;
        const text = contentToSave === null ? currentContent : contentToSave;
        saveStatus.textContent = 'Kaydediliyor…';
        const data = await nativeApi().save(path, text);
        if (!data.success) throw new Error(data.error);
        if (path !== currentFilePath) return;
        setDiskConflict(false);
        // Kayıt sürerken yazılan varsa belge hâlâ kirli: sıradaki kayıt onu alır.
        if (!isEditMode || currentContent === text) markSaved();
        else scheduleAutosave();
        if (!isEditMode) currentContent = text;
        SyncUi.saved();
        Reader.refresh();
        if (!hasUnsavedChanges) saveStatus.textContent = 'Kaydedildi';
    } catch (error) {
        console.error('Kaydetme hatası:', error);
        saveStatus.textContent = 'Kaydedilemedi';
        showToast('Kaydedilemedi: ' + error.message);
    }
}

// STATUS UTILITY
function setSyncStatus(state, text) {
    // Durum rozeti arayüzden kaldırıldı (boştayken "Bağlandı" kullanıcının
    // kafasını karıştırıyordu). Öğeler yoksa sessizce çık; çağrı yerlerini
    // değiştirmeye gerek kalmasın.
    if (!statusDot || !statusText) return;

    statusDot.className = 'status-dot';
    statusText.textContent = text;

    if (state === 'connected') {
        statusDot.classList.add('green');
    } else if (state === 'syncing') {
        statusDot.classList.add('yellow');
    } else if (state === 'error') {
        statusDot.classList.add('red');
    }
}

// SETUP DOM EVENTS
function setupEventListeners() {
    setupLiveEditor();

    // 1. Oku / Düzenle toggling
    btnReadMode.addEventListener('click', () => {
        if (!isEditMode) return;

        commitCell();
        const line = LiveEditor.topLine();
        LiveEditor.blur();
        clearTimeout(editTimer);
        isEditMode = false;
        showMode();
        renderMarkdown(currentContent);
        restoreScrollPosition(line);
        flushAutosave();
    });

    btnEditMode.addEventListener('click', () => {
        if (isEditMode) return;
        const line = readTopLine();
        isEditMode = true;
        showMode();
        loadIntoEditor(currentContent);
        Reader.refresh();
        // Telefonda klavye kendiliğinden açılmasın; boş notta hemen yazılsın.
        const fresh = currentContent.split('\n').filter((l) => l.trim()).length <= 1;
        if (fresh) LiveEditor.setCursorLine(Infinity);
        else LiveEditor.setCursorLine(line);
        if (fresh || !window.MDFlowMobile) LiveEditor.focus();
        restoreScrollPosition(line);
    });

    document.getElementById('disk-load').addEventListener('click', async () => {
        const data = await nativeApi().content(currentFilePath);
        if (!data.success) return;
        setDiskConflict(false);
        currentContent = data.content;
        LiveEditor.replaceAll(currentContent);
        markSaved();
        buildTableOfContents();
        Reader.refresh();
    });
    document.getElementById('disk-keep').addEventListener('click', () => {
        setDiskConflict(false);
        saveFile();
    });

    // 2. Manual Save Button click
    btnSave.addEventListener('click', () => {
        commitCell();
        saveFile();
    });

    // 3. Dosya / klasör aç (native seçici) + son açılanlar listeleri
    if (btnOpenFile) btnOpenFile.addEventListener('click', openFileDialog);
    if (btnOpenFolder) btnOpenFolder.addEventListener('click', openFolderDialog);
    if (btnRecentFiles) btnRecentFiles.addEventListener('click', () => showRecentMenu('file', btnRecentFiles));
    if (btnRecentFolders) btnRecentFolders.addEventListener('click', () => showRecentMenu('folder', btnRecentFolders));

    // 3b. PDF olarak dışa aktar
    if (btnExportPdf) btnExportPdf.addEventListener('click', exportToPdf);

    // 4. Sayfa içi arama kutusu
    setupFindBar();

    // 5b. Üst bar satır numarası aç/kapa (yalnızca düzenleme; kalıcı kaydet)
    if (btnLineNumbers) {
        btnLineNumbers.addEventListener('click', () => {
            applyLineNumbers(!lineNumbersOn);
            saveSettings();
        });
    }

    // 5c. Ayarlar paneli
    setupSettingsPanel();

    // 5d. Okuma modunda görsele tıklayınca yakınlaştırma penceresi
    markdownViewer.addEventListener('click', (e) => {
        const img = e.target.closest('img');
        if (!img || !prefs.imageZoom || typeof ImageZoom === 'undefined') return;
        if (img.closest('a[href]') || img.classList.contains('asset-missing')) return;
        e.preventDefault();
        ImageZoom.open(img.currentSrc || img.src, img.getAttribute('alt') || '');
    });

    // 6. Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Support Ctrl + S hotkey to save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            commitCell();
            saveFile();
        }
        
        // Ctrl + O: dosya aç
        if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            navigateHistory(e.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        // Ctrl+Shift+O: klasör (çalışma alanı) aç. Ctrl+O'dan önce bakılır;
        // Shift basılıyken e.key 'O' gelir ve iki koşul da eşleşirdi.
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
            e.preventDefault();
            openFolderDialog();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
            e.preventDefault();
            openFileDialog();
        }

        // Ctrl + P: yazdır/PDF. Kendimiz yakalıyoruz; düzenleme modunda okuma
        // paneli gizli olduğu için tarayıcının doğrudan yazdırması boş çıktı verir.
        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            exportToPdf();
        }

        // Ctrl + F: sayfa içi arama kutusuna odaklan (tarayıcı aramasını değiştir)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            findInput.focus();
            findInput.select();
        }

        // Support Ctrl + E hotkey to toggle mode
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            if (isEditMode) {
                btnReadMode.click();
            } else {
                btnEditMode.click();
            }
        }
    });

    // 7. Scroll Spy scroll listener on read pane & inline editor scrollable area
    paneRead.addEventListener('scroll', handleScrollSpy);

    // 8. Sidebar grip toggle
    sidebarGrip.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // 10. Belge içi bağlantılar + geri/ileri
    markdownViewer.addEventListener('click', handleDocumentLinkClick);
    window.addEventListener('popstate', onPopState);
    if (btnNavBack) btnNavBack.addEventListener('click', () => navigateHistory(-1));
    if (btnNavForward) btnNavForward.addEventListener('click', () => navigateHistory(1));

    // 9. Sidebar sekmeleri ve gezgin
    sidebarTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.sidebar-tab');
        if (btn) setSidebarTab(btn.dataset.tab);
    });
    btnExplorerUp.addEventListener('click', explorerGoUp);
    btnExplorerLock.addEventListener('click', explorerToggleLock);

    // Bağlam menüsü: dışarı tık, Escape, kaydırma ya da odak kaybında kapan.
    document.addEventListener('mousedown', (e) => {
        if (contextMenuEl && !contextMenuEl.contains(e.target)) hideContextMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideContextMenu();
    });
    document.addEventListener('scroll', (e) => {
        if (!contextMenuEl || e.target !== contextMenuEl) hideContextMenu(); // menü kendi içinde kayabilir
    }, true);
    document.getElementById('explorer-new-folder').addEventListener('click', () => Notes.createFolder());
    explorerTree.addEventListener('contextmenu', (e) => {
        if (window.MDFlowMobile || e.target.closest('.tree-row') || !explorerState || !explorerState.root) return;
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, Notes.rootMenuItems());
    });
    window.addEventListener('blur', hideContextMenu);
    window.addEventListener('resize', hideContextMenu);

    window.addEventListener('beforeunload', (event) => {
        if (!hasUnsavedChanges) return;
        commitCell();
        event.preventDefault();
        event.returnValue = '';
    });
}

// KAYDEDİLMEMİŞ DEĞİŞİKLİK İŞARETİ
// 3.0.1'e kadar düzenlemeler tarayıcı deposunda "taslak" olarak saklanıp belge
// açılınca geri yüklemesi soruluyordu: kullanıcı içeriği görmeden karar veriyor,
// diskteki daha yeni hal ezilebiliyordu. Artık yalnız bu işaret tutulur; kayıp
// riskini otomatik kayıt ile kapanış/geçiş uyarıları karşılar (bkz. drafts.js).
function markUnsaved() {
    if (currentFilePath) hasUnsavedChanges = true;
}

function markSaved() {
    hasUnsavedChanges = false;
}

function showMode() {
    btnReadMode.classList.toggle('active', !isEditMode);
    btnEditMode.classList.toggle('active', isEditMode);
    paneRead.classList.toggle('hidden', isEditMode);
    paneEdit.classList.toggle('hidden', !isEditMode);
    showSaveButton();
}

// Otomatik kayıt açıkken düğme gerekmez; üst bar mod değişince kıpırdamasın.
function showSaveButton() {
    btnSave.classList.toggle('hidden', !isEditMode || chkAutosave.checked);
    saveStatus.hidden = !isEditMode;
}

// Satır numaraları yalnız düzenlemede (Ayarlar ve üst bar).
function applyLineNumbers(on) {
    lineNumbersOn = on;
    LiveEditor.setLineNumbers(on);
    paneEdit.classList.toggle('lp-numbers', on);
    if (btnLineNumbers) btnLineNumbers.classList.toggle('active', on);
}

function collectSettings() {
    return {
        theme: currentTheme,
        autosave: chkAutosave.checked,
        lineNumbers: lineNumbersOn,
        sidebarTab: activeSidebarTab,
        pinnedNotes: Notes.pins(),
        ...prefs
    };
}

// Ayarlar uygulamanın ayar dosyasında (%APPDATA%\MDFlowViewer\settings.json)
// saklanır; localStorage yalnız köprü yokken (tarayıcıda açılmış sayfa) yedektir.
async function saveSettings() {
    const settings = collectSettings();
    try {
        await nativeApi().setSettings(settings);
    } catch (e) {
        console.error('Ayarlar kaydedilemedi:', e);
    }
    try { storage.setItem('md_viewer_settings', JSON.stringify(settings)); } catch (e) { /* yut */ }
}

async function loadSettings() {
    let settings = {};
    try {
        const d = await nativeApi().getSettings();
        if (d && d.success && d.settings) settings = d.settings;
    } catch (e) {
        // Köprü yoksa (tarayıcıda açılmış sayfa) localStorage yedeği (aynı oturum).
        try { settings = JSON.parse(storage.getItem('md_viewer_settings') || '{}'); } catch (_) { settings = {}; }
    }

    // Kullanıcı tercihleri (Ayarlar paneli); bilinmeyen/eksik değer varsayılana döner
    prefs = normalizePrefs(settings);
    applyPrefs();

    // Tema — varsayılan AÇIK (minimal-light); sistem takibi açıksa o seçer
    setTheme(prefs.followSystem ? systemTheme() : (settings.theme || 'minimal-light'));

    // Satır numarası — varsayılan kapalı (yalnızca düzenleme)
    applyLineNumbers(settings.lineNumbers === true);

    Notes.setPinned(settings.pinnedNotes);

    if (settings.autosave !== undefined) chkAutosave.checked = settings.autosave;

    // Son açık sidebar sekmesi (varsayılan İçindekiler)
    setSidebarTab(settings.sidebarTab || 'toc', false);
}

// ============================================================
// SAYFA İÇİ ARAMA (FIND BAR)
// Eşleşmeler CSS Custom Highlight API ile boyanır: DOM'a <mark> eklemediğimiz
// için render'lı markdown, mermaid SVG'leri ve blok düzenleyici bozulmaz.
// ============================================================
let findMatches = [];      // Range[]
let findIndex = -1;        // aktif eşleşmenin sırası
let findLastQuery = '';
let findTimer = null;

const FIND_HL_ALL = 'md-find-all';
const FIND_HL_CURRENT = 'md-find-current';
const findHighlightSupported =
    typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';

// Arama hangi panelde yapılacak: aktif moda göre içerik kökü ve kaydırıcı.
function findScope() {
    return markdownViewer;
}
function findScroller() {
    return paneRead;
}

// Düzenlemede arama metnin kendisinde yapılır: [[başlangıç, bitiş]].
function computeEditorMatches(query) {
    const out = [];
    const needle = findFold(query);
    if (!needle) return out;
    const folded = findFoldChars(LiveEditor.text());
    for (let hit = folded.text.indexOf(needle); hit !== -1; hit = folded.text.indexOf(needle, hit + needle.length)) {
        out.push([folded.starts[hit], folded.ends[hit + needle.length - 1]]);
    }
    return out;
}

// Aramayı normalize eder: küçük harf + tüm boşluk türlerini tek boşluğa
// indirger (HTML kaynaklı satır sonu/girinti aramayı bozmasın). JS'de
// 'İ'.toLowerCase() iki kod birimi ürettiği ve boşluk dizileri kısaldığı için
// uzunluk KORUNMAZ; bu yüzden her normalize karakter için kaynak metindeki
// başlangıç/bitiş konumunu da tutuyoruz. Range'ler bu konumlarla kurulur.
function findFoldChars(text) {
    let folded = '';
    const starts = [];
    const ends = [];
    let pos = 0;
    let prevSpace = false;

    for (const ch of text) {
        const len = ch.length;

        if (/\s/.test(ch)) {
            // Boşluk dizisi -> tek boşluk (yalnızca ilk karakteri işaretlenir)
            if (!prevSpace) {
                folded += ' ';
                starts.push(pos);
                ends.push(pos + len);
            }
            prevSpace = true;
        } else {
            prevSpace = false;
            const lower = ch.toLowerCase();
            // Uzunluk büyürse ('İ' -> 'i' + birleşen nokta) ilk birimi al;
            // eşitse olduğu gibi kullan (astral karakterler bozulmasın).
            const piece = lower.length === len ? lower : lower.slice(0, 1);
            for (let k = 0; k < piece.length; k++) {
                starts.push(pos);
                ends.push(pos + len);
            }
            folded += piece;
        }
        pos += len;
    }

    return { text: folded, starts, ends };
}

function findFold(text) {
    return findFoldChars(text).text;
}

// Aranabilir metin düğümleri: ham markdown textarea'ları, gizli bloklar ve
// script/style içerikleri dışarıda kalır.
function collectFindTextNodes(root) {
    const nodes = [];
    if (!root) return nodes;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.closest('textarea, script, style, .block-editor, .hidden')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
}

// Verilen konumun hangi metin düğümüne düştüğünü ikili aramayla bulur.
function findLocateNode(map, pos) {
    let lo = 0;
    let hi = map.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const entry = map[mid];
        if (pos < entry.start) hi = mid - 1;
        else if (pos >= entry.start + entry.node.nodeValue.length) lo = mid + 1;
        else return entry;
    }
    return null;
}

// Tüm panel metnini tek dizeye çevirip eşleşmeleri Range olarak döndürür.
// Tek dize üzerinden aradığımız için <strong>/<em> gibi satır içi etiketlerle
// bölünmüş kelimeler de bulunur.
function computeFindMatches(query) {
    const ranges = [];
    const needle = findFold(query);
    if (!needle) return ranges;

    const nodes = collectFindTextNodes(findScope());
    if (!nodes.length) return ranges;

    let raw = '';
    const map = [];
    for (const node of nodes) {
        map.push({ node, start: raw.length });
        raw += node.nodeValue;
    }

    const folded = findFoldChars(raw);
    let from = 0;

    for (;;) {
        const hit = folded.text.indexOf(needle, from);
        if (hit === -1) break;

        // Normalize edilmiş konumdan kaynak metin konumuna dön
        const srcStart = folded.starts[hit];
        const srcEnd = folded.ends[hit + needle.length - 1];
        const startEntry = findLocateNode(map, srcStart);
        const endEntry = findLocateNode(map, srcEnd - 1);

        if (startEntry && endEntry) {
            try {
                const range = document.createRange();
                range.setStart(startEntry.node, srcStart - startEntry.start);
                range.setEnd(endEntry.node, srcEnd - endEntry.start);
                ranges.push(range);
            } catch (e) { /* kopmuş düğüm: bu eşleşmeyi atla */ }
        }
        from = hit + needle.length;
    }
    return ranges;
}

function applyFindHighlights() {
    if (!findHighlightSupported) {
        // Highlight API yoksa aktif eşleşmeyi seçim olarak göster.
        const selection = window.getSelection();
        if (!selection) return;
        selection.removeAllRanges();
        if (findMatches[findIndex]) selection.addRange(findMatches[findIndex]);
        return;
    }

    CSS.highlights.delete(FIND_HL_ALL);
    CSS.highlights.delete(FIND_HL_CURRENT);
    if (!findMatches.length) return;

    CSS.highlights.set(FIND_HL_ALL, new Highlight(...findMatches));
    if (findMatches[findIndex]) {
        const current = new Highlight(findMatches[findIndex]);
        current.priority = 1;   // aktif eşleşme diğerlerinin üstüne boyanır
        CSS.highlights.set(FIND_HL_CURRENT, current);
    }
}

function scrollToFindMatch() {
    const range = findMatches[findIndex];
    if (!range) return;

    const rect = range.getBoundingClientRect();
    if (!rect.height && !rect.width) return;

    const scroller = findScroller();
    const box = scroller.getBoundingClientRect();
    const target = scroller.scrollTop + (rect.top - box.top) - box.height / 3;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

function updateFindUI() {
    const hasQuery = !!findInput.value;
    const total = findMatches.length;

    findCount.textContent = hasQuery ? `${total ? findIndex + 1 : 0}/${total}` : '';
    findCount.classList.toggle('no-match', hasQuery && total === 0);

    btnFindPrev.disabled = total === 0;
    btnFindNext.disabled = total === 0;
    btnFindClear.hidden = !hasQuery;
}

// delta: 0 = yeniden hesapla (aynı eşleşmede kal), 1 = sonraki, -1 = önceki.
// DOM her çağrıda yeniden taranır; blok düzenleyici açılıp kapandığında bile
// eşleşmeler güncel kalır.
function runFind(delta = 0, jump = true) {
    const query = findInput.value;

    if (!query) {
        clearFind(false);
        return;
    }

    if (query !== findLastQuery) {
        findLastQuery = query;
        findIndex = -1;
    }

    findMatches = isEditMode ? computeEditorMatches(query) : computeFindMatches(query);

    if (!findMatches.length) {
        findIndex = -1;
    } else if (delta === 0) {
        findIndex = findIndex < 0 ? 0 : Math.min(findIndex, findMatches.length - 1);
    } else {
        const base = findIndex < 0 ? (delta > 0 ? -1 : 0) : findIndex;
        findIndex = (base + delta + findMatches.length) % findMatches.length;
    }

    if (isEditMode) {
        LiveEditor.find(findMatches, findIndex, jump);
    } else {
        applyFindHighlights();
        if (jump) scrollToFindMatch();
    }
    updateFindUI();
}

function clearFind(resetInput = true) {
    if (resetInput) findInput.value = '';
    findLastQuery = findInput.value;
    findMatches = [];
    findIndex = -1;
    if (isEditMode) LiveEditor.find([], -1, false);

    if (findHighlightSupported) {
        CSS.highlights.delete(FIND_HL_ALL);
        CSS.highlights.delete(FIND_HL_CURRENT);
    }
    updateFindUI();
}

// Yeniden render sonrası (mod değişimi, dosya değişimi, disk güncellemesi)
// eski Range'ler kopmuş düğümlere işaret eder; sıradaki eşleşmeyi koruyarak
// yeniden hesaplıyoruz.
function refreshFind() {
    if (!findInput || !findInput.value) return;
    runFind(0, false);
}

function setupFindBar() {
    if (!findInput) return;

    findInput.addEventListener('input', () => {
        clearTimeout(findTimer);
        findTimer = setTimeout(() => runFind(0, true), 120);
    });

    findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(findTimer);
            runFind(e.shiftKey ? -1 : 1, true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            clearFind(true);
        }
    });

    btnFindNext.addEventListener('click', () => runFind(1, true));
    btnFindPrev.addEventListener('click', () => runFind(-1, true));
    btnFindClear.addEventListener('click', () => {
        clearFind(true);
        findInput.focus();
    });

    updateFindUI();
}

// ============================================================
// PDF DIŞA AKTARMA
// Tarayıcının yazdırma diyaloğunu açar; hedef yazıcı olarak "PDF olarak
// kaydet" seçilir. Çıktı okuma modundaki render'dır (@media print kuralları
// üst bar, kenar çubuğu ve düzenleyiciyi gizler).
// ============================================================
function exportToPdf() {
    if (isEditMode) {
        // Düzenleme modunda blok textarea'ları yazdırılır; önce okuma moduna
        // geçip (açık düzenleyiciler kapanır, içerik yeniden render edilir)
        // yerleşim oturduktan sonra yazdır.
        btnReadMode.click();
        setTimeout(printPage, 400);
        return;
    }
    printPage();
}

// Linux/WebKitGTK'da window.print() sessizce yok sayılır; diyaloğu uygulama
// açar (print_page komutu). Diğer sistemlerde komut false döner.
async function printPage() {
    const api = nativeApi();
    if (api && typeof api.print_page === 'function') {
        try {
            if (await api.print_page()) return;
        } catch (e) { /* window.print()'e düş */ }
    }
    window.print();
}

// ============================================================
// DOSYA AÇ (native seçici)
// Tarayıcıdan native diyalog açılamadığı için uygulama köprüsünü kullanır
// (open_file komutu). Seçici son açılan klasörde başlar; seçilen
// dosyanın klasörü aynı zamanda yeni çalışma kökü olur.
// ============================================================
// Uygulama köprüsü (bridge.js); tarayıcıda açılmış sayfada yoktur.
function nativeApi() {
    return window.MDFlowNative || null;
}

// Çalışma alanı (klasör) açma + son açılanlar listeleri. Klasör seçilince
// gezgin kökü ve belge kökü o klasör olur; vault kilidi açıksa kilit de o
// klasöra taşınır (bkz. core/src/workspace.rs Workspace::open_workspace).
async function openFolderDialog() {
    const api = nativeApi();
    if (!api || typeof api.open_folder !== 'function') {
        UiDialog.alert('Klasör seçme penceresi yalnızca MD Flow Viewer uygulama penceresinde çalışır.');
        return;
    }
    if (!(await confirmLeaveUnsaved())) return;
    try {
        const result = await api.open_folder();
        if (result) adoptWorkspace(result);
    } catch (error) {
        console.error('Klasör seçme hatası:', error);
        UiDialog.alert('Klasör seçme penceresi açılamadı: ' + error);
    }
}

async function openWorkspacePath(path) {
    const api = nativeApi();
    if (!api || typeof api.open_folder_path !== 'function') return;
    if (!(await confirmLeaveUnsaved())) return;
    try {
        const result = await api.open_folder_path(path);
        if (result) adoptWorkspace(result);
        else showToast('Klasör bulunamadı: ' + path);
    } catch (error) {
        console.error('Çalışma alanı açılamadı:', error);
        showToast('Klasör açılamadı');
    }
}

function adoptWorkspace(result) {
    applyExplorerState(result.state);
    setSidebarTab('explorer');
    sidebar.classList.remove('collapsed');
    showToast('Çalışma alanı: ' + (basename(result.path) || result.path));
}

async function openRecentFile(path) {
    const api = nativeApi();
    if (!api || typeof api.open_file_path !== 'function') return;
    if (!(await confirmLeaveUnsaved())) return;
    try {
        const opened = await api.open_file_path(path);
        if (opened) await loadFile(opened);
        else showToast('Dosya bulunamadı: ' + path);
    } catch (error) {
        console.error('Son açılan dosya açılamadı:', error);
        showToast('Dosya açılamadı');
    }
}

// kind: 'file' | 'folder'. Liste ayar dosyasından gelir (en fazla 10 kayıt,
// silinmiş yollar elenmiş).
async function showRecentMenu(kind, anchorEl) {
    if (menuJustClosedFor(anchorEl.id)) return;
    const api = nativeApi();
    if (!api || typeof api.recent_list !== 'function') {
        UiDialog.alert('Son açılanlar yalnızca MD Flow Viewer uygulama penceresinde çalışır.');
        return;
    }
    let data;
    try {
        data = await api.recent_list();
    } catch (error) {
        console.error('Son açılanlar okunamadı:', error);
        return;
    }
    const paths = (kind === 'file' ? data.files : data.folders) || [];
    const items = paths.map((p) => ({
        label: basename(p) || p,
        icon: kind === 'file' ? 'note' : 'folder',
        hint: kind === 'file' ? dirname(p) : p,
        title: p,
        action: () => (kind === 'file' ? openRecentFile(p) : openWorkspacePath(p)),
    }));
    if (!items.length) {
        items.push({ label: kind === 'file' ? 'Son açılan dosya yok' : 'Son açılan klasör yok', disabled: true });
    } else {
        items.push({ separator: true });
        items.push({
            label: 'Listeyi temizle',
            icon: 'trash',
            action: async () => {
                try {
                    await api.clear_recent_list(kind);
                } catch (error) {
                    console.error('Liste temizlenemedi:', error);
                }
            },
        });
    }
    // Telefonda bu seçenekler panelin kendi menüsündedir.
    if (!window.MDFlowMobile) items.unshift(...openMenuItems(kind), { separator: true });
    showMenuUnder(anchorEl, items);
}

// Üst bardaki okların menüsü: son açılanların üstünde duran seçenekler.
function openMenuItems(kind) {
    const root = explorerState && explorerState.root;
    if (kind === 'file') {
        return [
            { label: 'Yeni not…', icon: 'newNote', action: () => Notes.create() },
            { label: 'Bugünün notu', icon: 'day', action: Notes.today },
            { label: 'Dosya aç…', icon: 'openFile', action: openFileDialog },
        ];
    }
    const items = [
        { label: 'Yeni klasör…', icon: 'newFolder', action: () => Notes.createFolder() },
        { label: 'Klasör aç…', icon: 'openFolder', action: openFolderDialog },
    ];
    if (root) {
        items.push(
            { label: 'Dosya yöneticisinde aç', icon: 'external', action: () => nativeApi().open_in_file_manager(root) },
            { label: explorerState.locked ? 'Sabitlemeyi kaldır' : 'Bu klasörü sabitle', icon: 'pin', action: explorerToggleLock });
    }
    return items;
}

function dirname(p) {
    const clean = String(p).replace(/[\\/]+$/, '');
    const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    return i > 0 ? clean.slice(0, i) : clean;
}

async function openFileDialog() {
    const api = nativeApi();
    if (!api || typeof api.open_file !== 'function') {
        UiDialog.alert('Dosya seçme penceresi yalnızca MD Flow Viewer uygulama penceresinde çalışır.');
        return;
    }

    if (!(await confirmLeaveUnsaved())) return;

    try {
        const path = await api.open_file();
        if (path) await loadFile(path);
    } catch (error) {
        console.error('Dosya seçme hatası:', error);
        UiDialog.alert('Dosya seçme penceresi açılamadı: ' + error);
    }
}
