//! Pencereye sürüklenip bırakılan yol: Markdown dosyası açılır, klasör
//! çalışma alanı olur, gerisi yok sayılır.
use mdflow_core::links::MD_EXTENSIONS;
use std::path::Path;

/// `"file"` (.md/.markdown dosya), `"folder"` (klasör) ya da `"other"`.
pub fn classify_drop(path: &Path) -> &'static str {
    if path.is_dir() {
        return "folder";
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if path.is_file() && MD_EXTENSIONS.iter().any(|e| name.ends_with(e)) {
        "file"
    } else {
        "other"
    }
}

/// Bırakılan ilk yolu `dropped-path` olayıyla arayüze iletir.
pub fn on_window_event<R: tauri::Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    use tauri::{DragDropEvent, Emitter, WindowEvent};
    if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
        if let Some(p) = paths.first() {
            let payload = serde_json::json!({"path": p.to_string_lossy(), "kind": classify_drop(p)});
            let _ = window.emit("dropped-path", payload);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn classify_drop_md_file() {
        let t = TempDir::new().unwrap();
        let f = t.path().join("a.MD");
        std::fs::write(&f, "# a").unwrap();
        assert_eq!(classify_drop(&f), "file");
        let g = t.path().join("b.markdown");
        std::fs::write(&g, "# b").unwrap();
        assert_eq!(classify_drop(&g), "file");
    }

    #[test]
    fn classify_drop_dir() {
        let t = TempDir::new().unwrap();
        assert_eq!(classify_drop(t.path()), "folder");
    }

    #[test]
    fn classify_drop_other() {
        let t = TempDir::new().unwrap();
        let f = t.path().join("a.png");
        std::fs::write(&f, [1]).unwrap();
        assert_eq!(classify_drop(&f), "other");
        assert_eq!(classify_drop(&t.path().join("yok.md")), "other");
    }
}
