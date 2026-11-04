/**
 * Uygulama içi onay ve uyarı kutuları (window.confirm / alert yerine).
 *
 * Tarayıcı kutuları "tauri.localhost şunu diyor" başlığıyla, temadan bağımsız
 * çıkıyordu. Bunlar temaya uyar, Türkçe düğmeler taşır; Enter onaylar, Esc
 * vazgeçer. Kutular sırayla gösterilir: biri açıkken gelen ikincisi bekler.
 *
 *   UiDialog.confirm(mesaj, { okText, cancelText }) -> Promise<boolean>
 *   UiDialog.alert(mesaj)                           -> Promise<void>
 *
 * Hem tarayıcıda (global UiDialog) hem Node'da (module.exports) kullanılabilir;
 * Node testleri `create(göster)` ile sahte bir görüntüleyici verir.
 */
(function (root) {
    'use strict';

    /** @param {function(object): Promise<boolean>} show  kutuyu gösterip yanıtı döndürür */
    function create(show) {
        var chain = Promise.resolve();

        function enqueue(spec) {
            var result = chain.then(function () { return show(spec); });
            chain = result.catch(function () { /* sıra kilitlenmesin */ });
            return result;
        }

        return {
            confirm: function (message, opts) {
                opts = opts || {};
                return enqueue({
                    kind: 'confirm',
                    message: String(message),
                    okText: opts.okText || 'Evet',
                    cancelText: opts.cancelText || 'Vazgeç'
                }).then(Boolean, function () { return false; });
            },
            alert: function (message) {
                return enqueue({ kind: 'alert', message: String(message), okText: 'Tamam' })
                    .then(function () {}, function () {});
            }
        };
    }

    /** Gerçek görüntüleyici: tema değişkenleriyle çizilen kalıcı (modal) kutu. */
    function domShow(spec) {
        return new Promise(function (resolve) {
            var previousFocus = document.activeElement;
            var backdrop = document.createElement('div');
            backdrop.className = 'ui-dialog-backdrop';
            var box = document.createElement('div');
            box.className = 'ui-dialog';
            box.setAttribute('role', spec.kind === 'confirm' ? 'alertdialog' : 'dialog');
            box.setAttribute('aria-modal', 'true');

            var text = document.createElement('p');
            text.className = 'ui-dialog-message';
            text.id = 'ui-dialog-message';
            text.textContent = spec.message;
            box.setAttribute('aria-describedby', text.id);
            box.appendChild(text);

            var actions = document.createElement('div');
            actions.className = 'ui-dialog-actions';
            var cancel = null;
            if (spec.kind === 'confirm') {
                cancel = document.createElement('button');
                cancel.type = 'button';
                cancel.className = 'ui-dialog-btn';
                cancel.textContent = spec.cancelText;
                actions.appendChild(cancel);
            }
            var ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'ui-dialog-btn primary';
            ok.textContent = spec.okText;
            actions.appendChild(ok);
            box.appendChild(actions);
            backdrop.appendChild(box);

            function finish(answer) {
                document.removeEventListener('keydown', onKey, true);
                backdrop.remove();
                if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
                resolve(answer);
            }

            function onKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    finish(spec.kind !== 'confirm');
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    finish(document.activeElement === cancel ? false : true);
                } else if (e.key === 'Tab') {
                    // Odak kutunun düğmeleri arasında kalsın
                    e.preventDefault();
                    var buttons = cancel ? [cancel, ok] : [ok];
                    var i = buttons.indexOf(document.activeElement);
                    buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
                } else {
                    e.stopPropagation(); // arkadaki kısayollar (Ctrl+E vb.) çalışmasın
                }
            }

            ok.addEventListener('click', function () { finish(true); });
            if (cancel) cancel.addEventListener('click', function () { finish(false); });
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(backdrop);
            ok.focus();
        });
    }

    var dialogs = create(domShow);
    var api = { create: create, confirm: dialogs.confirm, alert: dialogs.alert };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.UiDialog = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
