/**
 * Markdown içindeki görsel yollarını sunucudan servis edilebilir bir URL'e çevirir.
 *
 * Markdown göreli yolları (img/grafik.svg) belgenin bulunduğu klasöre göredir.
 * Tarayıcı ise bunları sayfanın adresine göre çözer; sunucu kökünde böyle bir
 * dosya olmadığı için istek boşa gider. Burada yol, açık olan markdown
 * dosyasının klasörüne göre mutlak hale getirilip /api/asset üzerinden istenir.
 *
 * Hem tarayıcıda (global) hem Node'da (module.exports) kullanılabilir.
 */
(function (root) {
    'use strict';

    // "https:", "data:", "mailto:" gibi bir şema veya "//host/..." ile başlıyor mu?
    // "D:\..." ve "C:/..." sürücü harfleri şema sanılmamalı, o yüzden tek harfli
    // önekler kapsam dışı bırakılıyor.
    function hasUrlScheme(value) {
        return /^[a-z][a-z0-9+.-]+:/i.test(value) || value.indexOf('//') === 0;
    }

    function isWindowsAbsolute(value) {
        return /^[a-z]:[\\/]/i.test(value) || value.indexOf('\\\\') === 0;
    }

    function isPosixAbsolute(value) {
        return value.charAt(0) === '/';
    }

    function usesBackslashes(value) {
        return value.indexOf('\\') !== -1;
    }

    function dirOf(filePath) {
        var cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        return cut === -1 ? '' : filePath.slice(0, cut);
    }

    /**
     * Göreli parçaları ("." ve "..") çözerek segmentleri birleştirir.
     * path modülünü kullanmaz; tarayıcıda da çalışması gerekiyor.
     */
    function joinPath(baseDir, relative, separator) {
        var segments = baseDir.split(/[\\/]/);
        var parts = relative.split(/[\\/]/);

        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (part === '' || part === '.') continue;
            if (part === '..') {
                // Kök segmentini ("D:" veya "") yutmamak için en az bir segment bırak.
                if (segments.length > 1) segments.pop();
                continue;
            }
            segments.push(part);
        }
        return segments.join(separator);
    }

    /**
     * @param {string} src        Markdown'daki ham yol, örn. "img/grafik.svg"
     * @param {string} currentFilePath  Açık markdown dosyasının mutlak yolu
     * @returns {string|null}     /api/asset URL'i, ya da dokunulmaması gerekiyorsa null
     */
    function resolveAssetUrl(src, currentFilePath) {
        var absolute = resolveLocalPath(src, currentFilePath);
        return absolute === null ? null : '/api/asset?file=' + encodeURIComponent(absolute);
    }

    /**
     * Markdown'daki bir yolu diskteki mutlak yola çevirir.
     *
     * @param {string} src              Ham yol, örn. "sub/README.md" veya "D:\x\y.md"
     * @param {string} currentFilePath  Açık markdown dosyasının mutlak yolu
     * @returns {string|null}           Mutlak yol; şema/sayfa içi/çözülemez ise null
     */
    function resolveLocalPath(src, currentFilePath) {
        if (typeof src !== 'string') return null;

        var value = src.trim();
        if (!value) return null;
        if (value.charAt(0) === '#') return null;          // sayfa içi bağlantı
        if (value.indexOf('/api/') === 0) return null;      // zaten çözülmüş
        if (hasUrlScheme(value)) return null;               // http(s):, data:, file: ...

        // Markdown yazarken boşluklar %20 olarak kodlanmış olabilir.
        var decoded = value;
        try {
            decoded = decodeURIComponent(value);
        } catch (e) {
            decoded = value;                                // bozuk kodlama: ham hali kullan
        }

        if (isWindowsAbsolute(decoded) || isPosixAbsolute(decoded)) {
            return decoded;
        }
        if (!currentFilePath) return null;                  // referans alacak belge yok
        var baseDir = dirOf(currentFilePath);
        if (!baseDir) return null;
        var separator = usesBackslashes(currentFilePath) ? '\\' : '/';
        return joinPath(baseDir, decoded, separator);
    }

    function isMarkdownPath(p) {
        return /\.(md|markdown)$/i.test(p);
    }

    /**
     * Belge içindeki bir <a href> için ne yapılacağını söyler.
     *
     * @returns {{kind: 'anchor'|'external'|'markdown'|'file'|'unresolved', target: string, anchor?: string}}
     *   anchor     : sayfa içi başlık (target = id)
     *   external   : http(s)/mailto vb. (target = url)
     *   markdown   : yerel .md/.markdown (target = mutlak yol, anchor = varsa #parça)
     *   file       : başka yerel dosya (target = mutlak yol)
     *   unresolved : göreli ama referans belge yok (target = ham href)
     */
    function classifyLink(href, currentFilePath) {
        var value = typeof href === 'string' ? href.trim() : '';
        if (value.charAt(0) === '#') {
            return { kind: 'anchor', target: value.slice(1) };
        }
        if (hasUrlScheme(value)) {
            return { kind: 'external', target: value };
        }
        var anchor = '';
        var hash = value.indexOf('#');
        if (hash !== -1) {
            anchor = value.slice(hash + 1);
            value = value.slice(0, hash);
        }
        var absolute = resolveLocalPath(value, currentFilePath);
        if (absolute === null) {
            return { kind: 'unresolved', target: href };
        }
        if (isMarkdownPath(absolute)) {
            var result = { kind: 'markdown', target: absolute };
            if (anchor) result.anchor = anchor;
            return result;
        }
        return { kind: 'file', target: absolute };
    }

    var api = {
        resolveAssetUrl: resolveAssetUrl,
        resolveLocalPath: resolveLocalPath,
        classifyLink: classifyLink
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.AssetUrl = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
