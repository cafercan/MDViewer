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

        var absolute;
        if (isWindowsAbsolute(decoded) || isPosixAbsolute(decoded)) {
            absolute = decoded;
        } else {
            if (!currentFilePath) return null;              // referans alacak belge yok
            var baseDir = dirOf(currentFilePath);
            if (!baseDir) return null;
            var separator = usesBackslashes(currentFilePath) ? '\\' : '/';
            absolute = joinPath(baseDir, decoded, separator);
        }

        return '/api/asset?file=' + encodeURIComponent(absolute);
    }

    var api = { resolveAssetUrl: resolveAssetUrl };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.AssetUrl = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
