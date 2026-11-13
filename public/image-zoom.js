/**
 * Belgedeki görsele tıklayınca açılan yakınlaştırma penceresi.
 *
 *   ImageZoom.open(src, alt)
 *
 * Fare tekerleği imlecin altındaki noktaya göre yakınlaştırır/uzaklaştırır,
 * sürükleme kaydırır, çift tıklama "sığdır" ile %100 arasında geçer.
 * Klavye: + / - yakınlaştır, 0 sığdır, 1 gerçek boyut, Esc kapat.
 *
 * Hesaplar (ölçek, imlece göre yakınlaştırma, sığdırma) DOM'dan bağımsızdır;
 * Node testleri bunları module.exports üzerinden dener.
 */
(function (root) {
    'use strict';

    var MIN_SCALE = 0.05;
    var MAX_SCALE = 16;
    var STEP = 1.25;

    function clampScale(s) {
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    }

    /** Görseli görünüme sığdır (küçük görseli büyütmez) ve ortala. */
    function fitView(imgW, imgH, viewW, viewH, margin) {
        margin = margin === undefined ? 40 : margin;
        var availW = Math.max(1, viewW - margin * 2);
        var availH = Math.max(1, viewH - margin * 2);
        var scale = Math.min(1, availW / imgW, availH / imgH);
        return centered(imgW, imgH, viewW, viewH, scale);
    }

    function centered(imgW, imgH, viewW, viewH, scale) {
        return {
            scale: scale,
            x: (viewW - imgW * scale) / 2,
            y: (viewH - imgH * scale) / 2
        };
    }

    /**
     * (cx, cy) noktası ekranda yerinde kalacak şekilde ölçeği factor ile çarp.
     * view: { scale, x, y } — x/y görselin sol üst köşesinin ekran konumu.
     */
    function zoomAt(view, factor, cx, cy) {
        var scale = clampScale(view.scale * factor);
        var k = scale / view.scale;
        return {
            scale: scale,
            x: cx - (cx - view.x) * k,
            y: cy - (cy - view.y) * k
        };
    }

    var api = {
        MIN_SCALE: MIN_SCALE,
        MAX_SCALE: MAX_SCALE,
        STEP: STEP,
        clampScale: clampScale,
        fitView: fitView,
        centered: centered,
        zoomAt: zoomAt
    };

    function open(src, alt) {
        if (document.querySelector('.img-zoom')) return;
        var previousFocus = document.activeElement;

        var overlay = document.createElement('div');
        overlay.className = 'img-zoom';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Görsel: ' + (alt || 'görsel'));
        overlay.tabIndex = -1;

        var img = document.createElement('img');
        img.alt = alt || '';
        img.draggable = false;
        overlay.appendChild(img);

        if (alt) {
            var caption = document.createElement('div');
            caption.className = 'img-zoom-caption';
            caption.textContent = alt;
            overlay.appendChild(caption);
        }

        var bar = document.createElement('div');
        bar.className = 'img-zoom-bar';
        function button(text, title, onClick) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.title = title;
            b.setAttribute('aria-label', title);
            b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
            bar.appendChild(b);
            return b;
        }
        button('−', 'Uzaklaştır (-)', function () { zoomCenter(1 / STEP); });
        var level = document.createElement('span');
        level.className = 'img-zoom-level';
        bar.appendChild(level);
        button('+', 'Yakınlaştır (+)', function () { zoomCenter(STEP); });
        button('Sığdır', 'Pencereye sığdır (0)', fit);
        button('1:1', 'Gerçek boyut (1)', actual);
        button('✕', 'Kapat (Esc)', close);
        overlay.appendChild(bar);

        var view = { scale: 1, x: 0, y: 0 };
        var natW = 1;
        var natH = 1;

        function render() {
            img.style.width = natW + 'px';
            img.style.height = natH + 'px';
            img.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
            level.textContent = Math.round(view.scale * 100) + '%';
        }
        function size() {
            return { w: overlay.clientWidth || window.innerWidth, h: overlay.clientHeight || window.innerHeight };
        }
        function fit() {
            var s = size();
            view = fitView(natW, natH, s.w, s.h);
            render();
        }
        function actual() {
            var s = size();
            view = centered(natW, natH, s.w, s.h, 1);
            render();
        }
        function zoomCenter(factor) {
            var s = size();
            view = zoomAt(view, factor, s.w / 2, s.h / 2);
            render();
        }

        img.addEventListener('load', function () {
            natW = img.naturalWidth || 1;
            natH = img.naturalHeight || 1;
            fit();
        });

        overlay.addEventListener('wheel', function (e) {
            e.preventDefault();
            var r = overlay.getBoundingClientRect();
            // Dokunmatik yüzeyde küçük deltalar: üstel ölçek akıcı olsun.
            var factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
            view = zoomAt(view, factor, e.clientX - r.left, e.clientY - r.top);
            render();
        }, { passive: false });

        var drag = null;
        var moved = false;
        overlay.addEventListener('pointerdown', function (e) {
            if (e.button !== 0 || e.target.closest('.img-zoom-bar')) return;
            drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            moved = false;
            overlay.setPointerCapture(e.pointerId);
        });
        overlay.addEventListener('pointermove', function (e) {
            if (!drag) return;
            var dx = e.clientX - drag.x;
            var dy = e.clientY - drag.y;
            if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
                moved = true;
                overlay.classList.add('dragging');
            }
            if (moved) {
                view = { scale: view.scale, x: drag.vx + dx, y: drag.vy + dy };
                render();
            }
        });
        function endDrag(e) {
            if (!drag) return;
            var wasClick = !moved;
            drag = null;
            overlay.classList.remove('dragging');
            // Görselin dışındaki boşluğa tıklamak kapatır.
            if (wasClick && e.type === 'pointerup' && e.target === overlay) close();
        }
        overlay.addEventListener('pointerup', endDrag);
        overlay.addEventListener('pointercancel', endDrag);

        img.addEventListener('dblclick', function (e) {
            var s = size();
            var fitted = fitView(natW, natH, s.w, s.h);
            if (Math.abs(view.scale - fitted.scale) < 0.01) {
                var r = overlay.getBoundingClientRect();
                var target = Math.max(1, fitted.scale * 2);
                view = zoomAt(view, target / view.scale, e.clientX - r.left, e.clientY - r.top);
                render();
            } else {
                fit();
            }
        });

        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(STEP); }
            else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCenter(1 / STEP); }
            else if (e.key === '0') { e.preventDefault(); fit(); }
            else if (e.key === '1') { e.preventDefault(); actual(); }
            else return;
            e.stopPropagation();
        }
        function onResize() { fit(); }

        function close() {
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', onResize);
            overlay.remove();
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        }

        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onResize);
        document.body.appendChild(overlay);
        overlay.focus();
        img.src = src;
        if (img.complete && img.naturalWidth) {
            natW = img.naturalWidth;
            natH = img.naturalHeight;
            fit();
        }
    }

    api.open = open;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.ImageZoom = api;
    }
})(typeof window !== 'undefined' ? window : this);
