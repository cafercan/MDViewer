// INITIAL CONFIGURATION FOR EXTERNAL LIBRARIES
mermaid.initialize({
    startOnLoad: false,
    // Varsayılan tema açık olduğu için mermaid 'default' (açık) ile uyumlu.
    theme: 'default',
    // 'strict': mermaid, etiket içeriğindeki HTML'i temizler ve tıklama/JS
    // yönlendirmelerini kapatır. Güvenilmeyen bir .md dosyasındaki diyagram
    // kodunun script çalıştırmasını engeller.
    securityLevel: 'strict',
    flowchart: { useMaxWidth: true, htmlLabels: false, curve: 'basis' }
});

// Obsidian tarzı [[wikilink]] desteği (public/wikilink.js). Hedef tıklamada
// çözülür: bkz. handleDocumentLinkClick -> openWikilink.
if (typeof Wikilink !== 'undefined') {
    marked.use({ extensions: [Wikilink.extension()] });
}

// Oturum içi depolama. Linux'ta pywebview (GTK) private mode'da WebKit'in
// localStorage'ını tamamen kapatır: değişken hiç tanımlı olmaz ve dokunmak
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
let eventSource = null;
let autosaveTimer = null;
let headingElements = [];
let currentTokens = [];
let hasUnsavedChanges = false;
let currentTheme = 'minimal-light';
let lineNumbersOn = true;

// Pencere kapanınca sunucuyu arkada bırakma: pagehide anında sendBeacon ile
// kapanış sinyali gönder. sendBeacon tam da bu iş için (sayfa yıkılırken bile
// iletilir). Sunucu yalnızca launcher tarafından açıldıysa (AUTO_EXIT) kapanır.
window.addEventListener('pagehide', () => {
    try { navigator.sendBeacon('/api/shutdown'); } catch (e) { /* yok say */ }
});

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
const inlineEditor = document.getElementById('inline-editor');
const chkAutosave = document.getElementById('chk-autosave');
const btnLineNumbers = document.getElementById('btn-line-numbers');
const saveStatus = document.getElementById('save-status');

const themeSwitch = document.getElementById('theme-switch');

// Sayfa içi arama (find bar)
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const btnFindPrev = document.getElementById('btn-find-prev');
const btnFindNext = document.getElementById('btn-find-next');
const btnFindClear = document.getElementById('btn-find-clear');

// APP INIT
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initApp();
    setupEventListeners();
});

// MAIN CONTROLLER INITIALIZATION
async function initApp() {
    // 1. Get file path from URL query param
    const urlParams = new URLSearchParams(window.location.search);
    const fileParam = urlParams.get('file');
    
    // 2. Fetch file content (ilk giriş: geçmişe yeni kayıt ekleme, mevcut olanı yaz)
    await loadFile(fileParam || '', { replaceHistory: true });

    // 3. Gezgin (native köprü hazır olunca)
    initExplorer();
}

