/**
 * Gezgin ağacında sürükleyip taşıma. Fareyle satır tutulup sürüklenir; telefonda
 * uzun basılıp sürüklenir (sürüklemeden bırakılırsa satırın menüsü açılır).
 * Tauri pencereye bırakılan dosyalar için yerel sürükle-bırakı kullandığından
 * HTML5 sürükle-bırak yerine işaretçi ve dokunma olayları kullanılır.
 */
(function (root) {
    'use strict';

    var doc = root.document;
    var START = 6;              // px: bundan azı tıklama sayılır
    var EDGE = 36;
    var drag = null;            // { row, path, x, y, active, ghost, target, dir, hoverRow, timer, scroll }
    var held = null;            // telefonda uzun basılan satır: { row, menu }
    var touch = null;           // ekrandaki tek parmağın başlangıcı
    var skipClick = false;

    function parentOf(row) { return dirname(row.getAttribute('data-path')); }

    function inside(path, dir) {
        return path === dir || (path.indexOf(dir) === 0 && /[\\/]/.test(path.charAt(dir.length)));
    }

    /** Noktanın altındaki hedef: klasör satırı, notun klasörü ya da kök. */
    function targetAt(x, y) {
        var el = doc.elementFromPoint(x, y);
        var top = explorerState && explorerState.root;
        if (!el || !top) return null;
        var row = el.closest('#explorer-tree .tree-row');
        var dir, mark, folder = null;
        if (row && row.classList.contains('tree-dir')) {
            folder = mark = row;
            dir = row.getAttribute('data-path');
        } else if (row) {
            dir = parentOf(row);
            var box = row.parentElement;
            mark = box && box.classList.contains('tree-children') ? box.previousElementSibling : explorerTree;
        } else if (el.closest('#explorer-tree, #explorer-root')) {
            dir = top;
            mark = el.closest('#explorer-root') || explorerTree;
        } else {
            return null;
        }
        if (inside(dir, drag.path)) return null;            // kendisi ya da kendi içi
        var same = dir === parentOf(drag.row);
        return { dir: same ? null : dir, mark: same ? null : mark, folder: folder };
    }

    function begin() {
        drag.active = true;
        hideContextMenu();
        drag.row.classList.add('drag-source');
        doc.documentElement.classList.add('row-dragging');
        drag.ghost = doc.createElement('div');
        drag.ghost.className = 'drag-ghost';
        drag.ghost.textContent = Notes.noteName(drag.path);
        doc.body.appendChild(drag.ghost);
        drag.scroll = setInterval(autoScroll, 30);
    }

    function autoScroll() {
        var r = explorerTree.getBoundingClientRect();
        if (drag.x < r.left || drag.x > r.right) return;
        if (drag.y < r.top + EDGE) explorerTree.scrollTop -= 10;
        else if (drag.y > r.bottom - EDGE) explorerTree.scrollTop += 10;
        else return;
        update();
    }

    function setMark(el) {
        if (drag.mark === el) return;
        if (drag.mark) drag.mark.classList.remove('drop-target');
        drag.mark = el;
        if (el) el.classList.add('drop-target');
    }

    function update() {
        drag.ghost.style.transform = 'translate(' + (drag.x + 12) + 'px,' + (drag.y + 10) + 'px)';
        var t = targetAt(drag.x, drag.y);
        drag.dir = t && t.dir;
        setMark(t && t.mark);
        var folder = t && t.folder;
        if (folder === drag.folder) return;
        drag.folder = folder;
        clearTimeout(drag.timer);
        // Kapalı klasörün üstünde beklenince açılır.
        if (folder && !folder.classList.contains('open')) {
            drag.timer = setTimeout(function () { folder.parentElement.expandDir(); }, 650);
        }
    }

    function moveTo(x, y) {
        drag.x = x;
        drag.y = y;
        if (!drag.active) {
            if (Math.abs(x - drag.startX) < START && Math.abs(y - drag.startY) < START) return;
            begin();
        }
        update();
    }

    function end(drop) {
        var d = drag;
        if (!d) return;
        clearTimeout(d.timer);
        clearInterval(d.scroll);
        setMark(null);
        drag = null;
        if (!d.active) return;
        d.row.classList.remove('drag-source');
        doc.documentElement.classList.remove('row-dragging');
        d.ghost.remove();
        if (drop && d.dir) Notes.move(d.path, d.dir);
    }

    function start(row, x, y) {
        drag = { row: row, path: row.getAttribute('data-path'), startX: x, startY: y, x: x, y: y };
    }

    function rowOf(e) { return e.target.closest && e.target.closest('.tree-row'); }

    // --- fare ------------------------------------------------------------------
    function onDown(e) {
        skipClick = false;
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        var row = rowOf(e);
        if (row) start(row, e.clientX, e.clientY);
    }
    function onMove(e) {
        if (!drag || e.pointerType !== 'mouse') return;
        if (!(e.buttons & 1)) { end(false); return; }       // pencere dışında bırakılmış
        moveTo(e.clientX, e.clientY);
    }
    function onUp(e) {
        if (!drag || e.pointerType !== 'mouse') return;
        if (drag.active) {
            skipClick = true;
            setTimeout(function () { skipClick = false; }, 0);
        }
        end(true);
    }

    // --- dokunma (telefon) --------------------------------------------------------
    /** Uzun basıldı (contextmenu). Parmak yoksa (fare) menü hemen açılır. */
    function hold(row, menu) {
        if (!touch || !explorerTree.contains(row)) { menu(); return; }
        held = { row: row, menu: menu };
        row.classList.add('drag-lifted');
        start(row, touch.x, touch.y);
    }
    function release() {
        if (held) held.row.classList.remove('drag-lifted');
        held = null;
    }
    function onTouchStart(e) {
        touch = null;
        if (e.touches.length !== 1) { release(); end(false); return; }
        touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    function onTouchMove(e) {
        if (!held || !drag) return;
        if (e.cancelable) e.preventDefault();               // liste kaymasın
        moveTo(e.touches[0].clientX, e.touches[0].clientY);
    }
    function onTouchEnd(e) {
        touch = null;
        if (!held) return;
        var menu = held.menu;
        var moved = drag && drag.active;
        e.preventDefault();                                 // ardından tıklama gelmesin
        e.stopPropagation();                                // paneli kapatan kaydırma sayılmasın
        release();
        end(true);
        if (!moved) menu();
    }

    function init() {
        explorerTree.addEventListener('pointerdown', onDown);
        doc.addEventListener('pointermove', onMove);
        doc.addEventListener('pointerup', onUp);
        explorerTree.addEventListener('click', function (e) {
            if (!skipClick) return;
            skipClick = false;
            e.preventDefault();
            e.stopPropagation();
        }, true);
        doc.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || !drag || !drag.active) return;
            e.preventDefault();
            e.stopPropagation();
            release();
            end(false);
        }, true);
        root.addEventListener('blur', function () { end(false); });
        explorerTree.addEventListener('touchstart', onTouchStart, { passive: true });
        explorerTree.addEventListener('touchmove', onTouchMove, { passive: false });
        explorerTree.addEventListener('touchend', onTouchEnd);
        explorerTree.addEventListener('touchcancel', function () { touch = null; release(); end(false); });
    }

    root.Organize = { hold: hold };
    doc.addEventListener('DOMContentLoaded', init);
})(globalThis);
