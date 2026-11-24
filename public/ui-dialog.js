/**
 * Uygulama içi onay ve uyarı kutuları (window.confirm / alert yerine).
 *
 * Tarayıcı kutuları "tauri.localhost şunu diyor" başlığıyla, temadan bağımsız
 * çıkıyordu. Bunlar temaya uyar, Türkçe düğmeler taşır; Enter onaylar, Esc
 * vazgeçer. Kutular sırayla gösterilir: biri açıkken gelen ikincisi bekler.
 *
 *   UiDialog.confirm(mesaj, { okText, cancelText }) -> Promise<boolean>
 *   UiDialog.alert(mesaj)                           -> Promise<void>
 *   UiDialog.prompt(mesaj, { value, placeholder, okText }) -> Promise<string|null>
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
            prompt: function (message, opts) {
                opts = opts || {};
                return enqueue({
                    kind: 'prompt',
                    message: String(message),
                    value: opts.value || '',
                    placeholder: opts.placeholder || '',
                    okText: opts.okText || 'Tamam',
                    cancelText: opts.cancelText || 'Vazgeç'
                }).then(function (v) { return typeof v === 'string' ? v : null; }, function () { return null; });
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

            var input = null;
            if (spec.kind === 'prompt') {
                text.classList.add('short');
                input = document.createElement('input');
                input.type = 'text';
                input.className = 'ui-dialog-input';
                input.value = spec.value;
                input.placeholder = spec.placeholder;
                input.autocomplete = 'off';
                input.spellcheck = false;
                input.enterKeyHint = 'done';
                input.setAttribute('aria-labelledby', text.id);
                box.appendChild(input);
            }

            var actions = document.createElement('div');
            actions.className = 'ui-dialog-actions';
            var cancel = null;
            if (spec.kind !== 'alert') {
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

            // Yanıt: confirm/alert true|false, prompt metin|null
            function accept() { finish(input ? input.value : true); }
            function reject() { finish(input ? null : spec.kind !== 'confirm'); }

            function onKey(e) {
                if (e.isComposing) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    reject();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (cancel && document.activeElement === cancel) reject();
                    else accept();
                } else if (e.key === 'Tab') {
                    // Odak kutunun düğmeleri arasında kalsın
                    e.preventDefault();
                    var buttons = [input, cancel, ok].filter(Boolean);
                    var i = buttons.indexOf(document.activeElement);
                    buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
                } else {
                    e.stopPropagation(); // arkadaki kısayollar (Ctrl+E vb.) çalışmasın
                }
            }

            ok.addEventListener('click', accept);
            if (cancel) cancel.addEventListener('click', reject);
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(backdrop);
            if (input) {
                input.focus();
                input.select();
            } else {
                ok.focus();
            }
        });
    }

    var dialogs = create(domShow);
    var api = { create: create, confirm: dialogs.confirm, alert: dialogs.alert, prompt: dialogs.prompt };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.UiDialog = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
