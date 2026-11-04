//! Gezgin listeleme, bağlantı hedefi inceleme ve Obsidian tarzı wikilink çözümü.
use crate::paths::absolutize;
use crate::workspace::Workspace;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const MD_EXTENSIONS: [&str; 2] = [".md", ".markdown"];

pub const DENIED: &str = "Erişim reddedildi: çalışma klasörü dışında.";

fn is_md(name: &str) -> bool {
    let low = name.to_lowercase();
    MD_EXTENSIONS.iter().any(|e| low.ends_with(e))
}

impl Workspace {
    /// Klasörün gizli olmayan alt klasörleri + md dosyaları (ada göre, harf duyarsız).
    /// Yalnızca izinli köklerin altındaki klasörler listelenir.
    pub fn list_dir(&self, dir: &str) -> Value {
        let abs = absolutize(&cwd(), dir);
        if !self.within_root(&abs) {
            return json!({"success": false, "error": DENIED});
        }
        let mut entries: Vec<std::fs::DirEntry> = match std::fs::read_dir(&abs) {
            Ok(rd) => rd.filter_map(Result::ok).collect(),
            Err(e) => return json!({"success": false, "error": e.to_string()}),
        };
        entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
        let (mut dirs, mut files) = (Vec::new(), Vec::new());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let item = json!({"name": name, "path": e.path().to_string_lossy()});
            let path = e.path();
            if path.is_dir() {
                dirs.push(item);
            } else if path.is_file() && is_md(&name) {
                files.push(item);
            }
        }
        json!({"success": true, "path": abs.to_string_lossy(), "dirs": dirs, "files": files})
    }

    /// Bağlantı hedefinin türü: file / dir / missing / denied. Klasörse `note`
    /// klasör notunu verir (README, index, _index, <klasör-adı>; .md/.markdown).
    pub fn inspect_path(&self, path: &str) -> Value {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return json!({"type": "missing", "path": ""});
        }
        let stripped = trimmed.trim_end_matches(['\\', '/']);
        let abs = absolutize(&cwd(), if stripped.is_empty() { trimmed } else { stripped });
        let shown = abs.to_string_lossy();
        if !self.within_root(&abs) {
            json!({"type": "denied", "path": shown})
        } else if abs.is_file() {
            json!({"type": "file", "path": shown})
        } else if abs.is_dir() {
            let note = folder_note(&abs).map(|n| n.to_string_lossy().into_owned());
            json!({"type": "dir", "path": shown, "note": note})
        } else {
            json!({"type": "missing", "path": shown})
        }
    }

    /// [[hedef]] için diskteki dosyayı bulur: (1) belgenin klasörüne göre yol,
    /// (2) izinli köklere göre yol, (3) köklerin altında dosya adıyla arama
    /// (harf duyarsız, gizli klasörler atlanır). Kök dışı hiçbir şey dönmez.
    pub fn resolve_wikilink(&self, target: &str, current_file: Option<&str>) -> Option<String> {
        let target = target.trim().replace('\\', "/");
        if target.is_empty() {
            return None;
        }
        let candidates: Vec<String> = if is_md(&target) {
            vec![target]
        } else {
            MD_EXTENSIONS.iter().map(|e| format!("{target}{e}")).collect()
        };

        let mut bases: Vec<PathBuf> = Vec::new();
        if let Some(cur) = current_file.filter(|c| !c.is_empty()) {
            if let Some(dir) = absolutize(&cwd(), cur).parent() {
                bases.push(dir.to_path_buf());
            }
        }
        for r in self.allowed_roots() {
            if !bases.contains(&r) {
                bases.push(r);
            }
        }
        for base in &bases {
            for cand in &candidates {
                let p = absolutize(base, cand);
                if p.is_file() && self.within_root(&p) {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }

        let wanted: Vec<String> = candidates
            .iter()
            .map(|c| c.rsplit('/').next().unwrap_or(c).to_lowercase())
            .collect();
        self.allowed_roots()
            .iter()
            .find_map(|root| walk_find(root, &wanted))
            .map(|p| p.to_string_lossy().into_owned())
    }
}

fn cwd() -> PathBuf {
    std::env::current_dir().unwrap_or_default()
}

fn folder_note(dir: &Path) -> Option<PathBuf> {
    let base = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let stems = ["readme", "index", "_index", base.as_str()];
    let files: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    for stem in stems {
        for ext in MD_EXTENSIONS {
            let want = format!("{stem}{ext}");
            if let Some(hit) = files.iter().find(|n| n.to_lowercase() == want) {
                return Some(dir.join(hit));
            }
        }
    }
    None
}

/// Python `os.walk` sırası: önce klasörün dosyaları (ada göre), sonra gizli
/// olmayan alt klasörler (ada göre) derinlik öncelikli. Symlink klasörlere inilmez.
fn walk_find(dir: &Path, wanted: &[String]) -> Option<PathBuf> {
    let mut entries: Vec<std::fs::DirEntry> = std::fs::read_dir(dir).ok()?.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    let mut subdirs = Vec::new();
    for e in &entries {
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        if ft.is_dir() {
            if !name.starts_with('.') {
                subdirs.push(e.path());
            }
        } else if wanted.contains(&name.to_lowercase()) {
            return Some(e.path());
        }
    }
    subdirs.iter().find_map(|d| walk_find(d, wanted))
}

#[cfg(test)]
mod tests {
    use crate::workspace::tests::{p, ps, touch, tree};
    use crate::workspace::Workspace;

    fn names(v: &serde_json::Value, key: &str) -> Vec<String> {
        v[key].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap().to_string()).collect()
    }

    fn vault_ws(t: &tempfile::TempDir) -> Workspace {
        let mut ws = Workspace::default();
        ws.set_explorer_root(&ps(t, "vault")).unwrap();
        ws
    }

    #[test]
    fn list_dir_returns_visible_dirs_and_md_files_sorted() {
        let t = tree();
        let r = vault_ws(&t).list_dir(&ps(&t, "vault"));
        assert_eq!(r["success"], true);
        assert_eq!(names(&r, "dirs"), ["empty", "sub"]);
        assert_eq!(names(&r, "files"), ["a.md", "b.markdown"]);
        assert_eq!(r["dirs"][1]["path"], ps(&t, "vault/sub"));
    }

    #[test]
    fn list_dir_outside_roots_is_refused() {
        let t = tree();
        let r = vault_ws(&t).list_dir(&t.path().to_string_lossy());
        assert_eq!(r["success"], false);
        assert_eq!(r["error"], super::DENIED);
    }

    #[test]
    fn list_dir_missing_directory_reports_error() {
        let t = tree();
        let r = vault_ws(&t).list_dir(&ps(&t, "vault/yok"));
        assert_eq!(r["success"], false);
        assert!(r["error"].is_string());
    }

    #[test]
    fn resolve_wikilink_prefers_current_folder() {
        let t = tree();
        let ws = vault_ws(&t);
        touch(&p(&t, "vault/sub/a.md"));
        let cur = ps(&t, "vault/sub/c.md");
        assert_eq!(ws.resolve_wikilink("a", Some(&cur)), Some(ps(&t, "vault/sub/a.md")));
    }

    #[test]
    fn resolve_wikilink_searches_roots_by_basename() {
        let t = tree();
        let ws = vault_ws(&t);
        let cur = ps(&t, "vault/a.md");
        assert_eq!(ws.resolve_wikilink("c", Some(&cur)), Some(ps(&t, "vault/sub/c.md")));
        assert_eq!(ws.resolve_wikilink("C.MD", Some(&cur)), Some(ps(&t, "vault/sub/c.md")));
        assert_eq!(ws.resolve_wikilink("b", Some(&cur)), Some(ps(&t, "vault/b.markdown")));
    }

    #[test]
    fn resolve_wikilink_with_folder_path() {
        let t = tree();
        let ws = vault_ws(&t);
        let cur = ps(&t, "vault/a.md");
        assert_eq!(ws.resolve_wikilink("sub/c", Some(&cur)), Some(ps(&t, "vault/sub/c.md")));
    }

    #[test]
    fn resolve_wikilink_missing_or_outside_returns_none() {
        let t = tree();
        let ws = vault_ws(&t);
        let cur = ps(&t, "vault/a.md");
        assert_eq!(ws.resolve_wikilink("yok", Some(&cur)), None);
        assert_eq!(ws.resolve_wikilink("outside", Some(&cur)), None);
        assert_eq!(ws.resolve_wikilink("../outside", Some(&cur)), None);
        assert_eq!(ws.resolve_wikilink("", Some(&cur)), None);
    }

    #[test]
    fn inspect_path_reports_file_dir_missing_denied() {
        let t = tree();
        let ws = vault_ws(&t);
        assert_eq!(ws.inspect_path(&ps(&t, "vault/a.md"))["type"], "file");
        assert_eq!(ws.inspect_path(&ps(&t, "vault/empty"))["type"], "dir");
        assert_eq!(ws.inspect_path(&ps(&t, "vault/yok"))["type"], "missing");
        assert_eq!(ws.inspect_path(&t.path().to_string_lossy())["type"], "denied");
        assert_eq!(ws.inspect_path("")["type"], "missing");
    }

    #[test]
    fn inspect_path_finds_folder_note_in_priority_order() {
        let t = tree();
        let ws = vault_ws(&t);
        let sub = ps(&t, "vault/sub");
        assert!(ws.inspect_path(&sub)["note"].is_null());
        touch(&p(&t, "vault/sub/sub.md"));
        assert_eq!(ws.inspect_path(&sub)["note"], ps(&t, "vault/sub/sub.md"));
        touch(&p(&t, "vault/sub/_index.md"));
        assert_eq!(ws.inspect_path(&sub)["note"], ps(&t, "vault/sub/_index.md"));
        touch(&p(&t, "vault/sub/index.md"));
        assert_eq!(ws.inspect_path(&sub)["note"], ps(&t, "vault/sub/index.md"));
        touch(&p(&t, "vault/sub/Readme.MD"));
        assert_eq!(ws.inspect_path(&sub)["note"], ps(&t, "vault/sub/Readme.MD"));
        assert_eq!(ws.inspect_path(&format!("{sub}/"))["type"], "dir");
    }
}
