/**
 * Tema kataloğu. İlk on iki temanın renkleri style.css'tedir; diğerleri (ve
 * kullanıcının kendi temaları) dört renkten türetilir: zemin, yazı, vurgu, ikinci
 * vurgu. "-dark" ile biten kimlik koyu temadır; uygulamanın geri kalanı buna bakar.
 *
 * Hem tarayıcıda (global Themes, THEMES) hem Node'da kullanılabilir.
 */
(function (root) {
    'use strict';
    // Arayüz dili (i18n.js); Node'da (testler) hep Türkçe.
    var T = root.I18N ? root.I18N.t
        : typeof require === 'function' ? require('./i18n.js').t : function (s) { return s; };

    // [kimlik, ad, zemin, yazı, vurgu, ikinci vurgu]; css: renkleri style.css'te
    var CSS = [
        ['minimal-light', 'Classic Light', '#f8fafc', '#0f172a', '#4f46e5', '#0891b2'],
        ['github-light', 'GitHub Light', '#ffffff', '#1f2328', '#0969da', '#1a7f37'],
        ['sepia-light', 'Sepia', '#f4ecd8', '#4b3f2f', '#a15c2b', '#7d6b3f'],
        ['rose-light', 'Gül', '#fdf6f7', '#3b1f27', '#be3c64', '#8a4fa3'],
        ['mint-light', 'Nane', '#f3faf6', '#12301f', '#0f8a5f', '#0b7285'],
        ['oak-light', 'Meşe', '#faf5ea', '#33261c', '#9a5526', '#4d6b3c'],
        ['slate-dark', 'Obsidian Dark', '#080c14', '#f8fafc', '#6366f1', '#06b6d4'],
        ['nord-dark', 'Nord Frost', '#2e3440', '#eceff4', '#88c0d0', '#81a1c1'],
        ['forest-dark', 'Orman', '#111a15', '#e6f0e9', '#6ec88c', '#d4b86a'],
        ['lantern-dark', 'Fener', '#1b1410', '#f5e9d8', '#f0b45a', '#8fb573'],
        ['plum-dark', 'Mürdüm', '#1a1320', '#f3eaf6', '#d68ce6', '#f0a5b8'],
        ['midnight-dark', 'Gece Yarısı', '#000000', '#ededed', '#60a5fa', '#a78bfa']
    ];
    var GENERATED = [
        ['paper-light', 'Kâğıt', '#fbfaf7', '#26241f', '#37352f', '#b4502f'],
        ['snow-light', 'Kar', '#ffffff', '#111111', '#111111', '#5b5bd6'],
        ['solarized-light', 'Solarized Light', '#fdf6e3', '#3b4d54', '#2176b5', '#2a857d'],
        ['gruvbox-light', 'Gruvbox Light', '#fbf1c7', '#3c3836', '#af3a03', '#427b58'],
        ['latte-light', 'Catppuccin Latte', '#eff1f5', '#3b3e54', '#8839ef', '#1e66f5'],
        ['dawn-light', 'Rosé Pine Dawn', '#faf4ed', '#4a4566', '#a8446a', '#286983'],
        ['everforest-light', 'Everforest Light', '#fdf6e3', '#4a565c', '#5c7a1b', '#2f7d8c'],
        ['onelight-light', 'One Light', '#fafafa', '#383a42', '#4078f2', '#a626a4'],
        ['tokyo-light', 'Tokyo Gündüz', '#e6e7ed', '#343b58', '#2959aa', '#5a3e8e'],
        ['ayu-light', 'Ayu Light', '#fcfcfc', '#4a4f57', '#b35900', '#2f78b7'],
        ['lavender-light', 'Lavanta', '#f8f6fd', '#2c2440', '#7048c6', '#b04a8f'],
        ['sky-light', 'Gökyüzü', '#f2f8fd', '#12283a', '#0b6fb8', '#0f8b8d'],
        ['lemon-light', 'Limon', '#fdfbea', '#33300f', '#8a6d00', '#5c7a1b'],
        ['peach-light', 'Şeftali', '#fff6f0', '#40261a', '#c2501f', '#a8446a'],
        ['sakura-light', 'Sakura', '#fff5f8', '#40202c', '#c2417c', '#7a5bb5'],
        ['sage-light', 'Adaçayı', '#f4f6f0', '#2a3326', '#55733c', '#8a6b2f'],
        ['turquoise-light', 'Turkuaz', '#effaf9', '#0f3032', '#0b7f82', '#2b62c4'],
        ['linen-light', 'Keten', '#f6f1ea', '#39322a', '#7b5a3c', '#3f6a73'],
        ['cherry-light', 'Kiraz', '#fdf7f5', '#3a1a1a', '#b3261e', '#8a5a00'],
        ['contrast-light', 'Yüksek Karşıtlık', '#ffffff', '#000000', '#0037c4', '#8f0061'],

        ['dracula-dark', 'Dracula', '#282a36', '#f8f8f2', '#bd93f9', '#ff79c6'],
        ['gruvbox-dark', 'Gruvbox Dark', '#282828', '#ebdbb2', '#fabd2f', '#8ec07c'],
        ['solarized-dark', 'Solarized Dark', '#002b36', '#c9d4d4', '#3ba0e6', '#2fb3a7'],
        ['mocha-dark', 'Catppuccin Mocha', '#1e1e2e', '#cdd6f4', '#cba6f7', '#89b4fa'],
        ['macchiato-dark', 'Catppuccin Macchiato', '#24273a', '#cad3f5', '#c6a0f6', '#8bd5ca'],
        ['tokyo-dark', 'Tokyo Night', '#1a1b26', '#c0caf5', '#7aa2f7', '#bb9af7'],
        ['onedark-dark', 'One Dark', '#282c34', '#d0d5de', '#61afef', '#c678dd'],
        ['rosepine-dark', 'Rosé Pine', '#191724', '#e0def4', '#ebbcba', '#9ccfd8'],
        ['moon-dark', 'Rosé Pine Moon', '#232136', '#e0def4', '#ea9a97', '#c4a7e7'],
        ['everforest-dark', 'Everforest Dark', '#2d353b', '#d8ccb0', '#a7c080', '#7fbbb3'],
        ['monokai-dark', 'Monokai', '#272822', '#f8f8f2', '#a6e22e', '#66d9ef'],
        ['kanagawa-dark', 'Kanagawa', '#1f1f28', '#dcd7ba', '#7e9cd8', '#e6c384'],
        ['ayu-dark', 'Ayu Dark', '#0b0e14', '#c9c7be', '#e6b450', '#59c2ff'],
        ['github-dark', 'GitHub Dark', '#0d1117', '#e6edf3', '#4493f8', '#3fb950'],
        ['palenight-dark', 'Palenight', '#292d3e', '#d5daee', '#c792ea', '#82aaff'],
        ['cobalt-dark', 'Kobalt', '#14293d', '#e8f2fb', '#ffc600', '#5ac8fa'],
        ['ocean-dark', 'Derin Deniz', '#071a24', '#dcebf2', '#3ec6d8', '#7aa7ff'],
        ['coffee-dark', 'Kahve', '#211a16', '#eee0d2', '#d9a273', '#b7b27a'],
        ['ember-dark', 'Köz', '#1c1210', '#f6e4de', '#ff7a59', '#ffc46b'],
        ['wine-dark', 'Şarap', '#210f17', '#f5e1e8', '#f0718f', '#d9a7e8'],
        ['matrix-dark', 'Fosfor', '#050a06', '#c8f7d0', '#3be36a', '#a9e34b'],
        ['amber-dark', 'Kehribar', '#120d04', '#ffdf9e', '#ffb000', '#ff8f3f'],
        ['aurora-dark', 'Kutup Işığı', '#0e1526', '#e2ecff', '#5eead4', '#c084fc'],
        ['graphite-dark', 'Grafit', '#1c1c1e', '#ececee', '#d0d0d4', '#8ab4f8'],
        ['neon-dark', 'Neon', '#100820', '#f3eaff', '#ff4fd8', '#3ee6ff'],
        ['desert-dark', 'Çöl Gecesi', '#231c1a', '#f0e2d0', '#e8a15c', '#7fb8b0'],
        ['ice-dark', 'Buzul', '#16212b', '#e6f1f7', '#8fd3f4', '#b4c6ff'],
        ['contrast-dark', 'Yüksek Karşıtlık (koyu)', '#000000', '#ffffff', '#ffd60a', '#5ee0ff']
    ];

    var HEX = /^#[0-9a-f]{6}$/i;
    var CUSTOM_ID = /^custom-[a-z0-9]{1,16}-(light|dark)$/;
    var MAX_CUSTOM = 40;

    function rgb(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); }); }
    function rgba(hex, a) { return 'rgba(' + rgb(hex).join(', ') + ', ' + a + ')'; }
    /** a renginin üstüne t oranında b */
    function mix(a, b, t) {
        var x = rgb(a), y = rgb(b);
        return '#' + x.map(function (v, i) { return ('0' + Math.round(v + (y[i] - v) * t).toString(16)).slice(-2); }).join('');
    }
    function luminance(hex) {
        var c = rgb(hex).map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrast(a, b) {
        var x = luminance(a), y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }
    function isDark(id) { return /-dark$/.test(id); }
    function isDarkColor(hex) { return luminance(hex) < 0.2; }
    /** Vurgu renginin üstündeki yazı */
    function onColor(hex) { return contrast(hex, '#ffffff') >= contrast(hex, '#14161a') ? '#ffffff' : '#14161a'; }
    /** Yazı tonu: zemine doğru soldurulur ama okunabilirlik sınırının altına inmez. */
    function fade(fg, bg, t, min) {
        while (t > 0 && contrast(mix(fg, bg, t), bg) < min) t -= 0.04;
        return mix(fg, bg, Math.max(0, t));
    }

    function accentVars(ac, ac2) {
        return {
            '--accent-primary': ac,
            '--accent-secondary': ac2,
            '--accent-gradient': 'linear-gradient(135deg, ' + ac + ' 0%, ' + ac2 + ' 100%)',
            '--accent-glow': rgba(ac, 0.18),
            '--border-color-active': rgba(ac, 0.45),
            '--on-accent': onColor(ac)
        };
    }

    function vars(t) {
        var dark = isDark(t.id);
        var v = {
            '--bg-base': t.bg,
            '--bg-surface': rgba(dark ? mix(t.bg, t.fg, 0.06) : mix(t.bg, '#ffffff', 0.5), 0.92),
            '--bg-surface-hover': mix(t.bg, t.fg, dark ? 0.12 : 0.06),
            '--bg-control': mix(t.bg, t.fg, dark ? 0.09 : 0.08),
            '--border-color': rgba(t.fg, dark ? 0.12 : 0.14),
            '--text-primary': t.fg,
            '--text-secondary': fade(t.fg, t.bg, 0.24, 4.5),
            '--text-muted': fade(t.fg, t.bg, 0.46, 3.2),
            '--success': dark ? '#6cc98a' : '#1f7a45',
            '--warning': dark ? '#f0bf5f' : '#9a6700',
            '--error': dark ? '#f4837a' : '#c2302a',
            '--glass-shadow': dark ? '0 8px 32px 0 rgba(0, 0, 0, 0.37)' : '0 8px 32px 0 ' + rgba(t.fg, 0.1)
        };
        var a = accentVars(t.ac, t.ac2);
        Object.keys(a).forEach(function (k) { v[k] = a[k]; });
        return v;
    }

    function toTheme(kind) {
        // Yerleşik temaların Türkçe adları çevrilir; marka adları sözlükte yoktur, aynen kalır.
        return function (r) { return { id: r[0], name: T(r[1]), bg: r[2], fg: r[3], ac: r[4], ac2: r[5], kind: kind }; };
    }
    var builtin = CSS.map(toTheme('css')).concat(GENERATED.map(toTheme('generated')));
    // Aynı dizi nesnesi kalır: diğer dosyalar THEMES'i doğrudan kullanır.
    var list = builtin.slice();

    function cssText() {
        return list.map(function (t) {
            var v = t.kind === 'css' ? { '--on-accent': onColor(t.ac) } : vars(t);
            return '[data-theme="' + t.id + '"]{' + Object.keys(v).map(function (k) { return k + ':' + v[k]; }).join(';') + '}';
        }).join('\n');
    }

    /** Ayar dosyasından gelen liste güvenilmezdir: renkler CSS'e yazılır. */
    function cleanCustom(raw) {
        var seen = {};
        return (Array.isArray(raw) ? raw : []).filter(function (t) {
            var ok = t && typeof t === 'object' && CUSTOM_ID.test(t.id) && !seen[t.id] &&
                ['bg', 'fg', 'ac', 'ac2'].every(function (k) { return typeof t[k] === 'string' && HEX.test(t[k]); });
            if (ok) seen[t.id] = true;
            return ok;
        }).slice(0, MAX_CUSTOM).map(function (t) {
            var name = typeof t.name === 'string' ? t.name.trim().slice(0, 40) : '';
            return { id: t.id, name: name || T('Temam'), bg: t.bg, fg: t.fg, ac: t.ac, ac2: t.ac2, kind: 'custom' };
        });
    }

    function render() {
        if (!root.document || !root.document.head) return;
        var el = root.document.getElementById('theme-vars');
        if (!el) {
            el = root.document.createElement('style');
            el.id = 'theme-vars';
            root.document.head.appendChild(el);
        }
        el.textContent = cssText();
    }

    function setCustom(raw) {
        var mine = cleanCustom(raw);
        list.length = 0;
        Array.prototype.push.apply(list, builtin.concat(mine));
        render();
        return mine;
    }

    var api = {
        list: list, setCustom: setCustom, vars: vars, accentVars: accentVars, mix: mix, contrast: contrast,
        isDark: isDark, isDarkColor: isDarkColor, onColor: onColor, cssText: cssText,
        isHex: function (s) { return typeof s === 'string' && HEX.test(s); },
        find: function (id) { return list.find(function (t) { return t.id === id; }); },
        newId: function (dark) { return 'custom-' + Date.now().toString(36) + (dark ? '-dark' : '-light'); }
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else { root.Themes = api; root.THEMES = list; render(); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
