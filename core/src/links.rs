//! Gezgin listeleme, bağlantı hedefi inceleme ve Obsidian tarzı wikilink çözümü.
use crate::paths::absolutize;
use crate::workspace::Workspace;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const MD_EXTENSIONS: [&str; 2] = [".md", ".markdown"];

pub const DENIED: &str = "Erişim reddedildi: çalışma klasörü dışında.";

/// `list_notes` en çok bu kadar dosya döndürür (çok büyük klasörde arayüz donmasın).
pub const NOTE_LIST_LIMIT: usize = 5000;

/// Not içi aramada sonuç ve dosya boyu sınırı.
pub const SEARCH_HIT_LIMIT: usize = 100;
const SEARCH_FILE_LIMIT: u64 = 1024 * 1024;

/// Arama için sadeleştirme: küçük harf, Türkçe I/İ/ı/i tek harf.
/// Her karakter tek karaktere iner; konumlar kaynakla aynı kalır.
fn fold_char(c: char) -> char {
    match c {
        'I' | 'İ' | 'ı' => 'i',
        _ => c.to_lowercase().next().unwrap_or(c),
    }
}

fn fold(s: &str) -> String {
    s.chars().map(fold_char).collect()
}

/// Eşleşmenin çevresinden kısa alıntı.
fn snippet(line: &str, want: &str) -> String {
    let folded = fold(line);
    let at = folded.find(want).map(|b| folded[..b].chars().count()).unwrap_or(0);
    let start = at.saturating_sub(30);
    let len = want.chars().count() + 90;
    let total = line.chars().count();
    let body: String = line.chars().skip(start).take(len).collect();
    let head = if start > 0 { "…" } else { "" };
    let tail = if start + len < total { "…" } else { "" };
    format!("{head}{}{tail}", body.trim())
}

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

    /// Gezgin kökünün altındaki bütün md dosyaları (hızlı geçiş listesi için):
    /// `{name, path, dir}`; `dir` köke göreli klasördür. Gizli klasörler atlanır.
    pub fn list_notes(&self) -> Value {
        let Some(root) = self.explorer_state().root.map(PathBuf::from) else {
            return json!({"success": true, "root": null, "files": [], "truncated": false});
        };
        let mut files = Vec::new();
        walk_notes(&root, &root, &mut files);
        let truncated = files.len() >= NOTE_LIST_LIMIT;
        json!({"success": true, "root": root.to_string_lossy(), "files": files, "truncated": truncated})
    }

    /// İzinli bir klasörde yeni not oluşturur; ad doluysa "Ad 1.md", "Ad 2.md"…
    /// denenir, var olan dosyanın üstüne yazılmaz. Dönüş: `{success, path}`.
    pub fn create_note(&self, dir: &str, name: &str) -> Value {
        let abs = absolutize(&cwd(), dir);
        if !self.within_root(&abs) {
            return json!({"success": false, "error": DENIED});
        }
        let stem = note_stem(name);
        for n in 0..1000 {
            let file = if n == 0 { format!("{stem}.md") } else { format!("{stem} {n}.md") };
            let path = abs.join(file);
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut f) => {
                    use std::io::Write;
                    if let Err(e) = f.write_all(format!("# {stem}\n\n").as_bytes()) {
                        return json!({"success": false, "error": e.to_string()});
                    }
                    return json!({"success": true, "path": path.to_string_lossy()});
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return json!({"success": false, "error": e.to_string()}),
            }
        }
        json!({"success": false, "error": "Bu adla çok fazla not var."})
    }

    /// Gezgin kökündeki notların içinde arama: not başına ilk eşleşme
    /// `{name, path, dir, line, snippet}`. Büyük/küçük harf ve I/İ/ı/i farkı gözetilmez.
    pub fn search_notes(&self, query: &str) -> Value {
        let want = fold(query.trim());
        let root = self.explorer_state().root.map(PathBuf::from);
        let (Some(root), false) = (root, want.is_empty()) else {
            return json!({"success": true, "files": [], "truncated": false});
        };
        let mut notes = Vec::new();
        walk_notes(&root, &root, &mut notes);
        let mut hits = Vec::new();
        for mut note in notes {
            let path = PathBuf::from(note["path"].as_str().unwrap_or_default());
            if !std::fs::metadata(&path).is_ok_and(|m| m.len() <= SEARCH_FILE_LIMIT) {
                continue;
            }
            let Ok(text) = crate::textfile::read_doc(&path) else { continue };
            let Some((i, line)) = text.lines().enumerate().find(|(_, l)| fold(l).contains(&want)) else { continue };
            note["line"] = json!(i + 1);
            note["snippet"] = json!(snippet(line, &want));
            hits.push(note);
            if hits.len() >= SEARCH_HIT_LIMIT {
                return json!({"success": true, "files": hits, "truncated": true});
            }
        }
        json!({"success": true, "files": hits, "truncated": false})
    }

    /// Kök içindeki bir md dosyası; değilse gösterilecek hata.
    fn note_in_root(&self, path: &str) -> Result<PathBuf, Value> {
        let abs = absolutize(&cwd(), path);
        let name = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if path.is_empty() || !self.within_root(&abs) || !is_md(&name) {
            return Err(json!({"success": false, "error": DENIED}));
        }
        if !abs.is_file() {
            return Err(json!({"success": false, "error": "Not bulunamadı."}));
        }
        Ok(abs)
    }

    /// Notu aynı klasörde yeniden adlandırır; uzantı korunur, var olan notun üstüne yazılmaz.
    pub fn rename_note(&self, path: &str, name: &str) -> Value {
        let abs = match self.note_in_root(path) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let ext = abs.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
        let target = abs.with_file_name(format!("{}.{ext}", note_stem(name)));
        // Yalnız harf büyüklüğü değişiyorsa harf duyarsız diskte hedef "var" görünür.
        let same = crate::paths::same_path(&abs.to_string_lossy().to_lowercase(), &target.to_string_lossy().to_lowercase());
        if target != abs && !same && target.exists() {
            return json!({"success": false, "error": "Bu adda bir not zaten var."});
        }
        match std::fs::rename(&abs, &target) {
            Ok(()) => json!({"success": true, "path": target.to_string_lossy()}),
            Err(e) => json!({"success": false, "error": e.to_string()}),
        }
    }

    /// Notu klasöründeki gizli `.trash` klasörüne taşır (kalıcı silmez).
    pub fn trash_note(&self, path: &str) -> Value {
        let abs = match self.note_in_root(path) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let trash = abs.with_file_name(".trash");
        if let Err(e) = std::fs::create_dir_all(&trash) {
            return json!({"success": false, "error": e.to_string()});
        }
        let stem = abs.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        let ext = abs.extension().unwrap_or_default().to_string_lossy().into_owned();
        let target = (0..10_000)
            .map(|n| trash.join(if n == 0 { format!("{stem}.{ext}") } else { format!("{stem} {n}.{ext}") }))
            .find(|p| !p.exists());
        let Some(target) = target else {
            return json!({"success": false, "error": "Çöp klasörü dolu."});
        };
        match std::fs::rename(&abs, &target) {
            Ok(()) => json!({"success": true, "path": target.to_string_lossy()}),
            Err(e) => json!({"success": false, "error": e.to_string()}),
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

/// Not adı: uzantı ve dosya adında geçersiz karakterler atılır; boşsa "Adsız".
fn note_stem(name: &str) -> String {
    let mut stem = name.trim();
    for ext in MD_EXTENSIONS {
        if stem.to_lowercase().ends_with(ext) {
            stem = &stem[..stem.len() - ext.len()];
        }
    }
    let clean: String = stem
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '-' } else { c })
        .collect();
    let clean = clean.trim().trim_matches('.').trim();
    if clean.is_empty() {
        "Adsız".to_string()
    } else {
        clean.to_string()
    }
}

