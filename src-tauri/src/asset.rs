//! `mdasset` özel protokolü: belgeye göreli yerel görselleri kök hapsiyle sunar
//! (2.x `/api/asset` karşılığı). Arayüz URL'yi `convertFileSrc(yol, 'mdasset')`
//! ile kurar: yol percent-encode edilip URL yoluna konur.
use mdflow_core::links::DENIED;
use mdflow_core::workspace::{Confined, Workspace};

/// `request_path`: URL yolu (ör. `/C%3A%5Cdocs%5Ca.png`). Dönüş: (durum, MIME, gövde).
pub fn serve_asset(ws: &Workspace, request_path: &str) -> (u16, &'static str, Vec<u8>) {
    let encoded = request_path.trim_start_matches('/');
    let path = percent_encoding::percent_decode_str(encoded).decode_utf8_lossy().into_owned();
    if path.is_empty() {
        return error(400, "Varlık yolu belirtilmedi.");
    }
    let Confined::Ok(abs) = ws.resolve_confined(&path) else {
        return error(403, DENIED);
    };
    if !abs.is_file() {
        return error(404, &format!("Varlık bulunamadı: {}", abs.to_string_lossy()));
    }
    match std::fs::read(&abs) {
        Ok(bytes) => (200, mime_for(&abs), bytes),
        Err(e) => error(500, &e.to_string()),
    }
}

fn error(status: u16, msg: &str) -> (u16, &'static str, Vec<u8>) {
    let body = serde_json::json!({"success": false, "error": msg}).to_string();
    (status, "application/json", body.into_bytes())
}

fn mime_for(p: &std::path::Path) -> &'static str {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// Tauri protokol işleyicisi: `serve_asset` sonucunu HTTP yanıtına çevirir.
pub fn handle(ws: &Workspace, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let (status, mime, body) = serve_asset(ws, request.uri().path());
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .body(body)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    use std::path::Path;
    use tempfile::TempDir;

    fn url_path(p: &Path) -> String {
        format!("/{}", utf8_percent_encode(&p.to_string_lossy(), NON_ALPHANUMERIC))
    }

    fn setup() -> (TempDir, Workspace) {
        let t = TempDir::new().unwrap();
        let docs = t.path().join("docs");
        std::fs::create_dir_all(docs.join("görseller")).unwrap();
        std::fs::write(docs.join("a.md"), "# x").unwrap();
        std::fs::write(docs.join("resim.png"), [0x89, b'P', b'N', b'G']).unwrap();
        std::fs::write(docs.join("görseller").join("şema 1.png"), [1, 2, 3]).unwrap();
        std::fs::write(t.path().join("gizli.png"), [9]).unwrap();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&docs.join("a.md").to_string_lossy()));
        (t, ws)
    }

    #[test]
    fn asset_inside_root_200_with_mime() {
        let (t, ws) = setup();
        let (status, mime, body) = serve_asset(&ws, &url_path(&t.path().join("docs").join("resim.png")));
        assert_eq!(status, 200);
        assert_eq!(mime, "image/png");
        assert_eq!(body, [0x89, b'P', b'N', b'G']);
    }

    #[test]
    fn asset_outside_root_403() {
        let (t, ws) = setup();
        let (status, mime, body) = serve_asset(&ws, &url_path(&t.path().join("gizli.png")));
        assert_eq!(status, 403);
        assert_eq!(mime, "application/json");
        assert!(String::from_utf8(body).unwrap().contains(DENIED));
    }

    #[test]
    fn asset_missing_404() {
        let (t, ws) = setup();
        assert_eq!(serve_asset(&ws, &url_path(&t.path().join("docs").join("yok.png"))).0, 404);
    }

    #[test]
    fn asset_dotdot_escape_403() {
        let (t, ws) = setup();
        let sneaky = format!("{}/../gizli.png", t.path().join("docs").to_string_lossy());
        assert_eq!(serve_asset(&ws, &url_path(Path::new(&sneaky))).0, 403);
    }

    #[test]
    fn asset_unicode_path_roundtrip() {
        let (t, ws) = setup();
        let (status, _, body) =
            serve_asset(&ws, &url_path(&t.path().join("docs").join("görseller").join("şema 1.png")));
        assert_eq!(status, 200);
        assert_eq!(body, [1, 2, 3]);
    }

    #[test]
    fn asset_svg_mime() {
        let (t, ws) = setup();
        let svg = t.path().join("docs").join("d.SVG");
        std::fs::write(&svg, "<svg/>").unwrap();
        assert_eq!(serve_asset(&ws, &url_path(&svg)).1, "image/svg+xml");
    }
}
