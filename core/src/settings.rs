//! Kullanıcı ayar dosyası (2.x ile aynı yol ve biçim). Kabuk anahtarları:
//! `lastDir`, `recentFiles`, `recentFolders`, `vaultPath`; arayüzün kendi
//! anahtarları (tema, satır no …) olduğu gibi korunur.
use serde_json::{Map, Value};
use std::io;
use crate::paths::{absolutize, same_path};
use std::path::{Path, PathBuf};

pub const RECENT_LIMIT: usize = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecentKind {
    File,
    Folder,
}

impl RecentKind {
    pub fn parse(kind: &str) -> Option<RecentKind> {
        match kind {
            "file" => Some(RecentKind::File),
            "folder" => Some(RecentKind::Folder),
            _ => None,
        }
    }

    fn key(self) -> &'static str {
        match self {
            RecentKind::File => "recentFiles",
            RecentKind::Folder => "recentFolders",
        }
    }

    fn exists(self, p: &Path) -> bool {
        match self {
            RecentKind::File => p.is_file(),
            RecentKind::Folder => p.is_dir(),
        }
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn abs_string(p: &Path) -> String {
    let cwd = std::env::current_dir().unwrap_or_default();
    absolutize(&cwd, &p.to_string_lossy()).to_string_lossy().into_owned()
}

fn existing_dir(v: Option<&Value>) -> Option<PathBuf> {
    v.and_then(Value::as_str).map(PathBuf::from).filter(|p| p.is_dir())
}

#[derive(Clone, Debug)]
pub struct Settings {
    path: PathBuf,
}

impl Settings {
    /// Windows `%APPDATA%\MDFlowViewer\settings.json`; diğerleri
    /// `$XDG_CONFIG_HOME` ya da `~/.config/MDFlowViewer/settings.json`.
    pub fn default_location() -> Settings {
        let var = if cfg!(windows) { "APPDATA" } else { "XDG_CONFIG_HOME" };
        let base = std::env::var_os(var)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| if cfg!(windows) { home_dir() } else { home_dir().join(".config") });
        Settings::at(base.join("MDFlowViewer").join("settings.json"))
    }

    pub fn at(path: PathBuf) -> Settings {
        Settings { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Bozuk ya da eksik dosya → boş.
    pub fn load(&self) -> Map<String, Value> {
        std::fs::read_to_string(&self.path)
            .ok()
            // Notepad gibi editörler BOM ekler; JSON ayrıştırıcı onu kabul etmez.
            .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
            .and_then(|v| match v {
                Value::Object(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default()
    }

    pub fn save(&self, data: &Map<String, Value>) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string_pretty(data).map_err(io::Error::other)?;
        std::fs::write(&self.path, text)
    }

    /// Mevcut ayarlarla birleştirir (ezmez).
    pub fn merge(&self, patch: Map<String, Value>) -> io::Result<()> {
        let mut data = self.load();
        data.extend(patch);
        self.save(&data)
    }

    /// Ayarı değiştirip yazar; yazma hatası akışı bozmaz (2.x'teki `except OSError: pass`).
    fn update(&self, f: impl FnOnce(&mut Map<String, Value>)) {
        let mut data = self.load();
        f(&mut data);
        let _ = self.save(&data);
    }

    /// Dosya seçme penceresinin açılacağı klasör (en son açılan dosyanın yeri).
    pub fn last_dir(&self) -> Option<PathBuf> {
        existing_dir(self.load().get("lastDir"))
    }

    pub fn remember_last_dir(&self, file: &Path) {
        let abs = PathBuf::from(abs_string(file));
        let Some(dir) = abs.parent().filter(|d| d.is_dir()) else { return };
        let dir = dir.to_string_lossy().into_owned();
        let data = self.load();
        if data.get("lastDir").and_then(Value::as_str) == Some(dir.as_str()) {
            return;
        }
        self.update(|d| {
            d.insert("lastDir".into(), Value::from(dir));
        });
    }

    /// Son açılan dosya/klasör listesi; diskte artık olmayan yollar elenir.
    pub fn get_recent(&self, kind: RecentKind) -> Vec<String> {
        let data = self.load();
        let mut out: Vec<String> = Vec::new();
        let items = data.get(kind.key()).and_then(Value::as_array).cloned().unwrap_or_default();
        for item in items.iter().filter_map(Value::as_str) {
            if !kind.exists(Path::new(item)) || out.iter().any(|o| same_path(o, item)) {
                continue;
            }
            out.push(item.to_string());
            if out.len() >= RECENT_LIMIT {
                break;
            }
        }
        out
    }

    /// Yolu listenin başına taşır; liste RECENT_LIMIT ile sınırlıdır.
    pub fn remember_recent(&self, kind: RecentKind, path: &Path) {
        let abs = abs_string(path);
        self.update(|d| {
            let current: Vec<String> = d
                .get(kind.key())
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                .unwrap_or_default();
            let mut updated = vec![abs.clone()];
            updated.extend(current.into_iter().filter(|p| !same_path(p, &abs)));
            updated.truncate(RECENT_LIMIT);
            d.insert(kind.key().into(), Value::from(updated));
        });
    }

    pub fn clear_recent(&self, kind: RecentKind) {
        self.update(|d| {
            d.remove(kind.key());
        });
    }

    /// Sabitlenmiş gezgin kökü (vault); yoksa veya klasör silinmişse None.
    pub fn vault_path(&self) -> Option<PathBuf> {
        existing_dir(self.load().get("vaultPath"))
    }

    /// Vault'u yazar; None ya da geçersiz klasör anahtarı siler.
    pub fn set_vault_path(&self, dir: Option<&Path>) {
        self.update(|d| match dir.filter(|p| p.is_dir()) {
            Some(p) => {
                d.insert("vaultPath".into(), Value::from(abs_string(p)));
            }
            None => {
                d.remove("vaultPath");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Settings) {
        let tmp = TempDir::new().unwrap();
        let s = Settings::at(tmp.path().join("settings.json"));
        (tmp, s)
    }

    fn touch(p: &Path) -> String {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "# x\n").unwrap();
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn vault_path_roundtrip() {
        let (tmp, s) = setup();
        assert_eq!(s.vault_path(), None);
        s.set_vault_path(Some(tmp.path()));
        assert_eq!(s.vault_path(), Some(tmp.path().to_path_buf()));
        s.set_vault_path(None);
        assert_eq!(s.vault_path(), None);
    }

    #[test]
    fn vault_path_ignores_missing_dir() {
        let (tmp, s) = setup();
        s.set_vault_path(Some(&tmp.path().join("yok")));
        assert_eq!(s.vault_path(), None);
    }

    #[test]
    fn recent_keeps_newest_first_and_caps_at_ten() {
        let (tmp, s) = setup();
        let paths: Vec<String> = (0..12).map(|i| touch(&tmp.path().join(format!("f{i}.md")))).collect();
        for p in &paths {
            s.remember_recent(RecentKind::File, Path::new(p));
        }
        let recent = s.get_recent(RecentKind::File);
        assert_eq!(recent.len(), RECENT_LIMIT);
        assert_eq!(recent[0], paths[11]);
        assert!(!recent.contains(&paths[0]));
    }

    #[test]
    fn recent_moves_repeat_to_front_without_duplicate() {
        let (tmp, s) = setup();
        let a = touch(&tmp.path().join("a.md"));
        let b = touch(&tmp.path().join("b.md"));
        s.remember_recent(RecentKind::File, Path::new(&a));
        s.remember_recent(RecentKind::File, Path::new(&b));
        s.remember_recent(RecentKind::File, Path::new(&a));
        assert_eq!(s.get_recent(RecentKind::File), vec![a, b]);
    }

    #[test]
    fn recent_drops_deleted_paths() {
        let (tmp, s) = setup();
        let gone = touch(&tmp.path().join("gone.md"));
        let stays = touch(&tmp.path().join("stays.md"));
        s.remember_recent(RecentKind::File, Path::new(&gone));
        s.remember_recent(RecentKind::File, Path::new(&stays));
        std::fs::remove_file(&gone).unwrap();
        assert_eq!(s.get_recent(RecentKind::File), vec![stays]);
    }

    #[test]
    fn recent_folders_separate_from_files() {
        let (tmp, s) = setup();
        let f = touch(&tmp.path().join("a.md"));
        let d = tmp.path().to_string_lossy().into_owned();
        s.remember_recent(RecentKind::File, Path::new(&f));
        s.remember_recent(RecentKind::Folder, Path::new(&d));
        assert_eq!(s.get_recent(RecentKind::File), vec![f.clone()]);
        assert_eq!(s.get_recent(RecentKind::Folder), vec![d]);
        s.clear_recent(RecentKind::Folder);
        assert!(s.get_recent(RecentKind::Folder).is_empty());
        assert_eq!(s.get_recent(RecentKind::File), vec![f]);
    }

    #[test]
    fn recent_kind_parse_rejects_unknown() {
        assert_eq!(RecentKind::parse("file"), Some(RecentKind::File));
        assert_eq!(RecentKind::parse("folder"), Some(RecentKind::Folder));
        assert_eq!(RecentKind::parse("sey"), None);
    }

    #[test]
    fn merge_keeps_unknown_keys() {
        let (tmp, s) = setup();
        let dir = tmp.path().to_string_lossy().into_owned();
        let mut first = Map::new();
        first.insert("theme".into(), Value::from("x"));
        first.insert("lastDir".into(), Value::from(dir.clone()));
        s.save(&first).unwrap();
        let mut patch = Map::new();
        patch.insert("theme".into(), Value::from("y"));
        s.merge(patch).unwrap();
        let data = s.load();
        assert_eq!(data["theme"], "y");
        assert_eq!(data["lastDir"], Value::from(dir));
    }

    #[test]
    fn merge_keeps_key_order() {
        let (_tmp, s) = setup();
        std::fs::write(s.path(), r#"{"theme": "x", "autosave": true, "lastDir": "C:/a"}"#).unwrap();
        let mut patch = Map::new();
        patch.insert("theme".into(), Value::from("y"));
        s.merge(patch).unwrap();
        let text = std::fs::read_to_string(s.path()).unwrap();
        let pos = |k: &str| text.find(k).unwrap();
        assert!(pos("theme") < pos("autosave") && pos("autosave") < pos("lastDir"), "{text}");
    }

    #[test]
    fn load_accepts_utf8_bom() {
        let (_tmp, s) = setup();
        std::fs::write(s.path(), b"\xEF\xBB\xBF{\"theme\": \"slate-dark\"}").unwrap();
        assert_eq!(s.load()["theme"], "slate-dark");
    }

    #[test]
    fn load_corrupt_file_is_empty() {
        let (_tmp, s) = setup();
        std::fs::write(s.path(), "{oops").unwrap();
        assert!(s.load().is_empty());
    }

    #[test]
    fn save_writes_pretty_utf8_json() {
        let (_tmp, s) = setup();
        let mut m = Map::new();
        m.insert("lastDir".into(), Value::from("C:/Belgeler/Şema"));
        s.save(&m).unwrap();
        let text = std::fs::read_to_string(s.path()).unwrap();
        assert!(text.contains("\n  \"lastDir\": \"C:/Belgeler/Şema\""));
    }

    #[test]
    fn remember_last_dir_stores_parent_folder() {
        let (tmp, s) = setup();
        let f = touch(&tmp.path().join("sub").join("a.md"));
        s.remember_last_dir(Path::new(&f));
        assert_eq!(s.last_dir(), Some(tmp.path().join("sub")));
    }
}