/// `walk_find` ile aynı sıra: önce klasörün md dosyaları, sonra alt klasörler.
fn walk_notes(root: &Path, dir: &Path, out: &mut Vec<Value>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<std::fs::DirEntry> = rd.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    let rel = dir.strip_prefix(root).map(|r| r.to_string_lossy().into_owned()).unwrap_or_default();
    let mut subdirs = Vec::new();
    for e in &entries {
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        if ft.is_dir() {
            subdirs.push(e.path());
        } else if ft.is_file() && is_md(&name) {
            if out.len() >= NOTE_LIST_LIMIT {
                return;
            }
            out.push(json!({"name": name, "path": e.path().to_string_lossy(), "dir": rel}));
        }
    }
    for d in subdirs {
        walk_notes(root, &d, out);
    }
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
    use super::{snippet, PathBuf, DENIED};
    use serde_json::json;
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
    fn list_notes_walks_explorer_root_skipping_hidden() {
        let t = tree();
        let r = vault_ws(&t).list_notes();
        assert_eq!(r["root"], ps(&t, "vault"));
        assert_eq!(names(&r, "files"), ["a.md", "b.markdown", "c.md"]);
        assert_eq!(r["files"][0]["dir"], "");
        assert_eq!(r["files"][2]["dir"], "sub");
        assert_eq!(r["files"][2]["path"], ps(&t, "vault/sub/c.md"));
        assert_eq!(Workspace::default().list_notes()["files"], serde_json::json!([]));
    }

    #[test]
    fn create_note_cleans_name_and_never_overwrites() {
        let t = tree();
        let ws = vault_ws(&t);
        let r = ws.create_note(&ps(&t, "vault/sub"), " Toplantı: 1/2.md ");
        assert_eq!(r["success"], true);
        assert_eq!(r["path"], ps(&t, "vault/sub/Toplantı- 1-2.md"));
        assert_eq!(std::fs::read_to_string(p(&t, "vault/sub/Toplantı- 1-2.md")).unwrap(), "# Toplantı- 1-2\n\n");

        assert_eq!(ws.create_note(&ps(&t, "vault"), "a")["path"], ps(&t, "vault/a 1.md"));
        assert_eq!(std::fs::read_to_string(p(&t, "vault/a.md")).unwrap(), "# x\n");
        assert_eq!(ws.create_note(&ps(&t, "vault"), "  ")["path"], ps(&t, "vault/Adsız.md"));
    }

    #[test]
    fn create_note_outside_roots_is_refused() {
        let t = tree();
        let r = vault_ws(&t).create_note(&t.path().to_string_lossy(), "x");
        assert_eq!(r["error"], super::DENIED);
        assert!(!p(&t, "x.md").exists());
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

    #[test]
    fn search_notes_folds_turkish_and_skips_hidden() {
        let (t, ws) = search_fx();
        let r = ws.search_notes("ISPARTA gülü");
        assert_eq!(r["files"].as_array().unwrap().len(), 1);
        assert_eq!(r["files"][0]["name"], "gezi.md");
        assert_eq!(r["files"][0]["line"], 3);
        assert_eq!(r["files"][0]["snippet"], "Bugün ısparta gülü aldım");
        assert_eq!(ws.search_notes("yok böyle")["files"], json!([]));
        assert_eq!(ws.search_notes("  ")["files"], json!([]));
        drop(t);
    }

    #[test]
    fn search_snippet_is_cut_around_match() {
        let line = format!("{} HEDEF {}", "ğ".repeat(80), "ş".repeat(200));
        let s = snippet(&line, "hedef");
        assert!(s.starts_with('…') && s.ends_with('…') && s.contains("HEDEF"));
    }

    #[test]
    fn rename_note_keeps_extension_and_never_overwrites() {
        let (t, ws) = search_fx();
        let a = t.path().join("gezi.md").to_string_lossy().into_owned();
        assert_eq!(ws.rename_note(&a, "diğer")["success"], false);
        let r = ws.rename_note(&a, "../Yeni: ad.md");
        assert_eq!(r["success"], true);
        assert_eq!(PathBuf::from(r["path"].as_str().unwrap()).parent(), Some(t.path()));
        assert!(!t.path().join("gezi.md").exists());
        assert_eq!(ws.rename_note("/etc/passwd", "x")["error"], DENIED);
    }

    #[test]
    fn trash_note_moves_to_hidden_folder() {
        let (t, ws) = search_fx();
        let a = t.path().join("gezi.md");
        for _ in 0..2 {
            std::fs::write(&a, "x").unwrap();
            assert_eq!(ws.trash_note(&a.to_string_lossy())["success"], true);
        }
        assert!(!a.exists());
        assert!(t.path().join(".trash").join("gezi.md").is_file());
        assert!(t.path().join(".trash").join("gezi 1.md").is_file());
        assert_eq!(ws.trash_note(&a.to_string_lossy())["error"], "Not bulunamadı.");
        assert_eq!(ws.trash_note(&t.path().to_string_lossy())["error"], DENIED);
    }

    fn search_fx() -> (tempfile::TempDir, Workspace) {
        let t = tempfile::TempDir::new().unwrap();
        std::fs::write(t.path().join("gezi.md"), "# Gezi\n\nBugün ısparta gülü aldım\n").unwrap();
        std::fs::write(t.path().join("diğer.md"), "# Diğer\n").unwrap();
        std::fs::create_dir(t.path().join(".gizli")).unwrap();
        std::fs::write(t.path().join(".gizli").join("x.md"), "Isparta gülü").unwrap();
        let mut ws = Workspace::default();
        ws.set_explorer_root(&t.path().to_string_lossy()).unwrap();
        (t, ws)
    }
}
