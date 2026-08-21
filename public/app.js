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

// APPLICATION STATE
let currentFilePath = '';
let currentContent = '';
let isEditMode = false;
let eventSource = null;
let autosaveTimer = null;
let headingElements = [];
let workspaceFiles = [];
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
const btnSettings = document.getElementById('btn-settings');
const btnSave = document.getElementById('btn-save');

const sidebar = document.getElementById('sidebar');
const sidebarGrip = document.getElementById('sidebar-grip');
const tocList = document.getElementById('toc-list');
const filesList = document.getElementById('files-list');

const paneRead = document.getElementById('pane-read');
const paneEdit = document.getElementById('pane-edit');
const markdownViewer = document.getElementById('markdown-viewer');
const inlineEditor = document.getElementById('inline-editor');
const chkAutosave = document.getElementById('chk-autosave');
const btnLineNumbers = document.getElementById('btn-line-numbers');
const saveStatus = document.getElementById('save-status');

const settingsDrawer = document.getElementById('settings-drawer');
const settingsDrawerOverlay = document.getElementById('settings-drawer-overlay');
const btnCloseSettings = document.getElementById('btn-close-settings');
const themeSwitch = document.getElementById('theme-switch');
const customCssPath = document.getElementById('custom-css-path');
const btnApplyCssPath = document.getElementById('btn-apply-css-path');
const customInlineCss = document.getElementById('custom-inline-css');
const btnSaveSettings = document.getElementById('btn-save-settings');
const customStylesTag = document.getElementById('custom-css-styles');

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
    
    // 2. Fetch file content
    await loadFile(fileParam || '');
    
    // 3. Load workspace files list
    await loadWorkspaceFiles();
}

// FETCH AND RENDER A MARKDOWN FILE
async function loadFile(filePath) {
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
            window.history.pushState({ path: data.path }, '', newUrl);
            
            // Render Content based on active mode
            if (isEditMode) {
                renderInlineEditor(currentContent);
            } else {
                renderMarkdown(currentContent);
            }
            
            // Establish Live Connection
            setupSSEWatcher(data.path);
            setSyncStatus('connected', 'Bağlandı');
            
            // Auto update active document in document list
            highlightActiveFile();
            
            // Reload local directory files
            await loadWorkspaceFiles();
        } else {
            throw new Error(data.error || 'Bilinmeyen sunucu hatası');
        }
    } catch (error) {
        console.error('Dosya yükleme hatası:', error);
        setSyncStatus('error', 'Yükleme hatası');
        markdownViewer.innerHTML = `<div class="danger-box">
            <h4>Dosya Yüklenirken Hata Oluştu</h4>
            <p>${error.message}</p>
        </div>`;
    }
}

