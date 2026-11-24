/**
 * Blok düzenleyicide klavye: Ctrl+B / Ctrl+I / Ctrl+K biçimleri ve listede
 * Enter ile maddeyi sürdürme (masaüstü + telefon). Metin işlemleri MdFormat'ta.
 */
(function (root) {
    'use strict';
    var doc = root.document;

    // Değişikliği tarayıcının geri alma yığınına giren tek bir ekleme yapar.
    function replaceText(ta, next) {
        var old = ta.value;
        if (next.text !== old) {
            var a = 0;
            var max = Math.min(old.length, next.text.length);
            while (a < max && old.charCodeAt(a) === next.text.charCodeAt(a)) a++;
            var b = 0;
            while (b < max - a && old.charCodeAt(old.length - 1 - b) === next.text.charCodeAt(next.text.length - 1 - b)) b++;
            var ins = next.text.slice(a, next.text.length - b);
            ta.setSelectionRange(a, old.length - b);
            var ok = ins ? doc.execCommand('insertText', false, ins) : doc.execCommand('delete');
            if (!ok) {
                ta.setRangeText(ins, a, old.length - b, 'end');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        ta.setSelectionRange(next.start, next.end);
    }

    function isBlock(el) { return !!(el && el.classList && el.classList.contains('block-textarea')); }

    function init(editor) {
        // Listede Enter: maddeyi sürdür
        editor.addEventListener('beforeinput', function (e) {
            var ta = e.target;
            if (e.inputType !== 'insertLineBreak' || !isBlock(ta)) return;
            if (ta.selectionStart !== ta.selectionEnd) return;
            var next = MdFormat.newline(ta.value, ta.selectionStart);
            if (!next) return;
            e.preventDefault();
            replaceText(ta, next);
        });
        editor.addEventListener('keydown', function (e) {
            if (!isBlock(e.target) || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
            var action = { b: 'bold', i: 'italic', k: 'link' }[String(e.key).toLowerCase()];
            if (!action) return;
            e.preventDefault();
            e.stopPropagation();
            var ta = e.target;
            replaceText(ta, MdFormat.apply(action, ta.value, ta.selectionStart, ta.selectionEnd));
        });
    }

    root.EditorKeys = { init: init, replaceText: replaceText, isBlock: isBlock };
})(globalThis);