// FETCH AND RENDER A MARKDOWN FILE
// options.replaceHistory : geçmişte yeni kayıt yerine mevcut kaydı güncelle (ilk yükleme)
// options.pushHistory    : false ise geçmişe dokunma (popstate ile geri/ileri)
// options.anchor         : yüklendikten sonra kaydırılacak başlık (#parça)
async function loadFile(filePath, options = {}) {
    const { replaceHistory = false, pushHistory = true, anchor = '' } = options;
    try {
        setSyncStatus('syncing', 'Dosya yükleniyor...');
        
        const url = `/api/content${filePath ? '?file=' + encodeURIComponent(filePath) : ''}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Dosya yüklenemedi: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            currentFilePath = data.path;
            const draft = getDraft(data.path);
            if (draft && draft.content !== data.content) {
                const draftDate = new Date(draft.savedAt).toLocaleString();
                if (confirm(`Bu dosya icin kaydedilmemis bir taslak bulundu (${draftDate}). Taslagi geri yuklemek ister misiniz?`)) {
                    currentContent = draft.content;
                    hasUnsavedChanges = true;
                    saveStatus.textContent = 'Kurtarilan taslak henuz diske kaydedilmedi';
                } else {
                    clearDraft(data.path);
                    currentContent = data.content;
                }
            } else {
                currentContent = data.content;
                clearDraft(data.path);
            }
            
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
                renderInlineEditor(currentContent);
            } else {
                renderMarkdown(currentContent);
            }
            
            // Establish Live Connection
            setupSSEWatcher(data.path);
            setSyncStatus('connected', 'Bağlandı');
            
            // Gezgindeki aktif dosya vurgusunu güncelle
            highlightActiveFile();

            // Yeni belge en üstten başlasın (eski belgenin kaydırma konumu kalmasın)
            paneRead.scrollTop = 0;
            inlineEditor.scrollTop = 0;
            if (anchor) scrollToAnchor(anchor);
        } else {
            throw new Error(data.error || 'Bilinmeyen sunucu hatası');
        }
    } catch (error) {
        console.error('Dosya yükleme hatası:', error);
        setSyncStatus('error', 'Yükleme hatası');
        if (currentFilePath && filePath !== currentFilePath) {
            // Açık bir belge varken bağlantı/geçmiş üzerinden gelen hata belgeyi
            // silmesin; kullanıcı olduğu yerde kalsın.
            alert('Dosya açılamadı: ' + error.message);
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
    const byId = document.getElementById(wanted);
    if (byId) return byId;
    return headingElements.find((h) => {
        const idSlug = h.id.replace(/^h-\d+-/, '');
        return idSlug === wanted || idSlug === wanted.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
    }) || null;
}

function scrollToAnchor(anchor) {
    const heading = findHeadingByAnchor(anchor);
    if (!heading) return;
    const target = isEditMode ? (heading.closest('.inline-block-wrapper') || heading) : heading;
    scrollElementIntoView(target);
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
    if (link.dataset.wiki !== undefined) {
        e.preventDefault();
        await openWikilink(link.dataset.wiki, link.dataset.wikiAnchor || '');
        return;
    }
    const href = link.getAttribute('href');
    if (typeof AssetUrl === 'undefined') return;
    const info = AssetUrl.classifyLink(href, currentFilePath);
    e.preventDefault();

    switch (info.kind) {
        case 'anchor':
            scrollToAnchor(info.target);
            return;
        case 'external': {
            const api = nativeApi();
            if (api && typeof api.open_external === 'function') {
                const ok = await api.open_external(info.target);
                if (!ok) alert('Bu bağlantı açılamıyor: ' + info.target);
            } else {
                window.open(info.target, '_blank', 'noopener');
            }
            return;
        }
        case 'markdown':
            if (!confirmLeaveUnsaved()) return;
            await loadFile(info.target, { anchor: info.anchor || '' });
            return;
        case 'file':
            await openLocalTarget(info.target, e.ctrlKey);
            return;
        default:
            alert('Bağlantı çözülemedi: ' + info.target);
    }
}

// [[hedef]]: belgenin klasörü, sonra gezgin kökü/vault içinde dosya adıyla
// aranır (sunucu tarafı, bkz. Workspace.resolve_wikilink). Native köprü yoksa
// yalnızca belgenin klasörüne göre "hedef.md" denenir.
async function openWikilink(target, anchor) {
    if (!confirmLeaveUnsaved()) return;
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
        alert('Not bulunamadı: [[' + target + ']]\nBelgenin klasöründe ve gezgin kökünde arandı.');
        return;
    }
    await loadFile(resolved, { anchor });
}

// Geri/ileri: loadFile her belgede pushState yapar; popstate ile o kayda dönülür.
function navigateHistory(delta) {
    if (!confirmLeaveUnsaved()) return;
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

// Düzenleme modunda kaydedilmemiş değişiklik varsa kullanıcıya sorar.
// true = devam edilebilir.
function confirmLeaveUnsaved() {
    if (!isEditMode) return true;
    closeAllBlockEditors();
    if (reconstructMarkdownFromBlocks() === currentContent) return true;
    return confirm('Kaydedilmemiş değişiklikleriniz var. Başka bir dosyaya geçmek istiyor musunuz?');
}

// ============================================================
// SIDEBAR SEKMELERİ (İçindekiler / Gezgin)
// ============================================================
let activeSidebarTab = 'toc';

function setSidebarTab(name, persist = true) {
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
// Klasör listeleme ve kök değişimi HTTP değil pywebview köprüsü (JsApi)
// üzerinden yapılır: kök hapsi yalnızca uygulama penceresinden genişler.
// ============================================================
let explorerState = null; // { root, vault, locked, canUp }

function whenNativeReady(timeoutMs = 4000) {
    return new Promise((resolve) => {
        if (nativeApi()) return resolve(nativeApi());
        const timer = setTimeout(() => resolve(nativeApi()), timeoutMs);
        window.addEventListener('pywebviewready', () => {
            clearTimeout(timer);
            resolve(nativeApi());
        }, { once: true });
    });
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

function applyExplorerState(state) {
    explorerState = state || null;
    const root = state && state.root;
    explorerSection.classList.toggle('locked', !!(state && state.locked));
    btnExplorerLock.setAttribute('aria-pressed', state && state.locked ? 'true' : 'false');
    btnExplorerLock.title = state && state.locked
        ? 'Sabitlemeyi kaldır (belge klasörüne dön)'
        : 'Bu klasörü sabitle (vault)';
    btnExplorerLock.disabled = !root;
    btnExplorerUp.disabled = !(state && state.canUp);
    explorerRootLabel.textContent = root ? (basename(root) || root) : 'Klasör yok';
    explorerRootLabel.title = root || '';

    explorerTree.innerHTML = '';
    if (!root) {
        explorerTree.innerHTML = '<span class="empty-state">Bir dosya açın ya da klasör sabitleyin.</span>';
        return;
    }
    renderDirChildren(explorerTree, root, 0);
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
    data.dirs.forEach((d) => container.appendChild(buildDirNode(d, depth)));
    data.files.forEach((f) => container.appendChild(buildFileRow(f, depth)));
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
            row.classList.remove('open');
            children.hidden = true;
        } else {
            expand();
        }
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
                if (!(await api.open_in_file_manager(info.path))) alert('Klasör açılamadı: ' + info.path);
                return;
            }
            if (info.note) {
                if (!confirmLeaveUnsaved()) return;
                await loadFile(info.note);
                return;
            }
            if (!(await revealInExplorer(info.path))) {
                alert('Klasör gezgin kökünün dışında:\n' + info.path + '\nKilidi açıp üst klasöre çıkın ya da Ctrl+tık ile dosya yöneticisinde açın.');
            }
            return;
        case 'file':
            if (!(await api.open_path(info.path))) alert('Dosya açılamadı: ' + info.path);
            return;
        case 'denied':
            alert('Erişim reddedildi: çalışma klasörü dışında.\n' + info.path);
            return;
        default:
            alert('Bulunamadı: ' + (info.path || absPath));
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
    row.addEventListener('click', () => {
        if (!confirmLeaveUnsaved()) return;
        loadFile(file.path);
    });
    // Sağ tık: dosyanın tam yolunu (dosya adı dahil) panoya kopyala.
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [{
            label: 'Tam yolu kopyala',
            action: async () => {
                const ok = await copyToClipboard(file.path);
                showToast(ok ? 'Yol kopyalandı: ' + file.name : 'Panoya kopyalanamadı');
            },
        }]);
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

// SETUP LIVE RELOAD (Server-Sent Events)
function setupSSEWatcher(filePath) {
    if (eventSource) {
        eventSource.close();
    }
    
    eventSource = new EventSource(`/api/watch?file=${encodeURIComponent(filePath)}`);
    
    eventSource.addEventListener('change', async (event) => {
        const data = JSON.parse(event.data);
        console.log('Dosya değişti bildirimi alındı:', data.file);
        
        if (isEditMode) {
            // Warn edit mode users to prevent overwriting
            saveStatus.innerHTML = `<span style="color: var(--warning); font-weight: 700;">Uyarı: Dosya diskte değiştirildi! <a href="#" id="link-reload-disk" style="color: var(--accent-secondary); text-decoration: underline;">Güncelle</a></span>`;
            document.getElementById('link-reload-disk').addEventListener('click', (e) => {
                e.preventDefault();
                if (confirm('Diskteki yeni değişiklikleri yüklemek istiyor musunuz? Yerel düzenlemeleriniz kaybolacaktır.')) {
                    loadFile(currentFilePath);
                }
            });
        } else {
            // Automatically reload in read mode
            setSyncStatus('syncing', 'Diskteki değişiklikler güncelleniyor...');
            const response = await fetch(`/api/content?file=${encodeURIComponent(filePath)}`);
            const fileData = await response.json();
            if (fileData.success) {
                currentContent = fileData.content;
                renderMarkdown(currentContent);
                setSyncStatus('connected', 'Güncellendi');
            }
        }
    });
    
    eventSource.onerror = (err) => {
        console.error('SSE Bağlantı hatası:', err);
        setSyncStatus('error', 'İzleme hatası');
    };
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

// Markdown'daki göreli görsel yollarını (img/grafik.svg) sunucudan servis
// edilebilir /api/asset adreslerine çevirir. Yollar belgenin bulunduğu klasöre
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

    // Code Block Syntax Highlighting (Highlight.js)
    markdownViewer.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    // Render Mermaid diagrams
    const mermaidElements = markdownViewer.querySelectorAll('.mermaid');
    if (mermaidElements.length > 0) {
        try {
            mermaid.run({ nodes: mermaidElements }).catch(err => {
                console.error('Mermaid render hatası:', err);
            });
        } catch (e) {
            console.error('Mermaid.run çağrı hatası:', e);
        }
    }

    // Generate Table of Contents (TOC) & register Scroll Spy
    buildTableOfContents();

    // İçerik değişti: aktif arama varsa eşleşmeleri yeniden hesapla.
    refreshFind();
}

// INLINE WYSIWYG BLOCK EDITOR RENDERING (Edit Mode)
function renderInlineEditor(markdownText) {
    // Parse Markdown text into top-level token blocks
    currentTokens = marked.lexer(markdownText);
    inlineEditor.innerHTML = '';

    // Her token'ın kaynak başlangıç satırı (space dahil ilerleyerek).
    const tokenLineStarts = [];
    let _ln = 1;
    for (const t of currentTokens) {
        tokenLineStarts.push(_ln);
        _ln += (t.raw.match(/\n/g) || []).length;
    }

    currentTokens.forEach((token, index) => {
        // Skip spaces but keep them in token array for file reconstructions
        if (token.type === 'space') return;

        const blockWrapper = document.createElement('div');
        blockWrapper.className = 'inline-block-wrapper md-block';
        blockWrapper.setAttribute('data-index', index);
        blockWrapper.dataset.ln = tokenLineStarts[index];
        
        // 1. Rendered representation of the block
        const renderedDiv = document.createElement('div');
        renderedDiv.className = 'block-rendered';
        
        let blockHtml = '';
        if (token.type === 'table') {
            // Render table wrapped with a raw-edit action overlay
            blockHtml = `
                <div class="table-block-container" style="position: relative; margin: 1rem 0;">
                    <div class="table-edit-actions" style="margin-bottom: 0.5rem; display: flex; justify-content: flex-end;">
                        <button class="secondary-btn btn-table-edit-raw" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; border-radius: 6px; display: flex; align-items: center; gap: 0.25rem; font-family: var(--font-ui);">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                            </svg>
                            <span>Tabloyu Düzenle (MD)</span>
                        </button>
                    </div>
                    ${marked.parser([token])}
                </div>
            `;
        } else if (token.type === 'list') {
            blockHtml = marked.parser([token]);
        } else {
            blockHtml = marked.parse(token.raw);
        }
        
        renderedDiv.innerHTML = preprocessRenderedHTML(blockHtml);
        resolveLocalAssets(renderedDiv);
        
        // 2. Raw Markdown Editor for the block (hidden by default)
        const editorDiv = document.createElement('div');
        editorDiv.className = 'block-editor hidden';
        
        const textarea = document.createElement('textarea');
        textarea.className = 'block-textarea';
        textarea.value = token.raw;
        textarea.spellcheck = false;
        
        // Auto-grow textarea height initially
        textarea.style.height = 'auto';
        
        editorDiv.appendChild(textarea);
        blockWrapper.appendChild(renderedDiv);
        blockWrapper.appendChild(editorDiv);
        
        // Block interaction events
        renderedDiv.addEventListener('click', (e) => {
            if (!isEditMode) return;
            
            // If it's a table block, only enter raw edit mode when the button is clicked
            if (token.type === 'table') {
                const editBtn = e.target.closest('.btn-table-edit-raw');
                if (editBtn) {
                    closeAllBlockEditors();
                    // Inline cell edits don't re-render, so refresh the raw editor
                    // from the current token to avoid showing stale markdown.
                    textarea.value = currentTokens[index].raw;
                    renderedDiv.classList.add('hidden');
                    editorDiv.classList.remove('hidden');
                    textarea.focus();
                    textarea.style.height = 'auto';
                    textarea.style.height = (textarea.scrollHeight + 5) + 'px';
                }
                return;
            }
            
            // Standard block click-to-edit behavior
            closeAllBlockEditors();
            renderedDiv.classList.add('hidden');
            editorDiv.classList.remove('hidden');
            textarea.focus();
            
            // Dynamically resize height
            textarea.style.height = 'auto';
            textarea.style.height = (textarea.scrollHeight + 5) + 'px';
        });
        
        // Auto-saving on blur
        textarea.addEventListener('blur', () => {
            saveBlockEdit(index, textarea.value);
        });

        // Make table cells inline-editable (Excel-style)
        if (token.type === 'table') {
            const tableDom = blockWrapper.querySelector('table');
            if (tableDom) {
                makeTableCellsEditable(tableDom, index);
            }
        }
        
        // Auto-grow textarea on typing
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = (textarea.scrollHeight + 5) + 'px';
            writeDraft(reconstructMarkdownWithPendingEdit(index, textarea.value));
            if (!chkAutosave.checked) {
                saveStatus.textContent = 'KaydedilmemiÅŸ deÄŸiÅŸiklikler var';
            }
        });
        
        // Key events inside block editor
        textarea.addEventListener('keydown', (e) => {
            // Tab key support inside blocks
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 4;
            }
            
            // Ctrl + Enter to finish editing and save
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                textarea.blur();
            }
            
            // Escape to cancel editing
            if (e.key === 'Escape') {
                e.preventDefault();
                textarea.value = token.raw; // Reset
                textarea.blur();
            }
        });
        
        inlineEditor.appendChild(blockWrapper);
    });
    
    // Add Notion-style dynamic "Add New Block" helper at the bottom
    renderAddBlockBtn();
    
    // Run Code Highlighting
    inlineEditor.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    // Run Mermaid Diagrams inside inline editor
    const mermaidElements = inlineEditor.querySelectorAll('.mermaid');
    if (mermaidElements.length > 0) {
        try {
            mermaid.run({ nodes: mermaidElements }).catch(err => {
                console.error(err);
            });
        } catch (e) {
            console.error(e);
        }
    }

    // İçerik değişti: aktif arama varsa eşleşmeleri yeniden hesapla.
    refreshFind();
}

// NOTION-STYLE NEW BLOCK ADDITION
function renderAddBlockBtn() {
    const addWrapper = document.createElement('div');
    addWrapper.className = 'inline-block-wrapper add-block-wrapper';
    
    const placeholder = document.createElement('div');
    placeholder.className = 'add-block-placeholder';
    placeholder.textContent = '+ Yeni paragraf veya markdown bloğu ekle...';
    
    addWrapper.appendChild(placeholder);
    
    addWrapper.addEventListener('click', () => {
        // Replace helper text with a typing editor immediately
        addWrapper.innerHTML = '';
        addWrapper.classList.remove('add-block-wrapper');
        
        const textarea = document.createElement('textarea');
        textarea.className = 'block-textarea';
        textarea.placeholder = "Yeni markdown içeriğini buraya girin (Kaydetmek için dışarı tıklayın veya Ctrl+Enter)...";
        textarea.spellcheck = false;
        
        addWrapper.appendChild(textarea);
        textarea.focus();
        
        textarea.addEventListener('blur', () => {
            const val = textarea.value.trim();
            if (val) {
                // Construct and append new content to document
                const separator = currentContent.endsWith('\n') ? '\n' : '\n\n';
                const updatedContent = currentContent + separator + val;
                
                // Immediately update memory and save
                currentContent = updatedContent;
                writeDraft(updatedContent);
                saveFile(updatedContent);
                renderInlineEditor(updatedContent);
            } else {
                // Reset placeholder
                inlineEditor.removeChild(addWrapper);
                renderAddBlockBtn();
            }
        });
        
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                textarea.blur();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                textarea.value = '';
                textarea.blur();
            }
        });
    });
    
    inlineEditor.appendChild(addWrapper);
}

// INLINE EDITOR UTILITIES
function closeAllBlockEditors() {
    // Finds any active block editor and blurs its textarea, which triggers saving it
    const activeTextareas = inlineEditor.querySelectorAll('.block-editor:not(.hidden) .block-textarea');
    activeTextareas.forEach(ta => {
        ta.blur();
    });
}

function saveBlockEdit(index, newValue) {
    const originalValue = currentTokens[index].raw;
    
    // If nothing changed, restore block state and exit
    if (originalValue === newValue) {
        const wrapper = inlineEditor.querySelector(`.inline-block-wrapper[data-index="${index}"]`);
        if (wrapper) {
            wrapper.querySelector('.block-rendered').classList.remove('hidden');
            wrapper.querySelector('.block-editor').classList.add('hidden');
        }
        return;
    }
    
    // Persist the change, then re-render blocks so HTML, Mermaid and TOC refresh
    const updatedContent = applyTokenEdit(index, newValue);
    renderInlineEditor(updatedContent);
}

// Persist a single block's new raw markdown into the token array and schedule
// a save. Returns the reconstructed document. Does NOT re-render — callers that
// need a visual refresh (e.g. paragraph edits) call renderInlineEditor themselves.
// Table cell edits intentionally skip the re-render so the viewer stays put.
function applyTokenEdit(index, newRaw) {
    currentTokens[index].raw = newRaw;
    const updatedContent = reconstructMarkdownFromBlocks();
    currentContent = updatedContent; // keep memory in sync
    writeDraft(updatedContent);

    if (chkAutosave.checked) {
        saveStatus.textContent = 'Değişiklikler yapılıyor...';
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            saveFile(updatedContent);
        }, 1500);
    } else {
        saveStatus.textContent = 'Kaydedilmemiş değişiklikler var';
    }
    return updatedContent;
}

function reconstructMarkdownFromBlocks() {
    return currentTokens.map(token => token.raw).join('');
}

function reconstructMarkdownWithPendingEdit(index, value) {
    return currentTokens.map((token, tokenIndex) => tokenIndex === index ? value : token.raw).join('');
}

// TABLE WYSIWYG EDITOR HELPERS
function convertHTMLTableToMarkdown(table, align = []) {
    let markdown = '';

    // Get headers
    const headers = [];
    const headerRow = table.querySelector('thead tr');
    if (headerRow) {
        headerRow.querySelectorAll('th').forEach(th => {
            const input = th.querySelector('input');
            headers.push(input ? input.value : th.textContent.trim());
        });
    }

    if (headers.length > 0) {
        markdown += '| ' + headers.join(' | ') + ' |\n';
        // Preserve original column alignment from the parsed token
        markdown += '| ' + headers.map((_, i) => {
            switch (align[i]) {
                case 'center': return ':---:';
                case 'left': return ':---';
                case 'right': return '---:';
                default: return '---';
            }
        }).join(' | ') + ' |\n';
    }
    
    // Get rows
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const cells = [];
        row.querySelectorAll('td').forEach(td => {
            const input = td.querySelector('input');
            cells.push(input ? input.value : td.textContent.trim());
        });
        markdown += '| ' + cells.join(' | ') + ' |\n';
    });
    
    return markdown;
}

function makeTableCellsEditable(tableElement, tokenIndex) {
    const cells = tableElement.querySelectorAll('th, td');
    cells.forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (!isEditMode) return;
            if (cell.querySelector('input')) return; // Already editing
            
            // Stop propagation to prevent launching block raw markdown editor
            e.stopPropagation();
            
            const originalText = cell.textContent.trim();
            cell.innerHTML = `<input type="text" class="table-cell-input" value="">`;
            const input = cell.querySelector('input');
            input.value = originalText;
            input.focus();
            
            // Style input
            input.style.width = '100%';
            input.style.background = 'var(--bg-control)';
            input.style.border = '1px solid var(--accent-primary)';
            input.style.color = 'var(--text-primary)';
            input.style.padding = '4px 8px';
            input.style.outline = 'none';
            input.style.fontFamily = 'var(--font-ui)';
            input.style.fontSize = '0.9rem';
            input.style.borderRadius = '4px';
            
            const finishCellEdit = () => {
                const newText = input.value.trim();
                cell.textContent = newText;

                // Rebuild the table markdown from the live DOM, preserving the
                // original column alignment, and persist WITHOUT re-rendering so
                // the table viewer stays exactly where it is.
                const token = currentTokens[tokenIndex];
                const tableMarkdown = convertHTMLTableToMarkdown(tableElement, token.align || []);
                applyTokenEdit(tokenIndex, tableMarkdown);
            };
            
            input.addEventListener('blur', finishCellEdit);
            input.addEventListener('keydown', (ke) => {
                if (ke.key === 'Enter') {
                    ke.preventDefault();
                    input.blur();
                }
                if (ke.key === 'Escape') {
                    ke.preventDefault();
                    cell.textContent = originalText; // Revert
                }
            });
        });
    });
}

// TABLE OF CONTENTS GENERATION
function buildTableOfContents() {
    tocList.innerHTML = '';
    
    // Select all heading tags inside active view container (reader vs editor)
    const activeContainer = isEditMode ? inlineEditor : markdownViewer;
    const headings = activeContainer.querySelectorAll('h1, h2, h3, h4');
    headingElements = Array.from(headings);
    
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
            // In edit mode scroll the parent block wrapper; in read mode the heading.
            const target = isEditMode
                ? (heading.closest('.inline-block-wrapper') || heading)
                : heading;
            scrollElementIntoView(target);

            document.querySelectorAll('.toc-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });

        tocList.appendChild(link);
    });

    handleScrollSpy();
}

// Robust scroll-to-element within the active scroll container.
// Uses bounding-rect deltas so it works regardless of offsetParent quirks
// (flex centering, positioned panes) in both read and edit modes.
function scrollElementIntoView(target) {
    if (!target) return;
    const container = isEditMode ? inlineEditor : paneRead;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta = targetRect.top - containerRect.top;
    container.scrollTo({
        top: Math.max(0, container.scrollTop + delta - 16),
        behavior: 'smooth'
    });
}

// SCROLL SPY MECHANISM
function handleScrollSpy() {
    if (headingElements.length === 0) return;
    
    const scrollContainer = isEditMode ? inlineEditor : paneRead;
    const containerScrollTop = scrollContainer.scrollTop;
    
    let activeHeadingId = '';
    const triggerOffset = 120; 

    for (let i = 0; i < headingElements.length; i++) {
        const heading = headingElements[i];
        const headingTop = heading.offsetTop;

        if (headingTop - containerScrollTop <= triggerOffset) {
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
        setSyncStatus('syncing', 'Kaydediliyor...');
        saveStatus.textContent = 'Kaydediliyor...';
        
        if (contentToSave === null) {
            contentToSave = isEditMode ? reconstructMarkdownFromBlocks() : currentContent;
        }
        
        const response = await fetch('/api/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: currentFilePath,
                content: contentToSave
            })
        });

        const data = await response.json();
        if (data.success) {
            currentContent = contentToSave;
            clearDraft();
            setSyncStatus('connected', 'Kaydedildi');
            saveStatus.textContent = 'Tüm değişiklikler kaydedildi';
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('Kaydetme hatası:', error);
        setSyncStatus('error', 'Kaydetme Hatası');
        saveStatus.innerHTML = `<span style="color: var(--error)">Kayıt başarısız: ${error.message}</span>`;
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
    // 1. Oku / Düzenle toggling
    btnReadMode.addEventListener('click', () => {
        if (!isEditMode) return;

        // Kaydırma senkronu: düzenleme panelinde en üstteki blok indeksini yakala.
        const anchorIndex = topBlockIndex(inlineEditor, editBlocks());

        // First close any open block textareas to save their content
        closeAllBlockEditors();

        isEditMode = false;

        btnReadMode.classList.add('active');
        btnEditMode.classList.remove('active');

        paneRead.classList.remove('hidden');
        paneEdit.classList.add('hidden');
        btnSave.classList.add('hidden');

        // Reconstruct content and render read viewer
        currentContent = reconstructMarkdownFromBlocks();
        renderMarkdown(currentContent);

        // Hedefte aynı bloğu tepeye getir (layout + mermaid/hljs için rAF + kısa gecikme).
        const restore = () => scrollToBlock(paneRead, readBlocks(), anchorIndex);
        requestAnimationFrame(restore);
        setTimeout(restore, 160);
    });

    btnEditMode.addEventListener('click', () => {
        if (isEditMode) return;

        // Kaydırma senkronu: okuma panelinde en üstteki blok indeksini yakala.
        const anchorIndex = topBlockIndex(paneRead, readBlocks());

        isEditMode = true;

        btnEditMode.classList.add('active');
        btnReadMode.classList.remove('active');

        paneEdit.classList.remove('hidden');
        paneRead.classList.add('hidden');
        btnSave.classList.remove('hidden');

        // Render block inline editor
        renderInlineEditor(currentContent);

        // Hedefte aynı bloğu tepeye getir.
        const restore = () => scrollToBlock(inlineEditor, editBlocks(), anchorIndex);
        requestAnimationFrame(restore);
        setTimeout(restore, 160);
    });

    // 2. Manual Save Button click
    btnSave.addEventListener('click', () => {
        closeAllBlockEditors();
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

    // 5. Üst bar tema swatch'leri (anında uygula + kalıcı kaydet)
    if (themeSwitch) {
        themeSwitch.querySelectorAll('.theme-swatch').forEach((btn) => {
            btn.addEventListener('click', () => {
                setTheme(btn.dataset.themeValue);
                saveSettings();
            });
        });
    }

    // 5b. Üst bar satır numarası aç/kapa (yalnızca düzenleme; kalıcı kaydet)
    if (btnLineNumbers) {
        btnLineNumbers.addEventListener('click', () => {
            applyLineNumbers(!lineNumbersOn);
            saveSettings();
        });
    }

    // 6. Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Support Ctrl + S hotkey to save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            closeAllBlockEditors();
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
    inlineEditor.addEventListener('scroll', handleScrollSpy);

    // 8. Sidebar grip toggle
    sidebarGrip.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // 10. Belge içi bağlantılar + geri/ileri
    markdownViewer.addEventListener('click', handleDocumentLinkClick);
    // Düzenleme modunda tıklama bloğu düzenlemeye açar; bağlantı sayfayı terk etmesin.
    inlineEditor.addEventListener('click', (e) => {
        if (e.target.closest('a[href]')) e.preventDefault();
    });
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
    document.addEventListener('scroll', hideContextMenu, true);
    window.addEventListener('blur', hideContextMenu);
    window.addEventListener('resize', hideContextMenu);

    window.addEventListener('beforeunload', (event) => {
        if (!hasUnsavedChanges) return;
        closeAllBlockEditors();
        event.preventDefault();
        event.returnValue = '';
    });
}

// DRAFT PERSISTENCE
function getDraftKey(filePath = currentFilePath) {
    return `md_flow_draft:${filePath}`;
}

function getDraft(filePath) {
    try {
        const stored = storage.getItem(getDraftKey(filePath));
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

function writeDraft(content = currentContent) {
    if (!currentFilePath) return;
    storage.setItem(getDraftKey(), JSON.stringify({
        content,
        savedAt: Date.now()
    }));
    hasUnsavedChanges = true;
}

function clearDraft(filePath = currentFilePath) {
    if (!filePath) return;
    storage.removeItem(getDraftKey(filePath));
    if (filePath === currentFilePath) {
        hasUnsavedChanges = false;
    }
}

// STORAGE STORAGE PERSISTENCE
// Satır numarası oluğunu aç/kapat (hem okuma hem düzenleme paneli).
// Satır numaraları YALNIZCA düzenleme modunda. Toggle butonunu da günceller.
function applyLineNumbers(on) {
    lineNumbersOn = on;
    paneEdit.classList.toggle('md-linenums', on);
    paneRead.classList.remove('md-linenums');
    if (btnLineNumbers) btnLineNumbers.classList.toggle('active', on);
}

// Temayı uygular + üst bardaki aktif swatch'i işaretler.
function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    if (themeSwitch) {
        themeSwitch.querySelectorAll('.theme-swatch').forEach((b) =>
            b.classList.toggle('active', b.dataset.themeValue === theme));
    }
}

// --- Okuma <-> Düzenleme kaydırma senkronu ---
// İki panel de aynı belge bloklarını AYNI SIRADA içerir (read: render öğeleri,
// edit: .inline-block-wrapper). Bloklar birebir eşleştiği için, kaynaktaki en
// üstteki bloğun indeksini bulup hedefte o bloğu tepeye getiriyoruz.
function readBlocks() {
    return Array.from(markdownViewer.children);
}
function editBlocks() {
    return Array.from(inlineEditor.querySelectorAll(':scope > .inline-block-wrapper:not(.add-block-wrapper)'));
}
function topBlockIndex(scroller, blocks) {
    if (!blocks.length) return 0;
    const cTop = scroller.getBoundingClientRect().top;
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].getBoundingClientRect().bottom > cTop + 4) return i;
    }
    return blocks.length - 1;
}
function scrollToBlock(scroller, blocks, index) {
    const el = blocks[index];
    if (!el) return;
    const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += delta;
}

function collectSettings() {
    return {
        theme: currentTheme,
        autosave: chkAutosave.checked,
        lineNumbers: lineNumbersOn,
        sidebarTab: activeSidebarTab
    };
}

// Ayarlar sunucuda (%APPDATA%\MDFlowViewer\settings.json) saklanır. Port her
// açılışta değiştiği için localStorage kalıcı değil; bu yüzden sunucuya yazıyoruz.
async function saveSettings() {
    const settings = collectSettings();
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
    } catch (e) {
        console.error('Ayarlar sunucuya kaydedilemedi:', e);
    }
    try { storage.setItem('md_viewer_settings', JSON.stringify(settings)); } catch (e) { /* yut */ }
}

async function loadSettings() {
    let settings = {};
    try {
        const r = await fetch('/api/settings');
        const d = await r.json();
        if (d && d.success && d.settings) settings = d.settings;
    } catch (e) {
        // Sunucuya ulaşılamazsa localStorage yedeği (aynı oturum).
        try { settings = JSON.parse(storage.getItem('md_viewer_settings') || '{}'); } catch (_) { settings = {}; }
    }

    // Tema — varsayılan AÇIK (minimal-light)
    setTheme(settings.theme || 'minimal-light');

    // Satır numarası — varsayılan AÇIK (yalnızca düzenleme modu)
    applyLineNumbers(settings.lineNumbers !== undefined ? settings.lineNumbers : true);

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
    return isEditMode ? inlineEditor : markdownViewer;
}
function findScroller() {
    return isEditMode ? inlineEditor : paneRead;
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

    findMatches = computeFindMatches(query);

    if (!findMatches.length) {
        findIndex = -1;
    } else if (delta === 0) {
        findIndex = findIndex < 0 ? 0 : Math.min(findIndex, findMatches.length - 1);
    } else {
        const base = findIndex < 0 ? (delta > 0 ? -1 : 0) : findIndex;
        findIndex = (base + delta + findMatches.length) % findMatches.length;
    }

    applyFindHighlights();
    if (jump) scrollToFindMatch();
    updateFindUI();
}

function clearFind(resetInput = true) {
    if (resetInput) findInput.value = '';
    findLastQuery = findInput.value;
    findMatches = [];
    findIndex = -1;

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

// Linux/WebKitGTK'da window.print() sessizce yok sayılır; diyaloğu native
// köprü açar (app/main.py JsApi.print_page). Windows'ta köprü False döner.
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
// Tarayıcıdan native diyalog açılamadığı için pywebview köprüsünü kullanır
// (app/main.py JsApi.open_file). Seçici son açılan klasörde başlar; seçilen
// dosyanın klasörü aynı zamanda yeni çalışma kökü olur.
// ============================================================
function nativeApi() {
    // Linux/GTK'da pywebview, api'yi önce boş nesne ({}) olarak koyar,
    // fonksiyonları 'pywebviewready' ile birlikte doldurur. Boş nesneyi
    // "hazır" saymamak için bilinen bir metodun varlığına bakılır.
    const api = window.pywebview && window.pywebview.api;
    return api && typeof api.explorer_state === 'function' ? api : null;
}

// Çalışma alanı (klasör) açma + son açılanlar listeleri. Klasör seçilince
// gezgin kökü ve belge kökü o klasör olur; vault kilidi açıksa kilit de o
// klasöra taşınır (bkz. app/server.py Workspace.open_workspace).
async function openFolderDialog() {
    const api = nativeApi();
    if (!api || typeof api.open_folder !== 'function') {
        alert('Klasör seçme penceresi yalnızca MD Flow Viewer uygulama penceresinde çalışır.');
        return;
    }
    if (!confirmLeaveUnsaved()) return;
    try {
        const result = await api.open_folder();
        if (result) adoptWorkspace(result);
    } catch (error) {
        console.error('Klasör seçme hatası:', error);
        alert('Klasör seçme penceresi açılamadı: ' + error);
    }
}

async function openWorkspacePath(path) {
    const api = nativeApi();
    if (!api || typeof api.open_folder_path !== 'function') return;
    if (!confirmLeaveUnsaved()) return;
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
    if (!confirmLeaveUnsaved()) return;
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
        alert('Son açılanlar yalnızca MD Flow Viewer uygulama penceresinde çalışır.');
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
            action: async () => {
                try {
                    await api.clear_recent_list(kind);
                } catch (error) {
                    console.error('Liste temizlenemedi:', error);
                }
            },
        });
    }
    showMenuUnder(anchorEl, items);
}

function dirname(p) {
    const clean = String(p).replace(/[\\/]+$/, '');
    const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    return i > 0 ? clean.slice(0, i) : clean;
}

async function openFileDialog() {
    const api = nativeApi();
    if (!api || typeof api.open_file !== 'function') {
        alert('Dosya seçme penceresi yalnızca MD Flow Viewer uygulama penceresinde çalışır.');
        return;
    }

    if (!confirmLeaveUnsaved()) return;

    try {
        const path = await api.open_file();
        if (path) await loadFile(path);
    } catch (error) {
        console.error('Dosya seçme hatası:', error);
        alert('Dosya seçme penceresi açılamadı: ' + error);
    }
}
