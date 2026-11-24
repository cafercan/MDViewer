// Düzenleyicinin (public/live-editor.js) kullandığı CodeMirror 6 parçaları.
// Yeniden derlemek için bu klasörde: npm ci && npm run build
export { EditorState, StateField, StateEffect, Compartment, RangeSetBuilder, EditorSelection, Prec, Transaction } from '@codemirror/state';
export { EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection, lineNumbers, highlightActiveLineGutter, placeholder } from '@codemirror/view';
export { history, historyKeymap, defaultKeymap, undo, redo, indentMore, indentLess } from '@codemirror/commands';
export { syntaxTree, ensureSyntaxTree, indentUnit } from '@codemirror/language';
export { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