// WORKSPACE FILES BROWSER
async function loadWorkspaceFiles() {
    try {
        const url = `/api/files?file=${encodeURIComponent(currentFilePath)}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success && data.files.length > 0) {
            workspaceFiles = data.files;
            renderWorkspaceFilesList();
        } else {
            filesList.innerHTML = `<span class="empty-state">MD dosyası bulunamadı</span>`;
        }
    } catch (error) {
        console.error('Dizin listeleme hatası:', error);
        filesList.innerHTML = `<span class="empty-state">Dizin yüklenemedi</span>`;
    }
}

function renderWorkspaceFilesList() {
    filesList.innerHTML = '';
    workspaceFiles.forEach(file => {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'file-item';
        fileDiv.setAttribute('data-path', file.path);
        if (file.path === currentFilePath) {
            fileDiv.classList.add('active');
        }
        
        fileDiv.innerHTML = `
            <svg class="file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span title="${file.path}">${file.name}</span>
        `;
        
        fileDiv.addEventListener('click', () => {
            if (isEditMode && reconstructMarkdownFromBlocks() !== currentContent) {
                if (!confirm('Kaydedilmemiş değişiklikleriniz var. Başka bir dosyaya geçmek istiyor musunuz?')) {
                    return;
                }
            }
            loadFile(file.path);
        });
        
        filesList.appendChild(fileDiv);
    });
}

function highlightActiveFile() {
    document.querySelectorAll('.file-item').forEach(item => {
        if (item.getAttribute('data-path') === currentFilePath) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
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

    // 3. Settings Drawer Open / Close
    btnSettings.addEventListener('click', () => {
        settingsDrawer.classList.add('open');
        settingsDrawerOverlay.classList.add('open');
    });

    const closeDrawer = () => {
        settingsDrawer.classList.remove('open');
        settingsDrawerOverlay.classList.remove('open');
    };
    btnCloseSettings.addEventListener('click', closeDrawer);
    settingsDrawerOverlay.addEventListener('click', closeDrawer);

    // 4. Custom Inline CSS input changes
    customInlineCss.addEventListener('input', () => {
        applyCustomCSS();
    });

    // 5. Custom CSS Path fetching
    btnApplyCssPath.addEventListener('click', loadExternalCSS);

    // 6. Save Drawer Settings button
    btnSaveSettings.addEventListener('click', () => {
        saveSettings();
        closeDrawer();
    });

    // 7. Üst bar tema swatch'leri (anında uygula + kalıcı kaydet)
    if (themeSwitch) {
        themeSwitch.querySelectorAll('.theme-swatch').forEach((btn) => {
            btn.addEventListener('click', () => {
                setTheme(btn.dataset.themeValue);
                saveSettings();
            });
        });
    }

    // 7b. Üst bar satır numarası aç/kapa (yalnızca düzenleme; kalıcı kaydet)
    if (btnLineNumbers) {
        btnLineNumbers.addEventListener('click', () => {
            applyLineNumbers(!lineNumbersOn);
            saveSettings();
        });
    }

    // 8. Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Support Ctrl + S hotkey to save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            closeAllBlockEditors();
            saveFile();
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

    // 9. Scroll Spy scroll listener on read pane & inline editor scrollable area
    paneRead.addEventListener('scroll', handleScrollSpy);
    inlineEditor.addEventListener('scroll', handleScrollSpy);

    // 10. Sidebar grip toggle
    sidebarGrip.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    window.addEventListener('beforeunload', (event) => {
        if (!hasUnsavedChanges) return;
        closeAllBlockEditors();
        event.preventDefault();
        event.returnValue = '';
    });
}

// STYLING/SETTINGS MANAGER
async function loadExternalCSS() {
    const cssPath = customCssPath.value.trim();
    if (!cssPath) {
        applyCustomCSS(); // reset to only inline
        return;
    }

    try {
        btnApplyCssPath.textContent = 'Yükleniyor...';
        btnApplyCssPath.disabled = true;
        
        const response = await fetch(`/api/css?path=${encodeURIComponent(cssPath)}`);
        const data = await response.json();
        
        if (data.success) {
            btnApplyCssPath.textContent = 'Yüklendi!';
            setTimeout(() => {
                btnApplyCssPath.textContent = 'Yükle';
                btnApplyCssPath.disabled = false;
            }, 1500);
            
            applyCustomCSS(data.css);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('Özel CSS yükleme hatası:', error);
        alert(`CSS Dosyası Yüklenemedi: ${error.message}`);
        btnApplyCssPath.textContent = 'Yükle';
        btnApplyCssPath.disabled = false;
    }
}

function applyCustomCSS(externalCss = '') {
    const inlineCss = customInlineCss.value;
    customStylesTag.textContent = `${externalCss}\n\n/* Inline Rules */\n${inlineCss}`;
}

// DRAFT PERSISTENCE
function getDraftKey(filePath = currentFilePath) {
    return `md_flow_draft:${filePath}`;
}

function getDraft(filePath) {
    try {
        const stored = localStorage.getItem(getDraftKey(filePath));
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

function writeDraft(content = currentContent) {
    if (!currentFilePath) return;
    localStorage.setItem(getDraftKey(), JSON.stringify({
        content,
        savedAt: Date.now()
    }));
    hasUnsavedChanges = true;
}

function clearDraft(filePath = currentFilePath) {
    if (!filePath) return;
    localStorage.removeItem(getDraftKey(filePath));
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
        cssPath: customCssPath.value,
        inlineCss: customInlineCss.value,
        autosave: chkAutosave.checked,
        lineNumbers: lineNumbersOn
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
    try { localStorage.setItem('md_viewer_settings', JSON.stringify(settings)); } catch (e) { /* yut */ }
}

async function loadSettings() {
    let settings = {};
    try {
        const r = await fetch('/api/settings');
        const d = await r.json();
        if (d && d.success && d.settings) settings = d.settings;
    } catch (e) {
        // Sunucuya ulaşılamazsa localStorage yedeği (aynı oturum).
        try { settings = JSON.parse(localStorage.getItem('md_viewer_settings') || '{}'); } catch (_) { settings = {}; }
    }

    // Tema — varsayılan AÇIK (minimal-light)
    setTheme(settings.theme || 'minimal-light');

    // Satır numarası — varsayılan AÇIK (yalnızca düzenleme modu)
    applyLineNumbers(settings.lineNumbers !== undefined ? settings.lineNumbers : true);

    if (settings.autosave !== undefined) chkAutosave.checked = settings.autosave;
    if (settings.cssPath) { customCssPath.value = settings.cssPath; loadExternalCSS(); }
    if (settings.inlineCss) { customInlineCss.value = settings.inlineCss; applyCustomCSS(); }
}
