//! Kök hapsi + gezgin (explorer) durumu.
//!
//! İki kök vardır; ikisi de arayüzden serbestçe GENİŞLETİLEMEZ:
//!   - root: belge kökü, açılan ilk dosyanın klasörü (ensure_root / rebase).
//!   - explorer_root: gezgin kökü. Vault sabitlendiyse vault; değilse belge
//!     kökünden başlar ve kullanıcı ↑ ile üst klasöre çıkabilir.
//! Erişim, bu köklerden herhangi birinin altındaysa serbesttir.
use crate::paths::{absolutize, is_under};
use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum Confined {
    Ok(PathBuf),
    Denied,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerState {
    pub root: Option<String>,
    pub vault: Option<String>,
    pub locked: bool,
    pub can_up: bool,
}

#[derive(Default, Debug)]
pub struct Workspace {
    pub root: Option<PathBuf>,
    pub explorer_root: Option<PathBuf>,
    pub vault: Option<PathBuf>,
}

fn cwd() -> PathBuf {
    std::env::current_dir().unwrap_or_default()
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn existing_dir(dir: &str) -> io::Result<PathBuf> {
    let abs = absolutize(&cwd(), dir);
    if abs.is_dir() {
        Ok(abs)
    } else {
        Err(io::Error::new(io::ErrorKind::NotADirectory, s(&abs)))
    }
}

impl Workspace {
    // --- belge kökü ---------------------------------------------------------

    pub fn ensure_root(&mut self, file: Option<&str>) {
        if self.root.is_some() {
            return;
        }
        if let Some(f) = file.filter(|f| !f.is_empty()) {
            self.root = absolutize(&cwd(), f).parent().map(Path::to_path_buf);
        }
    }

    /// Belge kökünü verilen dosyanın klasörüne TAŞIR. Yalnızca kullanıcının
    /// açıkça seçtiği dosya için çağrılır.
    pub fn rebase(&mut self, file: &str) -> PathBuf {
        let abs = absolutize(&cwd(), file);
        self.root = abs.parent().map(Path::to_path_buf);
        abs
    }

    // --- hapis --------------------------------------------------------------

    pub fn allowed_roots(&self) -> Vec<PathBuf> {
        [&self.root, &self.explorer_root].into_iter().flatten().cloned().collect()
    }

    pub fn get_abs(&self, file: &str) -> PathBuf {
        let base = self.root.clone().unwrap_or_else(cwd);
        absolutize(&base, file)
    }

    /// Henüz hiçbir kök yoksa hiçbir yere izin yok.
    pub fn within_root(&self, p: &Path) -> bool {
        self.allowed_roots().iter().any(|r| is_under(p, r))
    }

    pub fn resolve_confined(&self, file: &str) -> Confined {
        let abs = self.get_abs(file);
        if self.within_root(&abs) {
            Confined::Ok(abs)
        } else {
            Confined::Denied
        }
    }

    // --- gezgin -------------------------------------------------------------

    pub fn set_explorer_root(&mut self, dir: &str) -> io::Result<PathBuf> {
        let abs = existing_dir(dir)?;
        self.explorer_root = Some(abs.clone());
        Ok(abs)
    }

    /// Klasörü çalışma alanı yapar: hem belge kökü hem gezgin kökü olur.
    /// Vault kilidi açıksa kilit bu klasöre taşınır.
    pub fn open_workspace(&mut self, dir: &str) -> io::Result<ExplorerState> {
        let abs = existing_dir(dir)?;
        self.root = Some(abs.clone());
        self.explorer_root = Some(abs.clone());
        if self.vault.is_some() {
            self.vault = Some(abs);
        }
        Ok(self.explorer_state())
    }

    fn effective_explorer_root(&self) -> Option<&PathBuf> {
        self.explorer_root.as_ref().or(self.root.as_ref())
    }

    pub fn explorer_state(&self) -> ExplorerState {
        let root = self.effective_explorer_root();
        let locked = self.vault.is_some();
        let can_up = !locked && root.is_some_and(|r| r.parent().is_some());
        ExplorerState {
            root: root.map(|r| s(r)),
            vault: self.vault.as_deref().map(s),
            locked,
            can_up,
        }
    }

    pub fn explorer_up(&mut self) -> ExplorerState {
        if self.explorer_state().can_up {
            if let Some(parent) = self.effective_explorer_root().and_then(|r| r.parent()) {
                self.explorer_root = Some(parent.to_path_buf());
            }
        }
        self.explorer_state()
    }

    /// Gezgin kökünü alt klasöre indirir (kilit açıkken, izinli kökler içinde).
    pub fn explorer_enter(&mut self, dir: &str) -> ExplorerState {
        if self.vault.is_none() {
            let abs = absolutize(&cwd(), dir);
            if abs.is_dir() && self.within_root(&abs) {
                self.explorer_root = Some(abs);
            }
        }
        self.explorer_state()
    }

    /// Vault sabitler (klasör) veya kaldırır (None). Geçersiz klasör yok sayılır.
    pub fn set_vault(&mut self, dir: Option<&str>) -> ExplorerState {
        match dir {
            None => {
                self.vault = None;
                if self.root.is_some() {
                    self.explorer_root = None; // belge köküne dön; belge yoksa yerinde kal
                }
            }
            Some(d) => {
                if let Ok(abs) = self.set_explorer_root(d) {
                    self.vault = Some(abs);
                }
            }
        }
        self.explorer_state()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tempfile::TempDir;

    pub fn touch(p: &Path) -> String {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "# x\n").unwrap();
        s(p)
    }

    /// vault/ a.md b.markdown notes.txt .hidden/ .dot.md sub/c.md empty/ ; outside.md
    pub fn tree() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let v = tmp.path().join("vault");
        touch(&v.join("a.md"));
        touch(&v.join("b.markdown"));
        std::fs::write(v.join("notes.txt"), "txt").unwrap();
        touch(&v.join(".dot.md"));
        std::fs::create_dir_all(v.join(".hidden")).unwrap();
        touch(&v.join("sub").join("c.md"));
        std::fs::create_dir_all(v.join("empty")).unwrap();
        touch(&tmp.path().join("outside.md"));
        tmp
    }

    pub fn p(t: &TempDir, rel: &str) -> PathBuf {
        rel.split('/').fold(t.path().to_path_buf(), |acc, part| acc.join(part))
    }

    pub fn ps(t: &TempDir, rel: &str) -> String {
        s(&p(t, rel))
    }

    #[test]
    fn document_root_confines_by_default() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/sub/c.md")));
        assert!(ws.within_root(&p(&t, "vault/sub/c.md")));
        assert!(!ws.within_root(&p(&t, "vault/a.md")));
    }

    #[test]
    fn explorer_root_widens_confinement() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/sub/c.md")));
        ws.set_explorer_root(&ps(&t, "vault")).unwrap();
        assert!(ws.within_root(&p(&t, "vault/a.md")));
        assert!(ws.within_root(&p(&t, "vault/sub/c.md")));
        assert!(!ws.within_root(&p(&t, "outside.md")));
    }

    #[test]
    fn set_explorer_root_rejects_non_directory() {
        let t = tree();
        let mut ws = Workspace::default();
        assert!(ws.set_explorer_root(&ps(&t, "vault/a.md")).is_err());
    }

    #[test]
    fn resolve_confined_denies_dotdot_escape() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/a.md")));
        assert_eq!(ws.resolve_confined("sub/c.md"), Confined::Ok(p(&t, "vault/sub/c.md")));
        assert_eq!(ws.resolve_confined("../outside.md"), Confined::Denied);
    }

    #[test]
    fn explorer_state_defaults_to_document_folder() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/sub/c.md")));
        let st = ws.explorer_state();
        assert_eq!(st.root, Some(ps(&t, "vault/sub")));
        assert!(!st.locked);
        assert!(st.can_up);
    }

    #[test]
    fn explorer_up_moves_root_to_parent_when_unlocked() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/sub/c.md")));
        assert_eq!(ws.explorer_up().root, Some(ps(&t, "vault")));
        assert!(ws.within_root(&p(&t, "vault/sub/c.md")));
        assert!(ws.within_root(&p(&t, "vault/a.md")));
    }

    #[test]
    fn explorer_up_stops_at_drive_root() {
        let drive_root: PathBuf = cwd().components().take(if cfg!(windows) { 2 } else { 1 }).collect();
        let mut ws = Workspace::default();
        ws.set_explorer_root(&s(&drive_root)).unwrap();
        assert!(!ws.explorer_state().can_up);
        assert_eq!(ws.explorer_up().root, Some(s(&drive_root)));
    }

    #[test]
    fn set_vault_locks_explorer_root() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/sub/c.md")));
        let st = ws.set_vault(Some(&ps(&t, "vault")));
        assert!(st.locked);
        assert_eq!(st.root, Some(ps(&t, "vault")));
        assert!(!st.can_up);
        assert_eq!(ws.explorer_up().root, Some(ps(&t, "vault")));
    }

    #[test]
    fn clear_vault_returns_to_document_folder() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/sub/c.md")));
        ws.set_vault(Some(&ps(&t, "vault")));
        let st = ws.set_vault(None);
        assert!(!st.locked);
        assert_eq!(st.root, Some(ps(&t, "vault/sub")));
    }

    #[test]
    fn set_vault_with_missing_directory_is_ignored() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/sub/c.md")));
        let st = ws.set_vault(Some(&ps(&t, "yok")));
        assert!(!st.locked);
        assert_eq!(st.root, Some(ps(&t, "vault/sub")));
    }

    #[test]
    fn clear_vault_without_document_keeps_folder_unlocked() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.set_vault(Some(&ps(&t, "vault")));
        let st = ws.set_vault(None);
        assert!(!st.locked);
        assert_eq!(st.root, Some(ps(&t, "vault")));
    }

    #[test]
    fn explorer_enter_descends_into_subfolder() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.set_explorer_root(&ps(&t, "vault")).unwrap();
        let st = ws.explorer_enter(&ps(&t, "vault/sub"));
        assert_eq!(st.root, Some(ps(&t, "vault/sub")));
        assert!(st.can_up);
    }

    #[test]
    fn explorer_enter_refuses_folder_outside_roots() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.set_explorer_root(&ps(&t, "vault")).unwrap();
        assert_eq!(ws.explorer_enter(&s(t.path())).root, Some(ps(&t, "vault")));
    }

    #[test]
    fn explorer_enter_ignored_when_locked() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.set_vault(Some(&ps(&t, "vault")));
        let st = ws.explorer_enter(&ps(&t, "vault/sub"));
        assert_eq!(st.root, Some(ps(&t, "vault")));
        assert!(st.locked);
    }

    #[test]
    fn explorer_enter_ignores_missing_folder() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.set_explorer_root(&ps(&t, "vault")).unwrap();
        assert_eq!(ws.explorer_enter(&ps(&t, "vault/yok")).root, Some(ps(&t, "vault")));
    }

    #[test]
    fn open_workspace_moves_both_roots() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.ensure_root(Some(&ps(&t, "vault/a.md")));
        let st = ws.open_workspace(&ps(&t, "vault/sub")).unwrap();
        assert_eq!(st.root, Some(ps(&t, "vault/sub")));
        assert!(!st.locked);
        assert!(ws.within_root(&p(&t, "vault/sub/c.md")));
        assert!(!ws.within_root(&p(&t, "vault/a.md")));
    }

    #[test]
    fn open_workspace_moves_the_lock_when_vault_is_set() {
        let t = tree();
        let mut ws = Workspace::default();
        ws.set_vault(Some(&ps(&t, "vault")));
        let st = ws.open_workspace(&ps(&t, "vault/sub")).unwrap();
        assert!(st.locked);
        assert_eq!(st.vault, Some(ps(&t, "vault/sub")));
    }

    #[test]
    fn open_workspace_rejects_missing_dir() {
        let t = tree();
        let mut ws = Workspace::default();
        assert!(ws.open_workspace(&ps(&t, "yok")).is_err());
    }

    #[test]
    fn no_roots_allows_nothing() {
        let t = tree();
        assert!(!Workspace::default().within_root(&p(&t, "a.md")));
    }

    #[test]
    fn explorer_state_serializes_camel_case() {
        let st = ExplorerState { root: None, vault: None, locked: false, can_up: true };
        assert_eq!(serde_json::to_value(st).unwrap()["canUp"], true);
    }
}
